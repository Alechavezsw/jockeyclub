import { AlertCircle } from 'lucide-react';
import { loadSnapshots, SNAPSHOT_LABELS } from '../data/snapshots';
import useSnapshots from '../hooks/useSnapshots';

/**
 * No empuja el layout: la espera no monta un cartel arriba.
 * Lo que ya está en pantalla sigue visible.
 */
export default function SnapshotGate({ names, children }) {
  const { settled, failed } = useSnapshots(names);

  return (
    <>
      {!settled ? (
        <p className="sr-only" role="status">Cargando datos…</p>
      ) : null}
      {settled && failed.length > 0 ? (
        <div className="snapshot-gate-alert" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            No se pudieron cargar datos históricos
            ({failed.map((name) => SNAPSHOT_LABELS[name] || name).join(', ')}).
            Lo que se muestra puede estar incompleto.
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void loadSnapshots(failed)}>
            Reintentar
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
}
