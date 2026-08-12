import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Flashlight, FlashlightOff, ImagePlus, RefreshCw } from 'lucide-react';

let jsQRPromise = null;
let zxingReaderPromise = null;

function loadJsQR() {
  if (!jsQRPromise) {
    jsQRPromise = import('jsqr').then((m) => m.default || m);
  }
  return jsQRPromise;
}

function loadZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      // TRY_HARDER + pure barcode improves phone-screen reads
      return new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 0,
        delayBetweenScanSuccess: 0,
      });
    });
  }
  return zxingReaderPromise;
}

function capAt(range, t) {
  if (!range || typeof range !== 'object') return undefined;
  const { min, max } = range;
  if (!(max > min)) return undefined;
  return min + (max - min) * Math.min(1, Math.max(0, t));
}

async function detectNative(detector, source) {
  if (!detector || !source) return '';
  try {
    const codes = await detector.detect(source);
    return codes?.[0]?.rawValue || '';
  } catch {
    return '';
  }
}

async function decodeJsQR(imageData) {
  try {
    const jsQR = await loadJsQR();
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });
    return code?.data || '';
  } catch {
    return '';
  }
}

async function decodeZxingCanvas(canvas) {
  try {
    const reader = await loadZxingReader();
    const result = await reader.decodeFromCanvas(canvas);
    return result?.getText?.() || result?.text || '';
  } catch {
    return '';
  }
}

/**
 * Lector QR optimizado para credencial en pantalla de celular a corta distancia.
 * Prioridad: BarcodeDetector nativo → ZXing → jsQR (con downscale si el QR está muy cerca).
 */
export default function QrLiveScanner({
  active = false,
  onDecode,
  onError,
  paused = false,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cropCanvasRef = useRef(null);
  const scaleCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null);
  const detectorRef = useRef(null);
  const lastDecodeRef = useRef('');
  const lastDecodeAtRef = useRef(0);
  const devicesRef = useRef([]);
  const deviceIndexRef = useRef(0);
  const focusTimerRef = useRef(0);
  const loopTokenRef = useRef(0);
  const fileInputRef = useRef(null);
  const tickRef = useRef(0);

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState('Acercá el QR al marco');
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);

  const stopStream = useCallback(() => {
    loopTokenRef.current += 1;
    if (focusTimerRef.current) {
      clearInterval(focusTimerRef.current);
      focusTimerRef.current = 0;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    trackRef.current = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setTorchOn(false);
    setTorchSupported(false);
    setLive(false);
  }, []);

  /** Solo foco continuo cercano — sin subexponer (eso impedía leer). */
  const applyCloseFocus = useCallback(async (track) => {
    if (!track?.applyConstraints) return;
    const caps = track.getCapabilities?.() || {};

    try {
      const modes = {};
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('continuous')) modes.focusMode = 'continuous';
        else if (caps.focusMode.includes('auto')) modes.focusMode = 'auto';
      }
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        modes.exposureMode = 'continuous';
      }
      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
        modes.whiteBalanceMode = 'continuous';
      }
      if (Object.keys(modes).length) {
        await track.applyConstraints({ advanced: [modes] });
      }
    } catch {
      /* ignore */
    }

    // Ligera compensación (casi neutra) + nitidez
    const tune = {};
    const ev = capAt(caps.exposureCompensation, 0.45);
    if (ev != null) tune.exposureCompensation = ev;
    const sharp = capAt(caps.sharpness, 0.9);
    if (sharp != null) tune.sharpness = sharp;
    const contrast = capAt(caps.contrast, 0.65);
    if (contrast != null) tune.contrast = contrast;
    if (Object.keys(tune).length) {
      try {
        await track.applyConstraints({ advanced: [tune] });
      } catch {
        /* ignore */
      }
    }

    try {
      const near = capAt(caps.focusDistance, 0.12);
      if (near != null) {
        await track.applyConstraints({ advanced: [{ focusDistance: near }] });
      }
    } catch {
      /* ignore */
    }

    try {
      if (caps.torch) await track.applyConstraints({ advanced: [{ torch: false }] });
    } catch {
      /* ignore */
    }
  }, []);

  const emitDecode = useCallback((text) => {
    if (!text) return false;
    const now = Date.now();
    if (text === lastDecodeRef.current && now - lastDecodeAtRef.current < 1200) return false;
    lastDecodeRef.current = text;
    lastDecodeAtRef.current = now;
    onDecode?.(text);
    setHint('¡QR leído!');
    return true;
  }, [onDecode]);

  const drawVideo = useCallback((video, canvas, ctx, maxW) => {
    const scale = Math.min(1, maxW / video.videoWidth);
    const w = Math.max(1, Math.floor(video.videoWidth * scale));
    const h = Math.max(1, Math.floor(video.videoHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    return { w, h };
  }, []);

  const cropCenter = useCallback((sourceCanvas, ratio) => {
    if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement('canvas');
    const crop = cropCanvasRef.current;
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const cw = Math.max(32, Math.floor(sw * ratio));
    const ch = Math.max(32, Math.floor(sh * ratio));
    const cx = Math.floor((sw - cw) / 2);
    const cy = Math.floor((sh - ch) / 2);
    if (crop.width !== cw || crop.height !== ch) {
      crop.width = cw;
      crop.height = ch;
    }
    const cctx = crop.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(sourceCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
    return crop;
  }, []);

  const downscaleCanvas = useCallback((source, maxSide) => {
    const longest = Math.max(source.width, source.height);
    if (longest <= maxSide) return source;
    if (!scaleCanvasRef.current) scaleCanvasRef.current = document.createElement('canvas');
    const out = scaleCanvasRef.current;
    const scale = maxSide / longest;
    out.width = Math.max(32, Math.floor(source.width * scale));
    out.height = Math.max(32, Math.floor(source.height * scale));
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }, []);

  const tryDecodeFrame = useCallback(async (video, canvas, ctx) => {
    if (!video.videoWidth) return '';

    // Frame a 960px + nativo (el caller ya probó detect sobre el <video>)
    drawVideo(video, canvas, ctx, 960);
    let text = await detectNative(detectorRef.current, canvas);
    if (text) return text;

    tickRef.current += 1;
    // En cercanía el QR llena el marco: probar ROI chicos primero
    const ratios = tickRef.current % 2 === 0
      ? [0.48, 0.62, 0.8]
      : [0.55, 0.72, 1];

    for (const ratio of ratios) {
      const roi = ratio >= 0.999 ? canvas : cropCenter(canvas, ratio);

      text = await detectNative(detectorRef.current, roi);
      if (text) return text;

      // ZXing sobre ROI (muy bueno con pantallas)
      text = await decodeZxingCanvas(roi);
      if (text) return text;

      // Si el QR está muy cerca, downscale ayuda a jsQR/ZXing
      const small = downscaleCanvas(roi, 420);
      if (small !== roi) {
        text = await detectNative(detectorRef.current, small);
        if (text) return text;
        text = await decodeZxingCanvas(small);
        if (text) return text;
      }

      // jsQR solo en ROI reducido (caro)
      const target = small !== roi ? small : downscaleCanvas(roi, 480);
      const tctx = target.getContext('2d', { willReadFrequently: true });
      text = await decodeJsQR(tctx.getImageData(0, 0, target.width, target.height));
      if (text) return text;
    }

    return '';
  }, [cropCenter, downscaleCanvas, drawVideo]);

  const startWithDevice = useCallback(async (deviceId) => {
    stopStream();
    setStarting(true);
    setHint('Iniciando cámara…');
    void loadJsQR();
    void loadZxingReader();

    const attempts = [
      {
        audio: false,
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: 'environment' },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      },
      {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' } },
      },
      { audio: false, video: true },
    ];

    try {
      let stream = null;
      let lastErr = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!stream) throw lastErr || new Error('Sin cámara');

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      const video = videoRef.current;
      if (!video) throw new Error('Video no disponible');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      try {
        await video.play();
      } catch {
        /* ignore */
      }

      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve();
        else {
          video.onloadeddata = () => resolve();
          setTimeout(resolve, 1000);
        }
      });

      await applyCloseFocus(track);
      // Re-pedir foco cercano sin tocar brillo cada tanto
      focusTimerRef.current = window.setInterval(() => {
        const t = trackRef.current;
        if (!t?.applyConstraints) return;
        const caps = t.getCapabilities?.() || {};
        const near = capAt(caps.focusDistance, 0.12);
        if (near == null) return;
        t.applyConstraints({ advanced: [{ focusDistance: near }] }).catch(() => {});
      }, 3500);

      const caps = track.getCapabilities?.() || {};
      setTorchSupported(Boolean(caps.torch));

      detectorRef.current = null;
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if (!formats || formats.includes('qr_code')) {
            detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch {
          try {
            detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            detectorRef.current = null;
          }
        }
      }

      setLive(true);
      setHint('Acercá el QR al marco · lectura al instante');
      setStarting(false);
      onError?.('');
    } catch (err) {
      setStarting(false);
      setLive(false);
      stopStream();
      const msg = String(err?.name || err?.message || err || '');
      onError?.(
        /NotAllowed|Permission|Denied/i.test(msg)
          ? 'Permití el acceso a la cámara para leer credenciales.'
          : /NotFound|DevicesNotFound/i.test(msg)
            ? 'No se encontró cámara en este dispositivo.'
            : 'No se pudo iniciar la cámara. Usá HTTPS o cargá una foto del QR.'
      );
    }
  }, [applyCloseFocus, onError, stopStream]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Este dispositivo no soporta cámara en el navegador.');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      devicesRef.current = videos;
      const backIdx = videos.findIndex((d) =>
        /back|rear|environment|trasera|atrás|atras|world/i.test(d.label || '')
      );
      deviceIndexRef.current = backIdx >= 0 ? backIdx : Math.max(0, videos.length - 1);
      await startWithDevice(videos[deviceIndexRef.current]?.deviceId || null);
      try {
        const after = await navigator.mediaDevices.enumerateDevices();
        devicesRef.current = after.filter((d) => d.kind === 'videoinput');
      } catch {
        /* ignore */
      }
    } catch {
      await startWithDevice(null);
    }
  }, [onError, startWithDevice]);

  const switchCamera = useCallback(async () => {
    const list = devicesRef.current;
    if (!list.length) {
      await startCamera();
      return;
    }
    deviceIndexRef.current = (deviceIndexRef.current + 1) % list.length;
    await startWithDevice(list[deviceIndexRef.current]?.deviceId || null);
  }, [startCamera, startWithDevice]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track?.applyConstraints || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
      setHint(next ? 'Linterna ON (mejor apagada con pantallas)' : 'Acercá el QR al marco');
    } catch {
      setHint('Linterna no disponible');
    }
  }, [torchOn, torchSupported]);

  const focusAt = useCallback(async (clientX, clientY) => {
    const track = trackRef.current;
    const video = videoRef.current;
    if (!track?.applyConstraints || !video) return;
    const rect = video.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const caps = track.getCapabilities?.() || {};
    try {
      setHint('Enfocando…');
      if (caps.pointsOfInterest) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x, y }] }],
        });
      }
      await applyCloseFocus(track);
      setTimeout(() => setHint('Acercá el QR al marco · lectura al instante'), 600);
    } catch {
      applyCloseFocus(track);
    }
  }, [applyCloseFocus]);

  const decodeFromFile = useCallback(async (file) => {
    if (!file) return;
    setHint('Leyendo imagen…');
    try {
      const bmp = await createImageBitmap(file);
      const canvas = canvasRef.current || document.createElement('canvas');
      const maxW = 1400;
      const scale = Math.min(1, maxW / bmp.width);
      canvas.width = Math.max(1, Math.floor(bmp.width * scale));
      canvas.height = Math.max(1, Math.floor(bmp.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();

      let text = await detectNative(
        detectorRef.current || ('BarcodeDetector' in window
          ? new window.BarcodeDetector({ formats: ['qr_code'] })
          : null),
        canvas,
      );
      if (!text) text = await decodeZxingCanvas(canvas);
      if (!text) {
        const small = downscaleCanvas(canvas, 480);
        const sctx = small.getContext('2d', { willReadFrequently: true });
        text = await decodeJsQR(sctx.getImageData(0, 0, small.width, small.height));
      }

      if (text) {
        emitDecode(text);
      } else {
        setHint('No se leyó un QR en esa imagen');
        onError?.('No se detectó un QR válido en la imagen.');
      }
    } catch {
      onError?.('No se pudo leer la imagen del QR.');
    }
  }, [downscaleCanvas, emitDecode, onError]);

  // Loop rápido: BarcodeDetector casi cada frame; ZXing/jsQR intercalados
  useEffect(() => {
    if (!active || paused || starting || !live) return undefined;

    const token = ++loopTokenRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return undefined;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let cancelled = false;

    const schedule = (fn, ms) => {
      if (cancelled || loopTokenRef.current !== token) return;
      if (typeof video.requestVideoFrameCallback === 'function' && ms < 20) {
        video.requestVideoFrameCallback(() => { void fn(); });
      } else {
        setTimeout(() => { void fn(); }, ms);
      }
    };

    const tick = async () => {
      if (cancelled || loopTokenRef.current !== token) return;
      if (paused || !video.videoWidth || video.readyState < 2) {
        schedule(tick, 80);
        return;
      }

      const t0 = performance.now();
      try {
        // Camino ultrarrápido: solo nativo sobre el video
        let text = await detectNative(detectorRef.current, video);
        if (!text) text = await tryDecodeFrame(video, canvas, ctx);
        if (text) emitDecode(text);
      } catch {
        /* frame fallido */
      }

      const spent = performance.now() - t0;
      // ~15–25 intentos/seg cuando el nativo responde rápido
      const wait = spent < 40 ? 24 : Math.max(36, 100 - spent);
      schedule(tick, wait);
    };

    void tick();
    return () => {
      cancelled = true;
      loopTokenRef.current += 1;
    };
  }, [active, paused, starting, live, emitDecode, tryDecodeFrame]);

  useEffect(() => {
    if (active) void startCamera();
    else stopStream();
    return () => stopStream();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qr-live">
      <style>{`
        .qr-live {
          position: absolute;
          inset: 0;
          background: #020804;
          overflow: hidden;
        }
        .qr-live video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          background: #000;
          cursor: crosshair;
          touch-action: manipulation;
        }
        .qr-live-frame {
          position: absolute;
          inset: 12%;
          border: 1.5px solid rgba(207,161,58,0.55);
          border-radius: 18px;
          box-shadow: 0 0 0 9999px rgba(0,0,0,0.22);
          pointer-events: none;
        }
        /* Esquinas sutiles en lugar de “láser” agresivo */
        .qr-live-frame::before,
        .qr-live-frame::after {
          content: '';
          position: absolute;
          width: 22px;
          height: 22px;
          border-color: rgba(207,161,58,0.85);
          border-style: solid;
          pointer-events: none;
        }
        .qr-live-frame::before {
          top: -1px;
          left: -1px;
          border-width: 2px 0 0 2px;
          border-radius: 4px 0 0 0;
        }
        .qr-live-frame::after {
          right: -1px;
          bottom: -1px;
          border-width: 0 2px 2px 0;
          border-radius: 0 0 4px 0;
          /* sin animación de láser */
          animation: none;
          left: auto;
          top: auto;
          height: 22px;
          background: none;
        }
        .qr-live-corners {
          position: absolute;
          inset: 12%;
          pointer-events: none;
          z-index: 2;
        }
        .qr-live-corners span {
          position: absolute;
          width: 22px;
          height: 22px;
          border-color: rgba(207,161,58,0.85);
          border-style: solid;
        }
        .qr-live-corners span:nth-child(1) {
          top: -1px;
          right: -1px;
          border-width: 2px 2px 0 0;
          border-radius: 0 4px 0 0;
        }
        .qr-live-corners span:nth-child(2) {
          bottom: -1px;
          left: -1px;
          border-width: 0 0 2px 2px;
          border-radius: 0 0 0 4px;
        }
        .qr-live-sweep {
          position: absolute;
          left: 8%;
          right: 8%;
          top: 18%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(207,161,58,0.35), transparent);
          opacity: 0.55;
          animation: qr-sweep 3.2s ease-in-out infinite;
          pointer-events: none;
          z-index: 2;
        }
        @keyframes qr-sweep {
          0%, 100% { transform: translateY(0); opacity: 0.2; }
          50% { transform: translateY(min(52vh, 280px)); opacity: 0.45; }
        }
        @media (prefers-reduced-motion: reduce) {
          .qr-live-sweep { animation: none; opacity: 0.3; top: 50%; }
        }
        .qr-live-hint {
          position: absolute;
          left: 50%;
          bottom: 0.85rem;
          transform: translateX(-50%);
          z-index: 3;
          background: rgba(0,0,0,0.66);
          color: #fff;
          font-size: 0.78rem;
          font-weight: 600;
          padding: 0.45rem 0.85rem;
          border-radius: 999px;
          white-space: nowrap;
          max-width: 94%;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
        }
        .qr-live-tools {
          position: absolute;
          top: 0.65rem;
          right: 0.65rem;
          z-index: 4;
          display: flex;
          gap: 0.4rem;
        }
        .qr-live-tools button {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.55);
          color: #fff;
          display: grid;
          place-items: center;
          cursor: pointer;
        }
      `}</style>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onClick={(e) => focusAt(e.clientX, e.clientY)}
        aria-label="Vista de cámara del lector QR"
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="qr-live-frame" aria-hidden="true" />
      <div className="qr-live-corners" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="qr-live-sweep" aria-hidden="true" />
      <div className="qr-live-tools">
        <button type="button" title="Cambiar cámara" aria-label="Cambiar cámara" onClick={switchCamera}>
          <RefreshCw size={18} aria-hidden="true" />
        </button>
        {torchSupported && (
          <button
            type="button"
            title="Linterna"
            aria-label={torchOn ? 'Apagar linterna' : 'Encender linterna'}
            onClick={toggleTorch}
          >
            {torchOn ? <FlashlightOff size={18} aria-hidden="true" /> : <Flashlight size={18} aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          title="Reenfocar de cerca"
          aria-label="Reenfocar de cerca"
          onClick={() => {
            void applyCloseFocus(trackRef.current);
            setHint('Foco cercano reaplicado');
            setTimeout(() => setHint('Acercá el QR al marco · lectura al instante'), 800);
          }}
        >
          <Aperture size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Leer QR desde foto"
          aria-label="Leer QR desde foto"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={18} aria-hidden="true" />
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void decodeFromFile(file);
        }}
      />
      <div className="qr-live-hint" aria-live="polite">
        {starting ? 'Iniciando cámara…' : hint}
      </div>
    </div>
  );
}
