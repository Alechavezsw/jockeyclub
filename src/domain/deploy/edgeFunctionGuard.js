import { parse } from 'acorn';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { authorizeEdgePayload, payloadFromPackage } from './edgeFunctionRelease.js';

const REMOTE_SPEC = /^(?:npm:|jsr:|https?:|node:)/;
const LOCAL_EXT = ['.ts', '.tsx', '.js', '.mjs', '.jsx'];

function posix(value) {
  return value.split(sep).join('/');
}

function stripComments(source) {
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function braceParts(clause) {
  const brace = String(clause || '').match(/\{([\s\S]*)\}/);
  if (!brace) return [];
  return brace[1].split(',').flatMap((part) => {
    const cleaned = part.replace(/\btype\b/g, '').trim();
    if (!cleaned) return [];
    const [original, alias] = cleaned.split(/\s+as\s+/).map((item) => item.trim());
    return original ? [{ original, published: alias || original }] : [];
  });
}

function importedNames(clause) {
  return braceParts(clause).map((part) => part.original);
}

function parseModule(source) {
  const text = stripComments(source);
  const specs = [];
  const named = [];
  const reexport = [];
  const fromRe = /\b(?:import|export)\s+(?:type\s+)?([\s\S]*?)\sfrom\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(fromRe)) {
    const specifier = match[2];
    specs.push(specifier);
    const names = importedNames(match[1]);
    if (match[0].trimStart().startsWith('export')) reexport.push({ specifier, names });
    else if (names.length) named.push({ specifier, names });
  }
  for (const match of text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
    specs.push(match[1]);
  }
  const exports = new Set();
  if (/\bexport\s+default\b/.test(text)) exports.add('default');
  for (const match of text.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) exports.add(match[1]);
  for (const match of text.matchAll(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g)) exports.add(match[1]);
  for (const match of text.matchAll(/\bexport\s+(?:const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/g)) exports.add(match[1]);
  for (const match of text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
    const after = text.slice(match.index, match.index + match[0].length + 40);
    if (/\}\s*from\s*['"]/.test(after)) continue;
    for (const part of braceParts(`{${match[1]}}`)) exports.add(part.published);
  }
  return { specs: [...new Set(specs)], named, reexport, exports };
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return '';
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of LOCAL_EXT) {
    if (existsSync(base + ext)) return base + ext;
  }
  return '';
}

function deployName(functionDir, file) {
  return posix(relative(functionDir, file));
}

function compileSource(name, source) {
  try {
    const javascript = stripTypeScriptTypes(source, { mode: 'strip' });
    parse(javascript, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (error) {
    return `${name} no compiló. ${error instanceof Error ? error.message : 'sintaxis inválida'}`;
  }
  return '';
}

function fileHash(source) {
  return createHash('sha256').update(source).digest('hex');
}

function manifestOf(slug, files) {
  const listed = [...files.values()]
    .map((file) => ({
      name: file.name,
      sha256: fileHash(file.source),
      bytes: new TextEncoder().encode(file.source).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const packageSha256 = createHash('sha256')
    .update(listed.map((file) => `${file.name}:${file.sha256}`).join('\n'))
    .digest('hex');
  return { slug, files: listed, packageSha256 };
}

function exportSet(file, files, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const parsed = parseModule(files.get(file).source);
  const names = new Set(parsed.exports);
  for (const item of parsed.reexport) {
    const target = resolveLocal(file, item.specifier);
    if (!target || !files.has(target)) continue;
    const available = exportSet(target, files, seen);
    if (!item.names.length) {
      for (const name of available) names.add(name);
    } else {
      for (const name of item.names) {
        if (available.has(name)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * Arma el paquete de una Edge Function desde el disco.
 * No publica: si falta un archivo, un import o la compilación, el resultado no es desplegable.
 */
export function prepareEdgePackage(functionsDir, slug) {
  const root = resolve(functionsDir);
  const functionDir = resolve(root, slug);
  const entry = join(functionDir, 'index.ts');
  const problems = [];
  const files = new Map();

  if (!existsSync(entry)) {
    return { ok: false, slug, problems: [`Falta ${slug}/index.ts`], files: [], manifest: null };
  }

  const walk = (file) => {
    const rel = relative(root, file);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      problems.push(`Import fuera de supabase/functions: ${file}`);
      return;
    }
    if (files.has(file)) return;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `No se pudo leer ${file}`);
      return;
    }
    if (!source.trim() || source.trim() === 'PLACEHOLDER') {
      problems.push(`${deployName(functionDir, file)} está vacío o es un marcador.`);
      return;
    }
    files.set(file, { name: deployName(functionDir, file), source });
    const parsed = parseModule(source);
    for (const specifier of parsed.specs) {
      if (REMOTE_SPEC.test(specifier) || !specifier.startsWith('.')) continue;
      const next = resolveLocal(file, specifier);
      if (!next) {
        problems.push(`${deployName(functionDir, file)} importa ${specifier} y ese archivo no está.`);
        continue;
      }
      walk(next);
    }
  };

  walk(entry);

  for (const [file, item] of files) {
    const parsed = parseModule(item.source);
    const compileError = compileSource(item.name, item.source);
    if (compileError) problems.push(`${item.name} no compiló. ${compileError}`);
    for (const dep of parsed.named) {
      if (REMOTE_SPEC.test(dep.specifier) || !dep.specifier.startsWith('.')) continue;
      const target = resolveLocal(file, dep.specifier);
      if (!target || !files.has(target)) continue;
      const available = exportSet(target, files);
      for (const name of dep.names) {
        if (!available.has(name)) {
          problems.push(`${item.name} importa ${name} desde ${dep.specifier} y ese módulo no lo exporta.`);
        }
      }
    }
  }

  const unique = [...new Set(problems)];
  if (unique.length) {
    return { ok: false, slug, problems: unique, files: [], manifest: null };
  }
  return {
    ok: true,
    slug,
    problems: [],
    files: [...files.values()].map((file) => ({ name: file.name, content: file.source })),
    manifest: manifestOf(slug, files),
  };
}

export function checkEdgeFunctions(functionsDir) {
  const root = resolve(functionsDir);
  const slugs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((slug) => existsSync(join(root, slug, 'index.ts')))
    .toSorted();
  const results = slugs.map((slug) => prepareEdgePackage(root, slug));
  return { ok: results.every((item) => item.ok), results };
}

/** El publicador solo corre cuando el envío es idéntico al paquete leído del disco. */
export function releaseEdgeDeploy(prepared, upload) {
  const payload = payloadFromPackage(prepared);
  const decision = authorizeEdgePayload(prepared, payload);
  if (!decision.ok) {
    return { deployed: false, cancelled: true, problems: decision.problems };
  }
  if (!prepared.manifest.files.some((file) => file.name === 'index.ts')) {
    return { deployed: false, cancelled: true, problems: ['El paquete no incluye index.ts. No se publica.'] };
  }
  if (typeof upload !== 'function') {
    return { deployed: false, cancelled: true, problems: ['No hay un publicador. No se publica.'] };
  }
  upload(payload);
  return { deployed: true, cancelled: false, manifest: prepared.manifest, problems: [] };
}
