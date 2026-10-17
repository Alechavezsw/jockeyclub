import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Wallet } from 'lucide-react';
import { buildAppMonthlyDebts } from '../../domain/accounting/appMonthlyDebts';
import { listDebtPeriods, listMonthlyDebtors } from '../../domain/accounting/monthlyDebts';

const PAGE_SIZE = 50;

function formatLilaMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `$ -${abs}` : `$ ${abs}`;
}

export default function MonthlyDebtsPanel({
  members = [],
  accountEntries = [],
  onBack,
  onOpenMemberBalance,
}) {
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);

  const snapshot = useMemo(
    () => buildAppMonthlyDebts(members, { today: new Date(), accountEntries }),
    [members, accountEntries],
  );
  const periods = useMemo(() => listDebtPeriods(snapshot.byNumber), [snapshot]);
  const debtors = useMemo(
    () => listMonthlyDebtors({ byNumber: snapshot.byNumber, query, periodKey: period }),
    [snapshot, query, period],
  );
  const periodLabel = periods.find((p) => p.periodKey === period)?.periodLabel || '';
  const periodTotal = useMemo(
    () => debtors.reduce((sum, m) => sum + (Number(m.totalDebt) || 0), 0),
    [debtors],
  );

  const totalPages = Math.max(1, Math.ceil(debtors.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = debtors.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (selected) {
    const detail = snapshot.byNumber[selected.memberNumber] || selected;
    return (
      <div className="fade-in cuotas-panel">
        <div className="cuotas-toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>
            <ArrowLeft size={14} /> Volver al listado
          </button>
          {onOpenMemberBalance ? (
            <button
              type="button"
              className="btn btn-tan"
              onClick={() => onOpenMemberBalance(detail.memberNumber)}
            >
              <Wallet size={14} /> Ver saldo / resumen
            </button>
          ) : null}
        </div>

        <h3 className="cuotas-title">
          Deuda mes a mes — {detail.memberNumber} · {detail.memberName}
        </h3>
        <p>
          <strong>Cuota social:</strong> {detail.socialFee || '—'}
          {detail.sportsFee ? <> · <strong>Deportiva:</strong> {detail.sportsFee}</> : null}
          {detail.standing ? <> · <strong>Estado:</strong> {detail.standing}</> : null}
        </p>
        <p>
          <strong>Total deuda:</strong> {formatLilaMoney(detail.totalDebt)}
          {' · '}
          Capital {formatLilaMoney(detail.capital)}
          {' · '}
          Intereses {formatLilaMoney(detail.interest)}
          {' · '}
          Sin imputar {formatLilaMoney(detail.unallocated)}
        </p>

        <section className="supplier-pay-import-block">
          <h4>Deuda por mes</h4>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Capital</th>
                  <th>Intereses</th>
                  <th>Deuda acumulada</th>
                </tr>
              </thead>
              <tbody>
                {(detail.months || []).length === 0 ? (
                  <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Sin períodos de cuota: el saldo queda sin imputar.</td></tr>
                ) : (detail.months || []).map((row) => (
                  <tr key={row.periodKey || row.periodLabel}>
                    <td>{row.periodLabel}</td>
                    <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(row.capital)}</td>
                    <td>{formatLilaMoney(row.interest)}</td>
                    <td style={{ fontWeight: 700 }}>{formatLilaMoney(row.accumulated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="supplier-pay-import-block">
          <h4>Movimientos de cuenta</h4>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tipo</th>
                  <th>Descripción</th>
                  <th>Fecha</th>
                  <th>Monto</th>
                  <th>Adeudado</th>
                </tr>
              </thead>
              <tbody>
                {(detail.lines || []).length === 0 ? (
                  <tr><td colSpan={6} style={{ color: 'var(--text-muted)' }}>Sin movimientos en la cuenta del portal.</td></tr>
                ) : (detail.lines || []).map((line, idx) => (
                  <tr key={`${line.id || 'l'}-${idx}`}>
                    <td>{line.id || '—'}</td>
                    <td>{line.type}</td>
                    <td>{line.description || '—'}</td>
                    <td>{line.date || '—'}</td>
                    <td>{formatLilaMoney(line.amount)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(line.owed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
          <h3 className="cuotas-title" style={{ margin: 0 }}>Deudas mes a mes</h3>
        </div>
      </div>

      <section className="supplier-pay-import-block">
        <h4 className="supplier-pay-import-title">Saldo de cuota</h4>
        <p className="disc-field-hint" style={{ marginTop: 0 }}>
          Al {snapshot.asOfLabel || snapshot.asOf}
          {' · '}
          {period === 'all'
            ? `${snapshot.memberCount.toLocaleString('es-AR')} con saldo`
            : `${debtors.length.toLocaleString('es-AR')} en ${periodLabel}`}
          {' · '}
          {period === 'all'
            ? `${snapshot.monthRowCount.toLocaleString('es-AR')} períodos`
            : periodLabel}
          {' · '}
          total {formatLilaMoney(period === 'all' ? snapshot.totalDebt : periodTotal)}
        </p>
        <p className="disc-field-hint">
          Vence el 10. Después del 10 está en mora. Recargo del 10 % (familiar e individual) desde el 11.
          Lo que no entra en esas cuotas queda sin imputar.
        </p>
        <div className="cuotas-event-filters">
          <label>
            <span className="form-label">Buscar</span>
            <input
              className="form-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Nombre, nro. socio o DNI"
              autoComplete="off"
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
        </div>
      </section>

      <div className="disc-pager">
        <span>
          {debtors.length === 0
            ? 'No se encontraron deudas'
            : `Mostrando ${safePage * PAGE_SIZE + 1} - ${Math.min(debtors.length, (safePage + 1) * PAGE_SIZE)} de ${debtors.length}`}
        </span>
        {debtors.length > PAGE_SIZE ? (
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
              <th>#</th>
              <th>Nro. socio</th>
              <th>Socio</th>
              <th>Cuota social</th>
              <th>Capital</th>
              <th>Intereses</th>
              <th>{period === 'all' ? 'Total deuda' : 'Acumulada'}</th>
              <th>Meses</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={9} style={{ color: 'var(--text-muted)' }}>Sin resultados.</td></tr>
            ) : pageRows.map((m, idx) => (
              <Fragment key={m.memberNumber}>
                <tr>
                  <td>{safePage * PAGE_SIZE + idx + 1}</td>
                  <td>{m.memberNumber}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.memberName}</div>
                    {m.standing ? (
                      <div className="disc-field-hint" style={{ margin: 0 }}>{m.standing}</div>
                    ) : null}
                  </td>
                  <td>{m.socialFee || '—'}</td>
                  <td>{formatLilaMoney(m.capital)}</td>
                  <td>{formatLilaMoney(m.interest)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>{formatLilaMoney(m.totalDebt)}</td>
                  <td>{(m.months || []).length}</td>
                  <td>
                    <button
                      type="button"
                      className="cash-lila-icon-btn is-edit"
                      title="Ver deuda mes a mes"
                      onClick={() => setSelected(m)}
                    >
                      <Eye size={13} />
                    </button>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
