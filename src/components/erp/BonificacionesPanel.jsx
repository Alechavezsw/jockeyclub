import { useMemo, useState } from 'react';
import { Receipt, Search } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  bonificacionesSummary,
  formatBonificacionDate,
  listBonificaciones,
} from '../../domain/accounting/bonificaciones';
import { bonificacionesSeed } from '../../domain/accounting/discountsSeed';
import { formatDiscountValue } from '../../domain/accounting/discounts';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

export default function BonificacionesPanel(props) {
  return (
    <SnapshotGate names={['accessinBonificaciones']}>
      <BonificacionesContent {...props} />
    </SnapshotGate>
  );
}

function BonificacionesContent({ onOpenMember }) {
  useSnapshotSeed(['accessinBonificaciones'], bonificacionesSeed);
  const [query, setQuery] = useState('');

  const summary = useMemo(() => bonificacionesSummary(), []);
  const rows = useMemo(() => listBonificaciones({ query }), [query]);

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">Bonificaciones</h3>
          <p className="mb-folio-meta">
            Corte al {summary.asOfLabel || '—'}.
            {summary.sourceFile ? ` ${summary.sourceFile.replace(/^LILA\s*[-–]\s*/i, '')}` : ''}
          </p>
        </div>
        <span className="mb-folio-seal">{summary.count.toLocaleString('es-AR')} notas</span>
      </header>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi">
          <dt>Socios</dt>
          <dd>{summary.uniqueMembers.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-net">
          <dt>Total</dt>
          <dd>{formatCurrency(summary.totalAmount)}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Movimientos</dt>
          <dd>{summary.count.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>En este filtro</dt>
          <dd>{rows.length.toLocaleString('es-AR')}</dd>
        </div>
      </dl>

      <label className="ld-search">
        <span className="form-label">Buscar</span>
        <span className="ld-search-field">
          <Search size={14} aria-hidden="true" />
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Socio, DNI, grupo, motivo o quien aplicó"
          />
        </span>
      </label>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Socio</th>
              <th>Grupo</th>
              <th>Concepto</th>
              <th>Valor</th>
              <th>Aplicó</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="mb-folio-empty">No hay bonificaciones con este filtro.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td>{formatBonificacionDate(row.date)}</td>
                <td>
                  {onOpenMember ? (
                    <button type="button" className="cash-lila-card-btn" onClick={() => onOpenMember(row.memberNumber)}>
                      <Receipt size={13} aria-hidden="true" />
                      {' '}
                      {row.memberNumber} · {row.memberName}
                    </button>
                  ) : `${row.memberNumber} · ${row.memberName}`}
                </td>
                <td>{row.familyGroup || '—'}</td>
                <td>{row.concept || row.reason || '—'}</td>
                <td style={{ fontWeight: 700 }}>{formatDiscountValue(row)}</td>
                <td>{row.appliedBy || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
