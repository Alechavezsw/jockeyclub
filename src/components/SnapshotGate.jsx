import { Fragment } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { loadSnapshots, SNAPSHOT_LABELS } from '../data/snapshots';
import useSnapshots from '../hooks/useSnapshots';

/**
 * Monta `children` recién cuando terminaron de cargar los snapshots que usan, así los
 * cálculos de la pantalla ya ven los datos en el primer render. Si alguno no se pudo
 * bajar, la pantalla igual se muestra (con lo que venga de la base) y avisa arriba.
 */
export default function SnapshotGate({ names, children }) {
  const { settled, failed } = useSnapshots(names);

  if (!settled) {
    return (
      <p className="ops-muted snapshot-gate-status" role="status">
        <Loader2 size={14} aria-hidden="true" /> Cargando datos de LILA…
      </p>
    );
  }

  return (
    <>
      {failed.length > 0 && (
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
      )}
      {/* Si un reintento sale bien, se vuelve a montar la pantalla con los datos. */}
      <Fragment key={failed.join('|')}>{children}</Fragment>
    </>
  );
}
