/**
 * Arranque rápido de cámara para el molinete.
 * Primero constraints livianos (facingMode); la resolución alta se pide después
 * si el dispositivo la aguanta. Enumerar cámaras antes de getUserMedia solo
 * suma latencia y, sin permiso, no trae labels útiles.
 */

export function pickBackCameraIndex(devices = []) {
  const videos = (devices || []).filter((d) => d?.kind === 'videoinput');
  if (!videos.length) return -1;
  const backIdx = videos.findIndex((d) =>
    /back|rear|environment|trasera|atrás|atras|world/i.test(String(d.label || ''))
  );
  if (backIdx >= 0) return backIdx;
  return Math.max(0, videos.length - 1);
}

/** Intentos ordenados: el primero debe abrir casi siempre en celulares. */
export function buildCameraConstraintAttempts(deviceId = null) {
  const id = deviceId ? { deviceId: { exact: deviceId } } : null;
  return [
    {
      audio: false,
      video: id
        ? { ...id, facingMode: { ideal: 'environment' } }
        : { facingMode: { ideal: 'environment' } },
    },
    {
      audio: false,
      video: id
        ? {
            ...id,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
    },
    {
      audio: false,
      video: id || { facingMode: { ideal: 'environment' } },
    },
    { audio: false, video: true },
  ];
}

/**
 * @param {(constraints: MediaStreamConstraints) => Promise<MediaStream>} getUserMedia
 * @param {string | null} deviceId
 */
export async function openCameraStream(getUserMedia, deviceId = null) {
  if (typeof getUserMedia !== 'function') {
    throw new Error('Sin cámara');
  }
  let lastErr = null;
  for (const constraints of buildCameraConstraintAttempts(deviceId)) {
    try {
      return await getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Sin cámara');
}

export function cameraErrorMessage(err) {
  const msg = String(err?.name || err?.message || err || '');
  if (/NotAllowed|Permission|Denied/i.test(msg)) {
    return 'Permití el acceso a la cámara para leer credenciales.';
  }
  if (/NotFound|DevicesNotFound/i.test(msg)) {
    return 'No se encontró cámara en este dispositivo.';
  }
  return 'No se pudo iniciar la cámara en este navegador.';
}
