import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import FoldableSection from './FoldableSection';
import { membershipMovesSeed, summarizeBajas, uniqueBajas } from '../../domain/members/membershipMoves';
import { useSnapshotSeed } from '../../hooks/useSnapshots';

function formatAr(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function MoveStatCard({ label, value, color, active, onClick }) {
  return (
    <button
      type="button"
      className={`members-stat-card${active ? ' is-on' : ''}`}
      onClick={onClick}
      style={color ? { '--stat-accent': color } : undefined}
      aria-pressed={active}
    >
      <b>{Number(value || 0).toLocaleString('es-AR')}</b>
      <span>{label}</span>
    </button>
  );
}

export default function MembershipMovesSection() {
  const [view, setView] = useState('bajas');
  const [kind, setKind] = useState(null);

  const {
    SOCIETAS_MEMBERSHIP_ALTAS: altas,
    SOCIETAS_MEMBERSHIP_BAJAS,
    SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT: snap,
  } = useSnapshotSeed(['societasMembershipMoves'], membershipMovesSeed);
  const bajas = useMemo(() => uniqueBajas(SOCIETAS_MEMBERSHIP_BAJAS), [SOCIETAS_MEMBERSHIP_BAJAS]);
  const summary = useMemo(() => summarizeBajas(bajas), [bajas]);
  const rows = view === 'altas'
    ? altas
    : (kind ? bajas.filter((row) => row.kind === kind) : bajas);

  return (
    <FoldableSection
      className="membership-moves"
      id="membership-moves-title"
      title="Altas y bajas"
      subtitle={`Corte Societas ${formatAr(snap.periodFrom)} al ${formatAr(snap.periodTo)} · ${altas.length.toLocaleString('es-AR')} altas · ${bajas.length.toLocaleString('es-AR')} bajas`}
      defaultOpen={false}
      storageKey="altasBajas"
      extra={(
        <div className="membership-moves-tabs">
          <button
            type="button"
            className={view === 'altas' ? 'is-on' : ''}
            style={{ '--stat-accent': '#1f7a4d' }}
            onClick={() => { setView('altas'); setKind(null); }}
          >
            Altas
          </button>
          <button
            type="button"
            className={view === 'bajas' ? 'is-on' : ''}
            style={{ '--stat-accent': '#c23b3b' }}
            onClick={() => setView('bajas')}
          >
            Bajas
          </button>
        </div>
      )}
    >

      {view === 'bajas' ? (
        <div className="members-stat-cards" aria-label="Motivos de baja">
          {summary.map((item) => (
            <MoveStatCard
              key={item.id}
              label={item.label}
              value={item.count}
              color={item.color}
              active={kind === item.id}
              onClick={() => setKind((cur) => (cur === item.id ? null : item.id))}
            />
          ))}
        </div>
      ) : null}

      <ul className="membership-moves-list">
        {rows.map((row) => {
          const color = view === 'altas' ? '#1f7a4d' : row.color;
          const label = row.name || `Socio ${row.memberId}`;
          const profileTo = row.memberId
            ? `/panel/members/${encodeURIComponent(row.memberId)}`
            : null;
          return (
            <li
              key={`${row.type || view}-${row.memberId}-${row.date}-${row.motivo}`}
              className="membership-moves-row"
              style={{ '--move-color': color }}
            >
              <div>
                {profileTo ? (
                  <Link
                    to={profileTo}
                    className="membership-moves-name"
                    title={`Abrir ficha de ${label}`}
                  >
                    {label}
                  </Link>
                ) : (
                  <strong>{label}</strong>
                )}
                <span className="membership-moves-meta">
                  Nº {row.memberId}
                  {row.documentNumber ? ` · DNI ${row.documentNumber}` : ''}
                  {row.date ? ` · ${formatAr(row.date)}` : ''}
                  {row.motivo ? ` · ${row.motivo}` : ''}
                </span>
              </div>
              <div className="membership-moves-right">
                <span className="membership-moves-chip" style={{ '--move-color': color }}>
                  {view === 'altas' ? (row.movimiento || row.motivo || 'Alta') : row.kindLabel}
                </span>
                {profileTo ? (
                  <Link
                    to={profileTo}
                    className="membership-moves-link"
                    title={`Ver perfil de ${label}`}
                  >
                    Ver
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </FoldableSection>
  );
}
