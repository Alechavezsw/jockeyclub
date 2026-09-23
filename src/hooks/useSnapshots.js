import { useEffect, useSyncExternalStore } from 'react';
import {
  getSnapshotsGeneration,
  getSnapshotsVersion,
  loadSnapshots,
  snapshotStatus,
  subscribeSnapshots,
} from '../data/snapshots';

/**
 * Pide los snapshots al montar y re-renderiza cuando cargan.
 * `settled`: todos terminaron, bien o mal. `failed`: los que no se pudieron bajar.
 * `version` cambia con cada carga; sirve de dependencia para useMemo.
 */
export default function useSnapshots(names = []) {
  const key = names.join('|');
  const version = useSyncExternalStore(subscribeSnapshots, getSnapshotsVersion, getSnapshotsVersion);
  const generation = getSnapshotsGeneration();

  useEffect(() => {
    if (key) void loadSnapshots(key.split('|'));
  }, [key, generation]);

  const list = key ? key.split('|') : [];
  const statuses = list.map(snapshotStatus);
  return {
    version,
    ready: statuses.every((status) => status === 'ready'),
    settled: statuses.every((status) => status === 'ready' || status === 'error'),
    failed: list.filter((_, index) => statuses[index] === 'error'),
  };
}

/**
 * Pide los snapshots y devuelve lo que lee `read` (uno de los `*Seed()` de dominio), con
 * los valores vacíos mientras no cargan. Es la forma de leer un snapshot desde un
 * componente: re-renderiza al cargar y el valor sirve como dependencia de useMemo.
 */
export function useSnapshotSeed(names, read) {
  useSnapshots(names);
  return read();
}
