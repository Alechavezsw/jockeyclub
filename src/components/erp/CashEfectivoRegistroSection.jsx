import { useMemo, useState } from 'react';
import { Eye, Printer, Share2, Trash2, X } from 'lucide-react';
import ModalDialog from '../ModalDialog';
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
                        title="Ver / imprimir"
                        aria-label="Ver o imprimir"
                        onClick={() => openDetail(row)}
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

      <ModalDialog
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        labelledBy="cash-payment-detail-title"
        contentStyle={{ maxWidth: 720, width: '100%' }}
      >
        {detail ? (
          <div className="cash-payment-detail">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
              <h3 id="cash-payment-detail-title" style={{ margin: 0, fontSize: '1rem', textTransform: 'uppercase' }}>
                {detail.title}
              </h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetail(null)} aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>

            <section className="cash-payment-detail-section">
              <h4>Información del pago</h4>
              <div className="cash-payment-detail-grid">
                <div>
                  <span className="cash-payment-detail-label">Fecha</span>
                  <div>{detail.dateLabel}</div>
                </div>
                <div>
                  <span className="cash-payment-detail-label">Descripción</span>
                  <div>{detail.description}</div>
                </div>
                <div>
                  <span className="cash-payment-detail-label">Comprobante</span>
                  <div>{detail.voucher || '—'}</div>
                </div>
              </div>
            </section>

            <section className="cash-payment-detail-section">
              <h4>Entradas imputadas</h4>
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Descripción</th>
                      <th>Monto</th>
                      <th>Cancelado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.applied.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                          {detail.typeLabel}: {detail.rawDescription || 'Sin imputaciones vinculadas en cobranzas.'}
                        </td>
                      </tr>
                    ) : (
                      detail.applied.map((line) => (
                        <tr key={line.id}>
                          <td>{formatAccessinCashDate(line.date)}</td>
                          <td>{line.type}</td>
                          <td>{line.description}</td>
                          <td>{formatCurrency(line.amount)}</td>
                          <td>{formatCurrency(line.cancelled)}</td>
                        </tr>
                      ))
                    )}
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right' }}>Saldo a favor imputado</td>
                      <td>{formatCurrency(detail.creditApplied)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right' }}>Excedente</td>
                      <td>{formatCurrency(detail.surplus)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total pago</td>
                      <td style={{ fontWeight: 800 }}>{formatCurrency(detail.paymentTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="cash-payment-detail-section">
              <h4>Formas de pago</h4>
              <div className="cash-payment-methods">
                {detail.paymentMethods.map((method) => (
                  <div key={method.id} className="cash-payment-method-card">
                    <div className="cash-payment-method-title">{method.label}</div>
                    <label className="cash-payment-detail-label">Monto</label>
                    <input className="form-input" readOnly value={Number(method.amount).toFixed(2)} />
                  </div>
                ))}
              </div>
            </section>

            <div className="cash-payment-detail-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>
                Volver
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
                <Printer size={14} /> Imprimir
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const text = `${detail.title}\nTotal: ${formatCurrency(detail.paymentTotal)}`;
                  try {
                    if (navigator.share) await navigator.share({ title: detail.title, text });
                    else if (navigator.clipboard) await navigator.clipboard.writeText(text);
                  } catch {
                    /* cancelado */
                  }
                }}
              >
                <Share2 size={14} /> Compartir
              </button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
