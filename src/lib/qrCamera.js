/**
 * Arranque de cámara para el molinete (Chrome desktop + celular).
 * En escritorio facingMode "environment" suele fallar o demorar: se prioriza
 * video:true y recién después se afina. Enumerar cámaras antes del permiso
 * no aporta labels útiles.
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

function isLikelyMobile() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS 13+ se reporta como Mac; touch points delatan tablet.
  if (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

/** Intentos ordenados según dispositivo. */
export function buildCameraConstraintAttempts(deviceId = null) {
  const id = deviceId ? { deviceId: { exact: deviceId } } : null;
  const mobile = isLikelyMobile();

  if (id) {
    return [
      {
        audio: false,
        video: {
          ...id,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { audio: false, video: id },
      { audio: false, video: true },
    ];
  }

  if (mobile) {
    return [
      {
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true },
    ];
  }

  // Chrome escritorio: video:true primero (facingMode environment suele fallar).
  return [
    { audio: false, video: true },
    {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    },
    {
      audio: false,
      video: { facingMode: { ideal: 'user' } },
    },
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
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    const err = new Error('La cámara requiere HTTPS (o localhost).');
    err.name = 'SecurityError';
    throw err;
  }
  let lastErr = null;
  for (const constraints of buildCameraConstraintAttempts(deviceId)) {
    try {
      return await getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Permiso denegado: no tiene sentido seguir intentando.
      if (/NotAllowed|PermissionDenied|SecurityError/i.test(String(err?.name || ''))) {
        throw err;
      }
    }
  }
  throw lastErr || new Error('Sin cámara');
}

export function cameraErrorMessage(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || err || '');
  const blob = `${name} ${msg}`;
  if (/NotAllowed|Permission|Denied/i.test(blob)) {
    return 'Chrome bloqueó la cámara. Tocá el candado de la barra de dirección → Cámara → Permitir, y reintentá.';
  }
  if (/NotFound|DevicesNotFound/i.test(blob)) {
    return 'No se encontró cámara en este dispositivo.';
  }
  if (/NotReadable|TrackStart|Could not start|in use|Device in use/i.test(blob)) {
    return 'La cámara está en uso por otra app o pestaña. Cerrala y reintentá.';
  }
  if (/Overconstrained/i.test(blob)) {
    return 'Esta cámara no acepta el modo pedido. Probá Reintentar o Cambiar cámara.';
  }
  if (/SecurityError|HTTPS|secure context/i.test(blob)) {
    return 'La cámara solo funciona en HTTPS o en localhost.';
  }
  if (/AbortError/i.test(blob)) {
    return 'Se canceló el acceso a la cámara. Reintentá.';
  }
  return 'No se pudo iniciar la cámara en este navegador. Probá Reintentar o usá la pistola / búsqueda.';
}
