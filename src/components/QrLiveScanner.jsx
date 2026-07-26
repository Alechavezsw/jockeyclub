import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Aperture, Flashlight, FlashlightOff, RefreshCw } from 'lucide-react';

/**
 * Lector QR propio (getUserMedia + BarcodeDetector/jsQR).
 * Optimizado para celular-a-celular: foco continuo, ROI centrado, reenfoque.
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
  const rafRef = useRef(0);
  const detectorRef = useRef(null);
  const lastDecodeRef = useRef('');
  const lastDecodeAtRef = useRef(0);
  const devicesRef = useRef([]);
  const deviceIndexRef = useRef(0);
  const focusTimerRef = useRef(0);
  const frameSkipRef = useRef(0);

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [hint, setHint] = useState('Acercá el QR · tocá la imagen para enfocar');
  const [starting, setStarting] = useState(false);

  const stopStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
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
  }, []);

  const applyBestFocus = useCallback(async (track) => {
    if (!track?.applyConstraints) return;
    const caps = track.getCapabilities?.() || {};

    // 1) Modos de foco / exposición en el constraint principal (mejor soporte)
    try {
      const ideal = {};
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('continuous')) ideal.focusMode = 'continuous';
        else if (caps.focusMode.includes('single-shot')) ideal.focusMode = 'single-shot';
        else if (caps.focusMode.includes('auto')) ideal.focusMode = 'auto';
      }
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        ideal.exposureMode = 'continuous';
      }
      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
        ideal.whiteBalanceMode = 'continuous';
      }
      if (Object.keys(ideal).length) {
        await track.applyConstraints({ advanced: [ideal] });
      }
    } catch {
      /* ignore */
    }

    // 2) Distancia de foco cercana (pantallas a ~25–40 cm)
    try {
      if (typeof caps.focusDistance === 'object' && caps.focusDistance.max > caps.focusDistance.min) {
        const near = caps.focusDistance.min
          + (caps.focusDistance.max - caps.focusDistance.min) * 0.22;
        await track.applyConstraints({ advanced: [{ focusDistance: near }] });
      }
    } catch {
      /* ignore */
    }

    // 3) Zoom leve: ayuda a llenar el ROI con el QR de otra pantalla
    try {
      if (typeof caps.zoom === 'object' && caps.zoom.max > caps.zoom.min) {
        const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, caps.zoom.min + 1.25));
        await track.applyConstraints({ advanced: [{ zoom: z }] });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startWithDevice = useCallback(async (deviceId) => {
    stopStream();
    setStarting(true);
    setHint('Iniciando cámara…');

    const baseVideo = {
      width: { ideal: 1920, min: 640 },
      height: { ideal: 1080, min: 480 },
      frameRate: { ideal: 30, min: 15 },
      // Pedir foco continuo desde el start
      focusMode: { ideal: 'continuous' },
    };

    const constraints = {
      audio: false,
      video: deviceId
        ? { ...baseVideo, deviceId: { exact: deviceId } }
        : { ...baseVideo, facingMode: { ideal: 'environment' } },
    };

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        // Fallback sin focusMode / resolución alta
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, facingMode: { ideal: 'environment' } }
            : { facingMode: { ideal: 'environment' } },
        });
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      const video = videoRef.current;
      if (!video) throw new Error('Video no disponible');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      await video.play();

      // Esperar primer frame
      await new Promise((resolve) => {
        if (video.readyState >= 2) resolve();
        else video.onloadeddata = () => resolve();
        setTimeout(resolve, 800);
      });

      await applyBestFocus(track);

      // Reenfocar cada 2.5s (pantallas a menudo confunden el AF)
      focusTimerRef.current = window.setInterval(() => {
        if (trackRef.current) applyBestFocus(trackRef.current);
      }, 2500);

      const caps = track.getCapabilities?.() || {};
      setTorchSupported(Boolean(caps.torch));

      if ('BarcodeDetector' in window) {
        try {
          detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detectorRef.current = null;
        }
      }

      setHint('Acercá el QR (20–40 cm) · tocá para enfocar');
      setStarting(false);
      onError?.('');
    } catch (err) {
      setStarting(false);
      stopStream();
      const msg = String(err?.message || err || '');
      onError?.(
        /permission|notallowed|denied/i.test(msg)
          ? 'Permití el acceso a la cámara para leer credenciales.'
          : 'No se pudo iniciar la cámara. Probá otro navegador o HTTPS.'
      );
    }
  }, [applyBestFocus, onError, stopStream]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Este dispositivo no soporta cámara en el navegador.');
      return;
    }
    try {
      // Warm-up: pedir permiso para poder leer labels de cámaras
      const warm = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      warm.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      devicesRef.current = videos;
      const backIdx = videos.findIndex((d) =>
        /back|rear|environment|trasera|atrás|atras/i.test(d.label || '')
      );
      deviceIndexRef.current = backIdx >= 0 ? backIdx : Math.max(0, videos.length - 1);
      const chosen = videos[deviceIndexRef.current];
      await startWithDevice(chosen?.deviceId);
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
    await startWithDevice(list[deviceIndexRef.current]?.deviceId);
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
          advanced: [
            { focusMode: 'manual', pointsOfInterest: [{ x, y }] },
          ],
        });
        // Disparar single-shot si existe
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('single-shot')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
        }
        setTimeout(() => {
          applyBestFocus(track);
          setHint('Acercá el QR (20–40 cm) · tocá para enfocar');
        }, 900);
      } else {
        await applyBestFocus(track);
        setHint('Reenfocado');
        setTimeout(() => setHint('Acercá el QR (20–40 cm) · tocá para enfocar'), 800);
      }
    } catch {
      applyBestFocus(track);
    }
  }, [applyBestFocus]);

  const tryDecodeCanvas = useCallback(async (canvas, ctx) => {
    // 1) BarcodeDetector nativo sobre el frame completo
    try {
      if (detectorRef.current) {
        const codes = await detectorRef.current.detect(canvas);
        if (codes?.[0]?.rawValue) return codes[0].rawValue;
      }
    } catch {
      detectorRef.current = null;
    }

    // 2) jsQR en ROI centrado (donde está el marco) a buena resolución
    const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const cropRatio = 0.72;
    const cw = Math.floor(canvas.width * cropRatio);
    const ch = Math.floor(canvas.height * cropRatio);
    const cx = Math.floor((canvas.width - cw) / 2);
    const cy = Math.floor((canvas.height - ch) / 2);

    if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement('canvas');
    const cropCanvas = cropCanvasRef.current;
    if (cropCanvas.width !== cw || cropCanvas.height !== ch) {
      cropCanvas.width = cw;
      cropCanvas.height = ch;
    }
    const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    const crop = cctx.getImageData(0, 0, cw, ch);

    let code = jsQR(crop.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;

    // 3) Frame completo (QR más lejos / más grande)
    code = jsQR(full.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
    return code?.data || '';
  }, []);

  // Loop de decodificación
  useEffect(() => {
    if (!active || paused || starting) return undefined;

    let alive = true;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return undefined;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(tick);

      if (paused || !video.videoWidth || video.readyState < 2) return;

      // ~15 fps de decode (cada 2 frames) para no saturar CPU
      frameSkipRef.current = (frameSkipRef.current + 1) % 2;
      if (frameSkipRef.current !== 0) return;

      const maxW = 800;
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.floor(video.videoWidth * scale);
      const h = Math.floor(video.videoHeight * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.drawImage(video, 0, 0, w, h);

      // Preferir BarcodeDetector directo sobre el video (mejor en Chrome/Android)
      let text = '';
      try {
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(video);
          if (codes?.[0]?.rawValue) text = codes[0].rawValue;
        }
      } catch {
        /* canvas fallback */
      }

      if (!text) {
        text = await tryDecodeCanvas(canvas, ctx);
      }

      if (!text) return;
      const now = Date.now();
      if (text === lastDecodeRef.current && now - lastDecodeAtRef.current < 1800) return;
      lastDecodeRef.current = text;
      lastDecodeAtRef.current = now;
      onDecode?.(text);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [active, paused, starting, onDecode, tryDecodeCanvas]);

  useEffect(() => {
    if (active) startCamera();
    else stopStream();
    return () => stopStream();
  }, [active, startCamera, stopStream]);

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
        <button type="button" title="Cambiar cámara" onClick={switchCamera}>
          <RefreshCw size={18} />
        </button>
        {torchSupported && (
          <button type="button" title="Linterna" onClick={toggleTorch}>
            {torchOn ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
          </button>
        )}
        <button type="button" title="Reenfocar" onClick={() => applyBestFocus(trackRef.current)}>
          <Aperture size={18} />
        </button>
      </div>
      <div className="qr-live-hint">{starting ? 'Iniciando cámara…' : hint}</div>
    </div>
  );
}
