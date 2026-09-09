import { useMemo, useState } from 'react';
import { ArrowLeft, Eye, Search } from 'lucide-react';
import {
  ACCESSIN_DETAILED_CC_AS_OF,
  ACCESSIN_DETAILED_CC_SNAPSHOT,
  listDetailedCcMembers,
  listDetailedCcPeriods,
  lookupDetailedCc,
  periodLabelFromKey,
} from '../../domain/accounting/detailedCurrentAccounts';

const PAGE_SIZE = 50;

function formatLilaMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$ ${abs}`;
}

export default function DetailedCurrentAccountsPanel({ onBack, onOpenMemberBalance }) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);

  const periods = useMemo(() => listDetailedCcPeriods(), []);
  const members = useMemo(
    () => listDetailedCcMembers({ query: appliedQuery, onlyUnpaid, periodKey: period }),
    [appliedQuery, onlyUnpaid, period]
  );

  const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = members.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const snap = ACCESSIN_DETAILED_CC_SNAPSHOT;

  if (selected) {
    const detail = lookupDetailedCc(selected.memberNumber) || selected;
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>
            <ArrowLeft size={14} /> Volver al listado
          </button>
          {onOpenMemberBalance ? (
            <button type="button" className="btn cash-lila-purple-btn" onClick={() => onOpenMemberBalance(detail.memberNumber)}>
              Ver resumen de cuenta
            </button>
          ) : null}
        </div>

        <h3 className="cuotas-title">
          CC detallada — {detail.memberNumber} · {detail.memberName}
        </h3>
        <p>
          <strong>Cuota:</strong> {detail.socialFee || detail.feeCategory || '—'}
          {' · '}
          Cargo {formatLilaMoney(detail.totalAmount)}
          {' · '}
          Pagado {formatLilaMoney(detail.totalPaid)}
          {' · '}
          Adeudado {formatLilaMoney(detail.totalOwed)}
        </p>

        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Período</th>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Pago</th>
                <th>Adeudado</th>
              </tr>
            </thead>
            <tbody>
              {(detail.lines || []).map((line) => (
                <tr key={line.id}>
                  <td>{line.id}</td>
                  <td>{periodLabelFromKey(line.periodKey)}</td>
                  <td>{line.feeDate}</td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(line.amount)}</td>
                  <td style={{ color: line.paid > 0 ? 'var(--danger-accent)' : undefined }}>{formatLilaMoney(line.paid)}</td>
                  <td style={{ fontWeight: 700 }}>{formatLilaMoney(line.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in cuotas-panel">
      <div className="cuotas-toolbar">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onBack ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              <ArrowLeft size={14} /> Volver
            </button>
          ) : null}
          <h3 className="cuotas-title" style={{ margin: 0 }}>Cuentas corrientes detalladas</h3>
        </div>
      </div>

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Detalle LILA</h4>
        <p className="disc-field-hint" style={{ marginTop: 0 }}>
          {snap.asOfLabel || ACCESSIN_DETAILED_CC_AS_OF}
          {' · '}
          período {snap.periodFrom} → {snap.periodTo}
          {' · '}
          {snap.lineCount?.toLocaleString('es-AR')} líneas · {snap.memberCount?.toLocaleString('es-AR')} socios
          {' · '}
          recaudado {formatLilaMoney(snap.totalCollected)}
          {' · '}
          {snap.unpaidLines?.toLocaleString('es-AR')} sin cancelar
        </p>
        <div className="cuotas-event-filters">
          <label>
            <span className="form-label">Buscar</span>
            <input
              className="form-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, nro. o DNI"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setAppliedQuery(query); setPage(0); }
              }}
            />
          </label>
          <label>
            <span className="form-label">Período</span>
            <select className="form-input" value={period} onChange={(e) => { setPeriod(e.target.value); setPage(0); }}>
              <option value="all">Todos</option>
              {periods.map((p) => (
                <option key={p.periodKey} value={p.periodKey}>{p.periodLabel}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'end', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={onlyUnpaid}
              onChange={(e) => { setOnlyUnpaid(e.target.checked); setPage(0); }}
            />
            <span className="form-label" style={{ margin: 0 }}>Solo con saldo adeudado</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="button"
              className="btn cash-lila-purple-btn"
              onClick={() => { setAppliedQuery(query); setPage(0); }}
            >
              <Search size={14} /> Buscar
            </button>
          </div>
        </div>
      </section>

      <div className="disc-pager">
        <span>
          {members.length === 0
            ? 'Sin resultados'
            : `Mostrando ${safePage * PAGE_SIZE + 1} - ${Math.min(members.length, (safePage + 1) * PAGE_SIZE)} de ${members.length}`}
        </span>
        {members.length > PAGE_SIZE ? (
          <div className="cash-efectivo-pager">
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</button>
            <button type="button" className={`cash-efectivo-page-btn${safePage === 0 ? ' is-active' : ''}`} onClick={() => setPage(0)}>1</button>
            {totalPages > 1 ? (
              <button type="button" className={`cash-efectivo-page-btn${safePage === totalPages - 1 ? ' is-active' : ''}`} onClick={() => setPage(totalPages - 1)}>{totalPages}</button>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Siguiente</button>
          </div>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nro. socio</th>
              <th>Socio</th>
              <th>Cuota</th>
              <th>Cargos</th>
              <th>Pagado</th>
              <th>Adeudado</th>
              <th>Líneas</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={8} style={{ color: 'var(--text-muted)' }}>Sin socios.</td></tr>
            ) : pageRows.map((m) => (
              <tr key={m.memberNumber}>
                <td>{m.memberNumber}</td>
                <td style={{ fontWeight: 600 }}>{m.memberName}</td>
                <td>{m.socialFee || m.feeCategory || '—'}</td>
                <td>{formatLilaMoney(m.totalAmount)}</td>
                <td>{formatLilaMoney(m.totalPaid)}</td>
                <td style={{ fontWeight: 700, color: m.totalOwed > 0 ? 'var(--emerald-accent)' : undefined }}>
                  {formatLilaMoney(m.totalOwed)}
                </td>
                <td>{(m.lines || []).length}</td>
                <td>
                  <button type="button" className="cash-lila-icon-btn is-edit" title="Ver detalle" onClick={() => setSelected(m)}>
                    <Eye size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
