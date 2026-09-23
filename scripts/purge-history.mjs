/**
 * Purga del historial de git (Fase 3): saca de todos los commits los exports con datos de
 * socios y reemplaza la contraseña y los DNI/nombres reales que quedaron en archivos que
 * sí se conservan (tests viejos, docs, scripts).
 *
 * No toca este repositorio ni hace push: clona el historial commiteado en un directorio
 * aparte, lo reescribe con `git filter-branch`, limpia los objetos viejos y verifica.
 * El force-push queda a cargo de quien lo corre, con los comandos que imprime al final.
 *
 * Uso:
 *   node scripts/purge-history.mjs [--out <directorio>]
 *     Por defecto clona en ../jockeyclub-purga (junto al repo). Solo entra lo commiteado.
 *
 * Los DNI y nombres a reemplazar se sacan en el momento de src/data/seed/*.js (que no se
 * commitea), y la contraseña, de las versiones viejas de demoUsers.js en el historial. La
 * lista queda en un archivo temporal que se borra al terminar.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

/** Rutas que desaparecen de todos los commits (y del último: quedan solo en disco). */
export const PURGED_PATHS = [
  'src/data/seed',
  'src/data/seedDatitaReservas.js',
  'datita',
  'scripts/seed-accessin-system-users.sql',
  'scripts/chunk-supplier-sql.cjs',
];

const TEXT_FILE = /\.(jsx?|mjs|cjs|json|md|sql|txt|html|css|ya?ml|csv)$|(^|\/)\.env\.example$/;
const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const PASSWORD_PLACEHOLDER = '***REMOVED***';

function git(cwd, args, options = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    maxBuffer: 1 << 30,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z]/g, '');
}

/** Números de relleno como 96969696: no son documentos de personas. */
function isPlaceholderNumber(token) {
  return new Set(token).size <= 2;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Datos sensibles

async function collectSensitive(repo) {
  const seedDir = path.join(repo, 'src/data/seed');
  if (!fs.existsSync(seedDir)) {
    throw new Error(`No está ${seedDir}: hacen falta los seeds locales para saber qué DNI buscar.`);
  }
  const people = {}; // documento -> [{ names, username }]
  const addPerson = (record) => {
    const doc = String(record.dni || record.documentNumber || '').replace(/\D/g, '');
    if (doc.length < 7 || isPlaceholderNumber(doc)) return;
    const first = String(record.firstName || '').trim();
    const last = String(record.lastName || '').trim();
    const full = String(record.memberName || record.name || '').trim();
    const keep = (n) => (n.length >= 4 ? n : '');
    const username = first && last ? `${slug(first)}.${slug(last)}.${doc.slice(-4)}` : '';
    (people[doc] ||= []).push({ full: keep(full), parts: [first, last].filter(keep), username });
  };
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.dni || value.documentNumber) addPerson(value);
    Object.values(value).forEach(walk);
  };
  for (const file of fs.readdirSync(seedDir)) {
    if (file.endsWith('.js')) walk(await import(pathToFileURL(path.join(seedDir, file)).href));
  }

  const passwords = new Set();
  const demoPath = 'src/domain/auth/demoUsers.js';
  const shas = git(repo, ['log', '--all', '--format=%H', '--', demoPath]).toString().split('\n').filter(Boolean);
  for (const sha of shas) {
    let text = '';
    try {
      text = git(repo, ['show', `${sha}:${demoPath}`]).toString();
    } catch {
      continue;
    }
    for (const m of text.matchAll(/password:\s*'([^']+)'|DEMO_PASSWORD_HINT\s*=\s*'([^']+)'/g)) {
      const value = m[1] || m[2];
      if (value && value !== 'demo-local') passwords.add(value);
    }
  }
  if (!passwords.size) throw new Error('No encontré la contraseña filtrada en el historial de demoUsers.js.');

  return { people, passwords: [...passwords] };
}

// ---------------------------------------------------------------------------
// Reemplazo de contenido (determinístico: depende solo del texto)

function sanitize(text, sensitive) {
  let out = text;
  for (const pw of sensitive.passwords) {
    if (out.includes(pw)) out = out.split(pw).join(PASSWORD_PLACEHOLDER);
  }

  const tokens = new Set(out.match(/(?<!\d)\d{7,9}(?!\d)/g) || []);
  for (const token of tokens) {
    const records = sensitive.people[token];
    if (!records) continue;
    out = out.replace(new RegExp(`(?<!\\d)${token}(?!\\d)`, 'g'), '0'.repeat(token.length));
    for (const { full, parts, username } of records) {
      // Primero el nombre completo, después las partes.
      if (full) out = out.split(full).join('Nombre Removido');
      for (const part of parts) {
        out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRegExp(part)}(?![\\p{L}])`, 'gu'), 'Removido');
      }
      if (username) out = out.split(username).join('usuario.removido.0000');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modo filtro: lo invoca filter-branch una vez por commit, con GIT_INDEX_FILE apuntando
// al índice temporal de ese commit.

function runIndexFilter(sensitiveFile, cacheFile) {
  const cwd = process.cwd();
  const sensitive = JSON.parse(fs.readFileSync(sensitiveFile, 'utf8'));
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

  git(cwd, ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', ...PURGED_PATHS]);

  const entries = git(cwd, ['ls-files', '-s', '-z']).toString().split('\0').filter(Boolean);
  const updates = [];
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode, sha] = entry.slice(0, tab).split(' ');
    const file = entry.slice(tab + 1);
    if (!/^1006[0-9]{2}$/.test(mode) || !TEXT_FILE.test(file)) continue;

    if (!(sha in cache)) {
      const size = Number(git(cwd, ['cat-file', '-s', sha]).toString().trim());
      if (size > MAX_BLOB_BYTES) {
        cache[sha] = sha;
      } else {
        const text = git(cwd, ['cat-file', 'blob', sha]).toString('utf8');
        const clean = sanitize(text, sensitive);
        cache[sha] = clean === text
          ? sha
          : git(cwd, ['hash-object', '-w', '--stdin'], { input: clean }).toString().trim();
      }
    }
    if (cache[sha] !== sha) updates.push(`${mode} ${cache[sha]}\t${file}`);
  }
  if (updates.length) git(cwd, ['update-index', '--index-info'], { input: `${updates.join('\n')}\n` });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}

// ---------------------------------------------------------------------------
// Verificación del repo reescrito

function verify(out, sensitive) {
  const objects = git(out, ['rev-list', '--objects', '--all']).toString().split('\n');
  const pathsBySha = new Map();
  for (const line of objects) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const sha = line.slice(0, space);
    const file = line.slice(space + 1);
    if (!pathsBySha.has(sha)) pathsBySha.set(sha, new Set());
    pathsBySha.get(sha).add(file);
  }
  const findings = new Map();
  for (const [sha, files] of pathsBySha) {
    const textPaths = [...files].filter((f) => TEXT_FILE.test(f));
    if (!textPaths.length) continue;
    if (git(out, ['cat-file', '-t', sha]).toString().trim() !== 'blob') continue;
    const text = git(out, ['cat-file', 'blob', sha]).toString('utf8');
    const passwords = sensitive.passwords.filter((pw) => text.includes(pw)).length;
    const docs = [...new Set(text.match(/(?<!\d)\d{7,9}(?!\d)/g) || [])]
      .filter((t) => sensitive.people[t]).length;
    if (passwords || docs) {
      for (const f of textPaths) {
        const cur = findings.get(f) || { passwords: 0, docs: 0 };
        findings.set(f, { passwords: cur.passwords + passwords, docs: Math.max(cur.docs, docs) });
      }
    }
  }
  const purgedStill = git(out, ['rev-list', '--all', '--', ...PURGED_PATHS]).toString().split('\n').filter(Boolean);
  return { findings, purgedStill };
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--index-filter') {
    runIndexFilter(args[1], args[2]);
    return;
  }

  const repo = path.resolve(path.dirname(SELF), '..');
  const outArg = args.indexOf('--out');
  const out = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(repo, '..', 'jockeyclub-purga'));
  if (fs.existsSync(out)) throw new Error(`Ya existe ${out}: borralo o elegí otro con --out.`);

  const dirty = git(repo, ['status', '--porcelain']).toString().trim();
  if (dirty) console.warn('AVISO: hay cambios sin commitear; la purga trabaja solo con lo commiteado.');
  const stillTracked = git(repo, ['ls-files', '--', ...PURGED_PATHS]).toString().trim();
  if (stillTracked) {
    console.warn(
      'AVISO: el último commit todavía incluye rutas que se purgan. Antes de alinear tu copia con la\n'
      + 'historia nueva, sacalas del índice y commiteá (git rm -r --cached ...): si no, el reset las\n'
      + 'borra del disco.'
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jockey-purga-'));
  const sensitiveFile = path.join(tmp, 'sensitive.json');
  const cacheFile = path.join(tmp, 'blob-cache.json');
  try {
    const sensitive = await collectSensitive(repo);
    fs.writeFileSync(sensitiveFile, JSON.stringify(sensitive));
    console.log(`referencia: ${Object.keys(sensitive.people).length} documentos, ${sensitive.passwords.length} contraseña(s)`);

    const sourceTip = git(repo, ['rev-parse', 'HEAD']).toString().trim();
    const commitsBefore = git(repo, ['rev-list', '--count', 'HEAD']).toString().trim();
    const originUrl = git(repo, ['remote', 'get-url', 'origin']).toString().trim();

    console.log(`clonando ${commitsBefore} commits en ${out}`);
    execFileSync('git', ['clone', '--no-local', '--quiet', repo, out], { stdio: 'inherit' });
    git(out, ['remote', 'set-url', 'origin', originUrl]);

    const filter = `node "${SELF.replace(/\\/g, '/')}" --index-filter "${sensitiveFile.replace(/\\/g, '/')}" "${cacheFile.replace(/\\/g, '/')}"`;
    console.log('reescribiendo (git filter-branch)…');
    execFileSync('git', ['-C', out, 'filter-branch', '--index-filter', filter, '--prune-empty', '--', '--all'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' },
    });

    for (const ref of git(out, ['for-each-ref', '--format=%(refname)', 'refs/original']).toString().split('\n').filter(Boolean)) {
      git(out, ['update-ref', '-d', ref]);
    }
    git(out, ['reflog', 'expire', '--expire=now', '--all']);
    git(out, ['gc', '--prune=now', '--quiet']);

    const commitsAfter = git(out, ['rev-list', '--count', 'HEAD']).toString().trim();
    const { findings, purgedStill } = verify(out, sensitive);

    // El último commit tiene que quedar igual que el original, salvo las rutas purgadas y
    // los textos reemplazados: así se ve qué cambia del código actual.
    const treeOf = (cwd, rev) => new Map(git(cwd, ['ls-tree', '-r', rev]).toString().split('\n').filter(Boolean)
      .map((l) => { const tab = l.indexOf('\t'); return [l.slice(tab + 1), l.slice(0, tab).split(' ')[2]]; }));
    const before = treeOf(repo, sourceTip);
    const after = treeOf(out, 'HEAD');
    const removedAtTip = [...before.keys()].filter((f) => !after.has(f));
    const changedAtTip = [...after.keys()].filter((f) => before.get(f) !== after.get(f));

    console.log('\n=== Resultado');
    console.log(`commits: ${commitsBefore} → ${commitsAfter}`);
    console.log(`commits que todavía tocan rutas purgadas: ${purgedStill.length}`);
    console.log(`archivos con contraseña o DNI en algún commit: ${findings.size}`);
    for (const [f, h] of findings) console.log(`  ${f}  contraseña=${h.passwords} dni=${h.docs}`);
    console.log(`último commit: ${removedAtTip.length} archivos sacados, ${changedAtTip.length} con texto reemplazado`);
    for (const f of changedAtTip) console.log(`  reemplazado: ${f}`);

    console.log(`
=== Para publicar (no se hizo)
1. Hacé privado el repo en GitHub, rotá las contraseñas, aplicá la migración y corré npm run upload:snapshots.
2. Push de la historia reescrita:
     git -C "${out}" push --force origin main
3. En tu copia de trabajo, con todo commiteado y las rutas purgadas fuera del índice
   (si no, el reset las borra del disco), alineate con la historia nueva:
     git fetch origin && git reset --hard origin/main
4. Pedí a GitHub Support que borre las vistas cacheadas y avisá a quien tenga clones o forks.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
