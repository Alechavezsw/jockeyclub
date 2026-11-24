import {
  EDGE_DEPLOY_LIMIT,
  authorizeEdgePayload,
  confirmDeployedEdge,
  edgeDeployRecovery,
  hashEdgePayload,
  payloadFromPackage,
} from './edgeFunctionRelease.js';

const TOKEN_RE = /(?:sbp_|supabase_?)[a-z0-9_-]{8,}/gi;

/** Estados canónicos del pipeline. Un simulacro nunca es una publicación. */
export const EDGE_DEPLOY_STATUS = Object.freeze({
  SIMULATED: 'simulated',
  PUBLISHED_VERIFIED: 'published_verified',
  PUBLISHED_UNVERIFIED: 'published_unverified',
  FAILED: 'failed',
});

export const REMOTE_SOURCE_LIMITATION =
  'Supabase devolvió un paquete opaco (p. ej. eszip) sin archivos fuente. No hay verificación byte a byte del manifiesto.';

/** Nunca volcar tokens a logs ni a mensajes de error. */
export function redactSecrets(value) {
  return String(value ?? '').replace(TOKEN_RE, '[redacted]');
}

export function summarizeDeployOutcome(result) {
  const status = result?.status || EDGE_DEPLOY_STATUS.FAILED;
  return {
    status,
    simulated: status === EDGE_DEPLOY_STATUS.SIMULATED,
    published: status === EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED
      || status === EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED,
    verified: status === EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED,
    unverified: status === EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED,
    failed: status === EDGE_DEPLOY_STATUS.FAILED,
    packageSha256: result?.manifest?.packageSha256 || '',
    limitation: result?.limitation || '',
  };
}

function outcome({
  status,
  problems = [],
  recovery = null,
  manifest = null,
  uploadResult = null,
  limitation = '',
  cancelled = false,
  providerError = false,
  verifyFailed = false,
} = {}) {
  const published = status === EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED
    || status === EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED;
  return {
    status,
    // Compatibilidad: deployed solo si hubo publicación real (nunca simulacro).
    deployed: published,
    cancelled,
    verifyFailed,
    providerError,
    problems,
    recovery,
    manifest,
    uploadResult,
    limitation,
    summary: summarizeDeployOutcome({ status, manifest, limitation }),
  };
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

/** Normaliza la lectura remota: fuentes, opaco o error. No inventa hashes. */
export function interpretRemoteDeployRead(remote) {
  if (!remote || typeof remote !== 'object') {
    return {
      kind: 'error',
      problems: ['La lectura remota está vacía o es inválida.'],
    };
  }
  if (remote.kind === 'opaque') {
    return {
      kind: 'opaque',
      limitation: String(remote.limitation || REMOTE_SOURCE_LIMITATION),
      files: null,
    };
  }
  if (remote.kind === 'sources' || Array.isArray(remote.files) || Array.isArray(remote)) {
    const files = Array.isArray(remote.files)
      ? remote.files
      : (Array.isArray(remote) ? remote : []);
    return { kind: 'sources', files, limitation: '' };
  }
  if (remote.kind === 'error') {
    return {
      kind: 'error',
      problems: (remote.problems || [remote.message || 'Error de lectura remota']).map(redactSecrets),
    };
  }
  return {
    kind: 'error',
    problems: ['Formato de lectura remota desconocido. No se inventan hashes.'],
  };
}

/**
 * Publica solo el paquete ya leído del disco.
 * Vuelve a hashear inmediatamente antes del envío.
 * mode=simulate → status simulated (nunca published_*).
 * unverifiedPolicy: 'fail' (default) detiene; 'accept' deja published_unverified.
 */
export async function publishAuthorizedEdgeFunction({
  prepared,
  confirm,
  upload,
  fetchDeployed,
  mode = 'supabase',
  unverifiedPolicy = 'fail',
} = {}) {
  const simulate = mode === 'simulate';
  const sealed = sealPayload(prepared, confirm);
  if (!sealed.ok) {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      cancelled: true,
      problems: sealed.problems,
      recovery: sealed.recovery,
      manifest: prepared?.manifest || null,
    });
  }
  if (typeof upload !== 'function') {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      cancelled: true,
      problems: [EDGE_DEPLOY_LIMIT, 'No hay un publicador conectado. No se llama a la API.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    });
  }

  const again = sealPayload(prepared, confirm);
  if (!again.ok || again.payload.files.length !== sealed.payload.files.length) {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      cancelled: true,
      problems: again.problems.length
        ? again.problems
        : ['El paquete cambió después de calcular el hash. No se publica.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    });
  }
  for (let i = 0; i < sealed.payload.files.length; i += 1) {
    const a = sealed.payload.files[i];
    const b = again.payload.files[i];
    if (a.name !== b.name || a.content !== b.content) {
      return outcome({
        status: EDGE_DEPLOY_STATUS.FAILED,
        cancelled: true,
        problems: ['El paquete cambió después de calcular el hash. No se publica.'],
        recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
        manifest: prepared.manifest,
      });
    }
  }

  let uploadResult;
  try {
    uploadResult = await upload(again.payload);
  } catch (error) {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      providerError: true,
      problems: [redactSecrets(error instanceof Error ? error.message : String(error))],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
    });
  }

  if (simulate) {
    // Aunque el store interno coincida, no es una publicación productiva.
    return outcome({
      status: EDGE_DEPLOY_STATUS.SIMULATED,
      problems: [],
      recovery: null,
      manifest: prepared.manifest,
      uploadResult,
      limitation: 'Simulacro local: no hubo publicación en Supabase.',
    });
  }

  if (typeof fetchDeployed !== 'function') {
    const limitation = 'Se publicó sin lectura de verificación remota. No hay verificación byte a byte.';
    const recovery = edgeDeployRecovery(prepared.slug, prepared.manifest);
    if (unverifiedPolicy === 'accept') {
      return outcome({
        status: EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED,
        problems: [limitation],
        recovery,
        manifest: prepared.manifest,
        uploadResult,
        limitation,
      });
    }
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      verifyFailed: true,
      problems: [limitation, 'Política de despliegue: sin verificación remota no se acepta el release.'],
      recovery,
      manifest: prepared.manifest,
      uploadResult,
      limitation,
    });
  }

  let remoteRaw;
  try {
    remoteRaw = await fetchDeployed({
      payload: again.payload,
      uploadResult,
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    const limitation = /eszip|opaco|sin archivos fuente|byte a byte/i.test(message)
      ? REMOTE_SOURCE_LIMITATION
      : '';
    if (limitation && unverifiedPolicy === 'accept') {
      return outcome({
        status: EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED,
        problems: [limitation, message],
        recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
        manifest: prepared.manifest,
        uploadResult,
        limitation,
      });
    }
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      verifyFailed: true,
      providerError: !limitation,
      problems: [
        limitation || 'No se pudo leer la versión desplegada para verificarla.',
        message,
      ],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
      uploadResult,
      limitation,
    });
  }

  const remote = interpretRemoteDeployRead(remoteRaw);
  if (remote.kind === 'opaque') {
    const recovery = edgeDeployRecovery(prepared.slug, prepared.manifest);
    if (unverifiedPolicy === 'accept') {
      return outcome({
        status: EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED,
        problems: [remote.limitation, 'No se inventaron hashes remotos.'],
        recovery,
        manifest: prepared.manifest,
        uploadResult,
        limitation: remote.limitation,
      });
    }
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      verifyFailed: true,
      problems: [
        remote.limitation,
        'Política de despliegue: sin fuentes remotas comparables el release no queda verificado.',
      ],
      recovery,
      manifest: prepared.manifest,
      uploadResult,
      limitation: remote.limitation,
    });
  }

  if (remote.kind !== 'sources') {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      verifyFailed: true,
      problems: remote.problems || ['Lectura remota inválida.'],
      recovery: edgeDeployRecovery(prepared.slug, prepared.manifest),
      manifest: prepared.manifest,
      uploadResult,
    });
  }

  const check = confirmDeployedEdge(prepared, remote.files);
  if (!check.ok) {
    return outcome({
      status: EDGE_DEPLOY_STATUS.FAILED,
      verifyFailed: true,
      problems: check.problems,
      recovery: check.recovery,
      manifest: prepared.manifest,
      uploadResult,
    });
  }

  return outcome({
    status: EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED,
    problems: [],
    recovery: null,
    manifest: prepared.manifest,
    uploadResult,
  });
}

/** Publicador de simulacro: recibe el paquete sellado en memoria. No toca producción. */
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
      return {
        ok: true,
        slug: payload.slug,
        packageSha256: copy.packageSha256,
        mode: 'simulate',
        published: false,
      };
    },
    async fetchDeployed({ payload }) {
      const saved = store.bySlug.get(payload.slug);
      if (!saved) {
        return { kind: 'error', problems: ['El simulacro no tiene una versión guardada.'] };
      }
      return {
        kind: 'sources',
        files: saved.files.map((file) => ({ name: file.name, content: file.content })),
      };
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
        return {
          kind: 'error',
          problems: [`Lectura remota ${response.status}: ${redactSecrets(text || response.statusText)}`],
        };
      }
      // Binario / eszip: no JSON → opaco, sin inventar hash remoto.
      if (text && (text.startsWith('EZBR') || text.charCodeAt(0) === 0x45 && text.includes('\0'))) {
        return { kind: 'opaque', limitation: REMOTE_SOURCE_LIMITATION };
      }
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return { kind: 'opaque', limitation: REMOTE_SOURCE_LIMITATION };
      }
      if (Array.isArray(body?.files)) {
        return {
          kind: 'sources',
          files: body.files.map((file) => ({
            name: String(file.name || file.path || ''),
            content: String(file.content ?? file.source ?? ''),
          })),
        };
      }
      if (Array.isArray(body)) {
        return {
          kind: 'sources',
          files: body.map((file) => ({
            name: String(file.name || file.path || ''),
            content: String(file.content ?? file.source ?? ''),
          })),
        };
      }
      return { kind: 'opaque', limitation: REMOTE_SOURCE_LIMITATION };
    },
  };
}
