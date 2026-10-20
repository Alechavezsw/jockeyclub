import { useEffect } from 'react';

/**
 * Mantiene la pantalla encendida mientras `active`. Una tablet de portería que se duerme
 * a mitad de turno corta la cámara y hay que despertarla a mano.
 * Si el navegador no lo soporta, o el equipo está con poca batería, simplemente no hace nada.
 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock?.request) return undefined;
    let lock = null;
    let cancelled = false;

    const release = () => {
      const current = lock;
      lock = null;
      try {
        void current?.release?.();
      } catch {
        /* ya liberado */
      }
    };

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void next.release?.();
          return;
        }
        lock = next;
        next.addEventListener?.('release', () => {
          if (lock === next) lock = null;
        });
      } catch {
        /* sin permiso o batería baja */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !lock) void acquire();
    };

    document.addEventListener('visibilitychange', onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      release();
    };
  }, [active]);
}
