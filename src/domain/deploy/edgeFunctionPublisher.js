import {
  EDGE_DEPLOY_LIMIT,
  authorizeEdgePayload,
  confirmDeployedEdge,
  edgeDeployRecovery,
  hashEdgePayload,
  payloadFromPackage,
} from './edgeFunctionRelease.js';

const TOKEN_RE = /(?:sbp_|supabase_?)[a-z0-9_-]{8,}/gi;

/** Nunca volcar tokens a logs ni a mensajes de error. */
export function redactSecrets(value) {
  return String(value ?? '').replace(TOKEN_RE, '[redacted]');
}

function sealPayload(prepared, confirm) {
  const payload = payloadFromPackage(prepared);
  const decision = authorizeEdgePayload(prepared, payload);
  if (!decision.ok) {
    return {
      ok: false,
      payload: null,
      problems: decision.problems,
      recovery: edgeDeployRecovery(prepared?.slug, prepared?.manifest),
    };
  }
  if (confirm !== prepared.manifest.packageSha256) {
    return {
      ok: false,
      payload: null,
      problems: ['La confirmación no es el hash del paquete autorizado. No se publica.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
    };
  }
  const hashed = hashEdgePayload(payload.files);
  if (hashed.packageSha256 !== prepared.manifest.packageSha256) {
    return {
      ok: false,
      payload: null,
      problems: ['El hash del envío no es el del paquete autorizado.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
    };
  }
  return { ok: true, payload, problems: [], recovery: null };
}

/**
 * Publica solo el paquete ya leído del disco.
 * Vuelve a hashear inmediatamente antes del envío.
 * Si hay fetchDeployed, compara la lectura remota con el manifiesto.
 */
export async function publishAuthorizedEdgeFunction({
  prepared,
  confirm,
  upload,
  fetchDeployed,
} = {}) {
  const sealed = sealPayload(prepared, confirm);
  if (!sealed.ok) {
    return {
      deployed: false,
      cancelled: true,
      verifyFailed: false,
      providerError: false,
      problems: sealed.problems,
      recovery: sealed.recovery,
      manifest: prepared?.manifest || null,
    };
  }
  if (typeof upload !== 'function') {
    return {
      deployed: false,
      cancelled: true,
      verifyFailed: false,
      providerError: false,
      problems: [EDGE_DEPLOY_LIMIT, 'No hay un publicador conectado. No se llama a la API.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    };
  }

  // Segundo sello: nada puede haberse agregado después del hash confirmado.
  const again = sealPayload(prepared, confirm);
  if (!again.ok || again.payload.files.length !== sealed.payload.files.length) {
    return {
      deployed: false,
      cancelled: true,
      verifyFailed: false,
      providerError: false,
      problems: again.problems.length
        ? again.problems
        : ['El paquete cambió después de calcular el hash. No se publica.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    };
  }
  for (let i = 0; i < sealed.payload.files.length; i += 1) {
    const a = sealed.payload.files[i];
    const b = again.payload.files[i];
    if (a.name !== b.name || a.content !== b.content) {
      return {
        deployed: false,
        cancelled: true,
        verifyFailed: false,
        providerError: false,
        problems: ['El paquete cambió después de calcular el hash. No se publica.'],
        recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
        manifest: prepared.manifest,
      };
    }
  }

  let uploadResult;
  try {
    uploadResult = await upload(again.payload);
  } catch (error) {
    return {
      deployed: false,
      cancelled: false,
      verifyFailed: false,
      providerError: true,
      problems: [redactSecrets(error instanceof Error ? error.message : String(error))],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    };
  }

  if (typeof fetchDeployed !== 'function') {
    return {
      deployed: true,
      cancelled: false,
      verifyFailed: false,
      providerError: false,
      problems: [],
      recovery: null,
      manifest: prepared.manifest,
      uploadResult,
      warning: 'Se publicó sin lectura de verificación remota.',
    };
  }

  let remoteFiles;
  try {
    remoteFiles = await fetchDeployed({
      payload: again.payload,
      uploadResult,
    });
  } catch (error) {
    return {
      deployed: false,
      cancelled: false,
      verifyFailed: true,
      providerError: true,
      problems: [
        'No se pudo leer la versión desplegada para verificarla.',
        redactSecrets(error instanceof Error ? error.message : String(error)),
      ],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
      uploadResult,
    };
  }

  const check = confirmDeployedEdge(prepared, remoteFiles);
  if (!check.ok) {
    return {
      deployed: false,
      cancelled: false,
      verifyFailed: true,
      providerError: false,
      problems: check.problems,
      recovery: check.recovery,
      manifest: prepared.manifest,
      uploadResult,
    };
  }

  return {
    deployed: true,
    cancelled: false,
    verifyFailed: false,
    providerError: false,
    problems: [],
    recovery: null,
    manifest: prepared.manifest,
    uploadResult,
  };
}

/** Publicador de simulacro: recibe exactamente el paquete sellado y lo guarda en memoria. */
export function createSimulatedEdgeUploader(store = { bySlug: new Map() }) {
  return {
    mode: 'simulate',
    store,
    async upload(payload) {
      const copy = {
        slug: payload.slug,
        files: payload.files.map((file) => ({ name: file.name, content: file.content })),
        packageSha256: hashEdgePayload(payload.files).packageSha256,
        receivedAt: new Date().toISOString(),
      };
      store.bySlug.set(payload.slug, copy);
      return { ok: true, slug: payload.slug, packageSha256: copy.packageSha256, mode: 'simulate' };
    },
    async fetchDeployed({ payload }) {
      const saved = store.bySlug.get(payload.slug);
      if (!saved) throw new Error('El simulacro no tiene una versión desplegada.');
      return saved.files.map((file) => ({ name: file.name, content: file.content }));
    },
  };
}

/**
 * Publicador real vía Management API de Supabase.
 * Solo envía el multipart armado desde el paquete validado en disco.
 */
export function createSupabaseEdgeUploader({
  projectRef,
  accessToken,
  fetchImpl = globalThis.fetch,
  apiBase = 'https://api.supabase.com',
} = {}) {
  const ref = String(projectRef || '').trim();
  const token = String(accessToken || '').trim();
  if (!ref || !token) {
    throw new Error('Faltan projectRef o accessToken del publicador. No se publica.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('No hay fetch disponible para el publicador.');
  }

  return {
    mode: 'supabase',
    async upload(payload) {
      const form = new FormData();
      form.append('metadata', JSON.stringify({
        name: payload.slug,
        entrypoint_path: 'index.ts',
        verify_jwt: true,
      }));
      for (const file of payload.files) {
        form.append(
          'file',
          new Blob([file.content], { type: 'application/typescript' }),
          file.name,
        );
      }
      const url = `${apiBase}/v1/projects/${encodeURIComponent(ref)}/functions/deploy?slug=${encodeURIComponent(payload.slug)}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Proveedor ${response.status}: ${redactSecrets(text || response.statusText)}`);
      }
      try {
        return text ? JSON.parse(text) : { slug: payload.slug };
      } catch {
        return { slug: payload.slug, raw: redactSecrets(text) };
      }
    },
    async fetchDeployed({ payload }) {
      const url = `${apiBase}/v1/projects/${encodeURIComponent(ref)}/functions/${encodeURIComponent(payload.slug)}/body`;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Lectura remota ${response.status}: ${redactSecrets(text || response.statusText)}`);
      }
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          'La API devolvió un cuerpo no JSON (posible eszip). No se puede verificar fuente contra el manifiesto con esta respuesta.',
        );
      }
      if (Array.isArray(body?.files)) {
        return body.files.map((file) => ({
          name: String(file.name || file.path || ''),
          content: String(file.content ?? file.source ?? ''),
        }));
      }
      if (Array.isArray(body)) {
        return body.map((file) => ({
          name: String(file.name || file.path || ''),
          content: String(file.content ?? file.source ?? ''),
        }));
      }
      throw new Error(
        'La lectura remota no expone los archivos fuente. Limitación de la API: la verificación byte-a-byte queda bloqueada.',
      );
    },
  };
}
