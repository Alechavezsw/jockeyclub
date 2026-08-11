import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Flashlight, FlashlightOff, ImagePlus, RefreshCw } from 'lucide-react';

let jsQRModulePromise = null;
function loadJsQR() {
  if (!jsQRModulePromise) {
    jsQRModulePromise = import('jsqr').then((m) => m.default || m);
  }
  return jsQRModulePromise;
}

async function decodeWithJsQR(imageData) {
  const jsQR = await loadJsQR();
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data || '';
}

/**
 * Lector QR (getUserMedia + BarcodeDetector/jsQR).
 * Orientado a celular→celular: sin warm-up frágil, decode secuencial, fallback por foto.
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
  const streamRef = useRef(null);
  const trackRef = useRef(null);
  const detectorRef = useRef(null);
  const lastDecodeRef = useRef('');
  const lastDecodeAtRef = useRef(0);
  const devicesRef = useRef([]);
  const deviceIndexRef = useRef(0);
  const focusTimerRef = useRef(0);
  const decodeBusyRef = useRef(false);
  const loopAliveRef = useRef(false);
  const fileInputRef = useRef(null);

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState('Acercá el QR · tocá la imagen para enfocar');
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState(false);

  const stopStream = useCallback(() => {
    loopAliveRef.current = false;
    if (focusTimerRef.current) {
      clearInterval(focusTimerRef.current);
      focusTimerRef.current = 0;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    trackRef.current = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
    setLive(false);
  }, []);

  const applyBestFocus = useCallback(async (track) => {
    if (!track?.applyConstraints) return;
    const caps = track.getCapabilities?.() || {};

    try {
      const ideal = {};
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('continuous')) ideal.focusMode = 'continuous';
        else if (caps.focusMode.includes('auto')) ideal.focusMode = 'auto';
        else if (caps.focusMode.includes('single-shot')) ideal.focusMode = 'single-shot';
      }
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        ideal.exposureMode = 'continuous';
      }
      if (Object.keys(ideal).length) {
        await track.applyConstraints({ advanced: [ideal] });
      }
    } catch {
      /* ignore */
    }

    // Distancia cercana sin zoom agresivo (el zoom suele empeorar moiré pantalla→cámara)
    try {
      if (typeof caps.focusDistance === 'object' && caps.focusDistance.max > caps.focusDistance.min) {
        const near = caps.focusDistance.min
          + (caps.focusDistance.max - caps.focusDistance.min) * 0.18;
        await track.applyConstraints({ advanced: [{ focusDistance: near }] });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const emitDecode = useCallback((text) => {
    if (!text) return false;
    const now = Date.now();
    if (text === lastDecodeRef.current && now - lastDecodeAtRef.current < 1600) return false;
    lastDecodeRef.current = text;
    lastDecodeAtRef.current = now;
    onDecode?.(text);
    return true;
  }, [onDecode]);

  const tryDecodeFrame = useCallback(async (video, canvas, ctx) => {
    // 1) BarcodeDetector nativo sobre el video
    try {
      if (detectorRef.current) {
        const codes = await detectorRef.current.detect(video);
        if (codes?.[0]?.rawValue) return codes[0].rawValue;
      }
    } catch {
      /* canvas fallback */
    }

    if (!video.videoWidth || !video.videoHeight) return '';

    // Resolución alta: pantallas necesitan detalle de módulos del QR
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    const w = Math.max(1, Math.floor(video.videoWidth * scale));
    const h = Math.max(1, Math.floor(video.videoHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);

    // 2) BarcodeDetector sobre canvas
    try {
      if (detectorRef.current) {
        const codes = await detectorRef.current.detect(canvas);
        if (codes?.[0]?.rawValue) return codes[0].rawValue;
      }
    } catch {
      detectorRef.current = null;
    }

    // 3) jsQR en ROI centrado + frame completo
    const ratios = [0.62, 0.78, 1];
    for (const cropRatio of ratios) {
      let imageData;
      if (cropRatio >= 0.999) {
        imageData = ctx.getImageData(0, 0, w, h);
      } else {
        const cw = Math.floor(w * cropRatio);
        const ch = Math.floor(h * cropRatio);
        const cx = Math.floor((w - cw) / 2);
        const cy = Math.floor((h - ch) / 2);
        if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement('canvas');
        const cropCanvas = cropCanvasRef.current;
        if (cropCanvas.width !== cw || cropCanvas.height !== ch) {
          cropCanvas.width = cw;
          cropCanvas.height = ch;
        }
        const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });
        cctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
        imageData = cctx.getImageData(0, 0, cw, ch);
      }
      const text = await decodeWithJsQR(imageData);
      if (text) return text;
    }
    return '';
  }, []);

  const startWithDevice = useCallback(async (deviceId) => {
    stopStream();
    setStarting(true);
    setHint('Iniciando cámara…');
    // Precargar jsQR mientras pide la cámara
    void loadJsQR();

    const attempts = [
      {
        audio: false,
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              facingMode: { ideal: 'environment' },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
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
        /* autoplay policies: muted + playsinline suele bastar */
      }

      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve();
        else {
          const done = () => resolve();
          video.onloadeddata = done;
          setTimeout(done, 1200);
        }
      });

      await applyBestFocus(track);
      focusTimerRef.current = window.setInterval(() => {
        if (trackRef.current) applyBestFocus(trackRef.current);
      }, 3000);

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
      setHint('Acercá el QR (20–40 cm) · tocá para enfocar');
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
  }, [applyBestFocus, onError, stopStream]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Este dispositivo no soporta cámara en el navegador.');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      devicesRef.current = videos;
      // Sin permiso previo los labels vienen vacíos: preferir última (suele ser trasera en móvil)
      const backIdx = videos.findIndex((d) =>
        /back|rear|environment|trasera|atrás|atras|world/i.test(d.label || '')
      );
      deviceIndexRef.current = backIdx >= 0 ? backIdx : Math.max(0, videos.length - 1);
      const chosen = videos[deviceIndexRef.current];
      await startWithDevice(chosen?.deviceId || null);
      // Releer labels tras permiso
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
    } catch {
      setHint('Linterna no disponible en esta cámara');
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
      } else {
        await applyBestFocus(track);
      }
      setTimeout(() => setHint('Acercá el QR (20–40 cm) · tocá para enfocar'), 700);
    } catch {
      applyBestFocus(track);
    }
  }, [applyBestFocus]);

  const decodeFromFile = useCallback(async (file) => {
    if (!file) return;
    setHint('Leyendo imagen…');
    try {
      const bmp = await createImageBitmap(file);
      const canvas = canvasRef.current || document.createElement('canvas');
      const maxW = 1600;
      const scale = Math.min(1, maxW / bmp.width);
      canvas.width = Math.max(1, Math.floor(bmp.width * scale));
      canvas.height = Math.max(1, Math.floor(bmp.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();

      let text = '';
      if ('BarcodeDetector' in window) {
        try {
          const det = detectorRef.current
            || new window.BarcodeDetector({ formats: ['qr_code'] });
          const codes = await det.detect(canvas);
          text = codes?.[0]?.rawValue || '';
        } catch {
          /* jsQR */
        }
      }
      if (!text) {
        text = await decodeWithJsQR(ctx.getImageData(0, 0, canvas.width, canvas.height));
      }
      if (text) {
        emitDecode(text);
        setHint('QR leído');
      } else {
        setHint('No se leyó un QR en esa imagen');
        onError?.('No se detectó un QR válido en la imagen.');
      }
    } catch {
      onError?.('No se pudo leer la imagen del QR.');
    }
  }, [emitDecode, onError]);

  // Loop de decodificación secuencial (evita saturar CPU con awaits apilados)
  useEffect(() => {
    if (!active || paused || starting || !live) {
      loopAliveRef.current = false;
      return undefined;
    }

    let alive = true;
    loopAliveRef.current = true;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return undefined;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const loop = async () => {
      while (alive && loopAliveRef.current) {
        if (paused || !video.videoWidth || video.readyState < 2) {
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        if (decodeBusyRef.current) {
          await new Promise((r) => setTimeout(r, 40));
          continue;
        }
        decodeBusyRef.current = true;
        try {
          const text = await tryDecodeFrame(video, canvas, ctx);
          if (text) emitDecode(text);
        } catch {
          /* frame fallido */
        } finally {
          decodeBusyRef.current = false;
        }
        await new Promise((r) => setTimeout(r, 90));
      }
    };

    void loop();
    return () => {
      alive = false;
      loopAliveRef.current = false;
    };
  }, [active, paused, starting, live, emitDecode, tryDecodeFrame]);

  useEffect(() => {
    if (active) {
      void startCamera();
    } else {
      stopStream();
    }
    return () => stopStream();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- solo al activar/desactivar

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
          inset: 14%;
          border: 2px solid rgba(207,161,58,0.9);
          border-radius: 18px;
          box-shadow: 0 0 0 9999px rgba(0,0,0,0.32);
          pointer-events: none;
        }
        .qr-live-frame::after {
          content: '';
          position: absolute;
          left: 8%;
          right: 8%;
          height: 2px;
          top: 50%;
          background: linear-gradient(90deg, transparent, rgba(207,161,58,0.95), transparent);
          animation: qr-scan-line 1.8s ease-in-out infinite;
        }
        @keyframes qr-scan-line {
          0%, 100% { transform: translateY(-40px); opacity: 0.35; }
          50% { transform: translateY(40px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .qr-live-frame::after { animation: none; }
        }
        .qr-live-hint {
          position: absolute;
          left: 50%;
          bottom: 0.85rem;
          transform: translateX(-50%);
          z-index: 3;
          background: rgba(0,0,0,0.62);
          color: #fff;
          font-size: 0.78rem;
          padding: 0.4rem 0.75rem;
          border-radius: 999px;
          white-space: nowrap;
          max-width: 92%;
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
      <div className="qr-live-frame" />
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
          title="Reenfocar"
          aria-label="Reenfocar"
          onClick={() => applyBestFocus(trackRef.current)}
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
