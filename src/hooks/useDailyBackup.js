import { useEffect, useRef } from 'react';
import { canAccessAdmin } from '../domain/auth/roles';
import { ensureTodayDailyBackup } from '../domain/reports/dailyBackupStore';

/**
 * Crea automáticamente el backup del día (una vez por jornada) cuando hay
 * sesión operativa y los datos ya están hidratados.
 */
export function useDailyBackup({
  enabled = true,
  role,
  isAuthenticated,
  dbReady,
  snapshot,
}) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const ranDayRef = useRef('');

  useEffect(() => {
    if (!enabled || !isAuthenticated || !dbReady) return undefined;
    if (!canAccessAdmin(role)) return undefined;

    const day = new Date().toISOString().slice(0, 10);
    if (ranDayRef.current === day) return undefined;
    ranDayRef.current = day;

    let cancelled = false;
    (async () => {
      try {
        await ensureTodayDailyBackup(snapshotRef.current || {});
      } catch {
        if (!cancelled) ranDayRef.current = '';
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, role, isAuthenticated, dbReady]);
}
