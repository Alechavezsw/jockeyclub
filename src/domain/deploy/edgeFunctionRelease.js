import { createHash } from 'node:crypto';

/**
 * Este control corre en el comando de publicación, antes de armar el envío y
 * después, contra lo que se leyó de la versión desplegada. No intercepta una
 * llamada directa a la API de Supabase: quien tenga el token puede reemplazar
 * la función sin pasar por acá. El token de despliegue tiene que vivir en el
 * CI, no en una sesión interactiva.
 */
export const EDGE_DEPLOY_LIMIT =
  'Este control no intercepta una llamada directa a la API de Supabase. Quien tenga el token puede reemplazar la función sin pasar por acá. El token de despliegue tiene que vivir en el CI, no en una sesión interactiva.';

const WHOLE_FILE_MARKER = /^(?:PLACEHOLDER|TODO|STUB|FIXME)(?:_DO_NOT_DEPLOY)?$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeNewlines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

/** Mismo manifiesto que el paquete leído del disco: nombre ordenado y SHA-256. */
export function hashEdgePayload(files) {
  const listed = [...(files || [])]
    .map((file) => ({
      name: String(file?.name || ''),
      sha256: sha256(String(file?.content ?? '')),
      bytes: new TextEncoder().encode(String(file?.content ?? '')).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return {
    files: listed,
    packageSha256: sha256(listed.map((file) => `${file.name}:${file.sha256}`).join('\n')),
  };
}

/** El envío sale solo de los archivos que el paquete ya validó. */
export function payloadFromPackage(prepared) {
  if (!prepared?.ok || !prepared.manifest?.packageSha256 || !prepared.files?.length) return null;
  return {
    slug: prepared.slug,
    files: prepared.files.map((file) => ({ name: file.name, content: file.content })),
    manifest: prepared.manifest,
  };
}

export function edgeDeployRecovery(slug, manifest) {
  const hash = manifest?.packageSha256 || '';
  return {
    slug: slug || '',
    packageSha256: hash,
    steps: [
      `La función ${slug || '(sin nombre)'} no coincide con el paquete autorizado${hash ? ` ${hash}` : ''}.`,
      'Volvé a publicar leyendo el mismo commit con scripts/deploy-edge-function.mjs. No pegues el fuente a mano ni recortes archivos.',
      'Si la versión activa quedó incompleta, el publicador del CI tiene que subir de nuevo ese paquete y recién entonces comparar la lectura con el manifiesto.',
      EDGE_DEPLOY_LIMIT,
    ],
  };
}

function fileProblems(file) {
  const content = String(file?.content ?? '');
  if (!String(file?.name || '').trim()) return ['Hay un archivo sin nombre.'];
  if (!content.trim() || WHOLE_FILE_MARKER.test(content.trim())) {
    return [`${file.name} está vacío o es un marcador.`];
  }
  return [];
}

/**
 * Compara el paquete validado con lo que se va a enviar.
 * Un archivo de más, de menos, truncado o distinto no pasa.
 */
export function authorizeEdgePayload(prepared, payload) {
  const problems = [];
  if (!prepared?.ok || !prepared.manifest?.packageSha256) {
    problems.push(...(prepared?.problems?.length ? prepared.problems : ['Paquete inválido. No se publica.']));
    return { ok: false, problems, manifest: prepared?.manifest || null };
  }
  if (!payload || payload.slug !== prepared.slug) {
    problems.push('El envío no es el de la función autorizada.');
  }
  const expected = new Map((prepared.files || []).map((file) => [file.name, file.content]));
  const sent = payload?.files || [];
  if (sent.length !== expected.size) {
    problems.push('La cantidad de archivos del envío no coincide con el paquete autorizado.');
  }
  const seen = new Set();
  for (const file of sent) {
    problems.push(...fileProblems(file));
    if (seen.has(file.name)) problems.push(`${file.name} está repetido en el envío.`);
    seen.add(file.name);
    if (!expected.has(file.name)) {
      problems.push(`${file.name} no está en el paquete autorizado.`);
      continue;
    }
    if (file.content !== expected.get(file.name)) {
      problems.push(`${file.name} no coincide con el archivo del repositorio.`);
    }
  }
  for (const name of expected.keys()) {
    if (!seen.has(name)) problems.push(`Falta ${name} en lo que se va a publicar.`);
  }
  const hashed = hashEdgePayload(sent);
  if (hashed.packageSha256 !== prepared.manifest.packageSha256) {
    problems.push('El hash del envío no es el del paquete autorizado.');
  }
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique, manifest: prepared.manifest };
}

/**
 * Publica solo el paquete leído del disco, y solo si la confirmación es su hash.
 * Sin publicador no llama a ninguna API.
 */
export function publishEdgeFunction({ prepared, confirm, upload } = {}) {
  const payload = payloadFromPackage(prepared);
  const decision = authorizeEdgePayload(prepared, payload);
  if (!decision.ok) {
    return {
      deployed: false,
      cancelled: true,
      problems: decision.problems,
      recovery: edgeDeployRecovery(prepared?.slug, prepared?.manifest),
    };
  }
  if (confirm !== prepared.manifest.packageSha256) {
    return {
      deployed: false,
      cancelled: true,
      problems: ['La confirmación no es el hash del paquete autorizado. No se publica.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
    };
  }
  if (typeof upload !== 'function') {
    return {
      deployed: false,
      cancelled: true,
      problems: [EDGE_DEPLOY_LIMIT, 'No hay un publicador conectado. No se llama a la API.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
    };
  }
  upload(payload);
  return { deployed: true, cancelled: false, manifest: prepared.manifest, problems: [], recovery: null };
}

/** La lectura de la versión desplegada tiene que ser el mismo fuente, salvo el fin de línea. */
export function confirmDeployedEdge(prepared, remoteFiles) {
  const problems = [];
  if (!prepared?.ok || !prepared.files?.length) {
    problems.push('No hay un paquete autorizado para comparar.');
  }
  const expected = new Map((prepared?.files || []).map((file) => [file.name, file.content]));
  const remote = Array.isArray(remoteFiles) ? remoteFiles : [];
  const seen = new Set();
  for (const file of remote) {
    if (seen.has(file?.name)) problems.push(`${file.name} está repetido en la versión desplegada.`);
    seen.add(file?.name);
    if (!expected.has(file?.name)) {
      problems.push(`${file?.name || '(sin nombre)'} no estaba en el paquete autorizado.`);
      continue;
    }
    const sameBytes = file.content === expected.get(file.name);
    const sameText = normalizeNewlines(file.content) === normalizeNewlines(expected.get(file.name));
    if (!sameBytes && !sameText) {
      problems.push(`${file.name} desplegado no coincide con el repositorio.`);
    }
  }
  for (const name of expected.keys()) {
    if (!seen.has(name)) problems.push(`Falta ${name} en la versión desplegada.`);
  }
  const unique = [...new Set(problems)];
  const ok = unique.length === 0 && expected.size > 0;
  return {
    ok,
    problems: unique,
    recovery: ok ? null : edgeDeployRecovery(prepared?.slug, prepared?.manifest),
  };
}
