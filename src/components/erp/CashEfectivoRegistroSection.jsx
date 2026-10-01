import { useMemo, useState } from 'react';
import { Eye, Printer, Trash2 } from 'lucide-react';
import CashPaymentDetailDialog from './CashPaymentDetailDialog';
import { exportCashPaymentPdf } from '../../domain/accounting/exportCashPaymentPdf';
import {
  buildCashPaymentDetail,
  cashMovementsSaldo,
  isCashMemberPayment,
} from '../../domain/accounting/cashPaymentDetail';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  enrichCashMovementsWithMembers,
  filterAccessinCashMovements,
} from '../../domain/accounting/cashLedger';

const PAGE_SIZE = 10;

export default function CashEfectivoRegistroSection({
  movements = [],
  cobranzas = [],
  members = [],
  onBack,
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);

  const cashRows = useMemo(() => {
    const enriched = enrichCashMovementsWithMembers(
      filterAccessinCashMovements(movements, { walletKind: 'cash', query }),
      members
    );
    // Completar nombre desde cobranzas si falta
    return enriched.map((row) => {
      if (row.memberName) return row;
      const hit = cobranzas.find((c) => (
        String(c.memberNumber || '') === String(row.memberNumber || '')
        && String(c.date || '').slice(0, 10) === String(row.date || '').slice(0, 10)
      ));
      if (!hit) return row;
      return {
        ...row,
        memberName: hit.memberName,
        familyGroup: row.familyGroup || (hit.memberNumber ? `G-F ${hit.memberNumber}` : ''),
      };
    });
  }, [movements, members, cobranzas, query]);

  const totalPages = Math.max(1, Math.ceil(cashRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = cashRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from = cashRows.length ? safePage * PAGE_SIZE + 1 : 0;
  const to = Math.min(cashRows.length, (safePage + 1) * PAGE_SIZE);
  const saldo = cashMovementsSaldo(cashRows);

  const openDetail = (row) => {
    setDetail(buildCashPaymentDetail(row, cobranzas, members));
  };

  const pageButtons = useMemo(() => {
    const pages = [];
    const last = totalPages - 1;
    const push = (n) => {
      if (n >= 0 && n <= last && !pages.includes(n)) pages.push(n);
    };
    push(0);
    for (let i = Math.max(0, safePage - 2); i <= Math.min(last, safePage + 2); i += 1) push(i);
    push(last);
    return pages;
  }, [safePage, totalPages]);

  return (
    <div className="cash-efectivo-registro fade-in">
      <div className="cash-efectivo-registro-head">
        <h5 className="cash-lila-section-title" style={{ margin: 0 }}>Registros de efectivo</h5>
        <p className="cash-efectivo-registro-meta">
          Mostrando {from} - {to} en {cashRows.length}
        </p>
      </div>

      <div className="cash-efectivo-registro-toolbar">
        <input
          className="form-input"
          placeholder="Buscar socio, tipo, descripción…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <div className="cash-efectivo-pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Anterior
          </button>
          {pageButtons.map((n, idx) => {
            const prev = pageButtons[idx - 1];
            const gap = prev != null && n - prev > 1;
            return (
              <span key={n} style={{ display: 'inline-flex', gap: 4 }}>
                {gap ? <span className="cash-efectivo-ellipsis">…</span> : null}
                <button
                  type="button"
                  className={`cash-efectivo-page-btn${n === safePage ? ' is-active' : ''}`}
                  onClick={() => setPage(n)}
                >
                  {n + 1}
                </button>
              </span>
            );
          })}
          <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
            Siguiente
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Descripción</th>
              <th>Socio</th>
              <th>Grupo familiar</th>
              <th>Monto</th>
              <th>Funciones</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: 'var(--text-muted)' }}>
                  No hay registros de efectivo en el export Accessin del período.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.accessinId}</td>
                  <td>{formatAccessinCashDate(row.date)}</td>
                  <td>{row.typeLabel}</td>
                  <td>{row.description || '—'}</td>
                  <td>{row.memberName || '—'}</td>
                  <td>{row.familyGroup || '—'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
                    {formatCurrency(row.amount)}
                  </td>
                  <td>
                    <div className="cash-lila-row-actions">
                      {isCashMemberPayment(row) ? (
                        <button
                          type="button"
                          className="cash-lila-icon-btn is-view"
                          title="Ver pago"
                          aria-label="Ver pago"
                          onClick={() => openDetail(row)}
                        >
                          <Eye size={13} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="cash-lila-icon-btn is-print"
                        title="Recibo"
                        aria-label="Recibo"
                        onClick={() => exportCashPaymentPdf(buildCashPaymentDetail(row, cobranzas, members))}
                      >
                        <Printer size={13} />
                      </button>
                      <button type="button" className="cash-lila-icon-btn is-del" title="Eliminar" aria-label="Eliminar" disabled>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
            <tr className="cash-efectivo-saldo-row">
              <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>
                Saldo del listado (período exportado)
              </td>
              <td colSpan={2} style={{ fontWeight: 800, color: 'var(--emerald-accent)', fontSize: '1.15rem' }}>
                {formatCurrency(saldo)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="cash-efectivo-registro-foot">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Volver
        </button>
      </div>

      <CashPaymentDetailDialog detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
