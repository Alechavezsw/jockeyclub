import { AlertCircle, Loader2 } from 'lucide-react';
import { loadSnapshots, SNAPSHOT_LABELS } from '../data/snapshots';
import useSnapshots from '../hooks/useSnapshots';

/**
 * Muestra la pantalla de una y avisa arriba solo en la primera espera.
 * Un refresco de LILA no vacía ni remonta lo que ya se ve.
 */
export default function SnapshotGate({ names, children }) {
  const { settled, failed } = useSnapshots(names);

  return (
    <>
      {!settled ? (
        <p className="ops-muted snapshot-gate-status" role="status">
          <Loader2 size={14} aria-hidden="true" /> Cargando datos de LILA…
        </p>
      ) : null}
      {settled && failed.length > 0 ? (
        <div className="snapshot-gate-alert" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            No se pudieron cargar datos exportados de LILA
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
