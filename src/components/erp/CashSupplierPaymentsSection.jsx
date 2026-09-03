import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  ACCESSIN_SUPPLIER_PAYMENTS_AS_OF,
  ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS,
  ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
  filterAccessinSupplierPayments,
  supplierPaymentsBalanceCards,
} from '../../domain/accounting/supplierPaymentsReport';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';

export default function CashSupplierPaymentsSection({ items = [] }) {
  const [filter, setFilter] = useState({
    paymentMethod: null,
    query: '',
    showAll: false,
  });

  const cards = useMemo(
    () => supplierPaymentsBalanceCards(items, ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT),
    [items]
  );

  const rows = useMemo(
    () => filterAccessinSupplierPayments(items, {
      paymentMethod: filter.paymentMethod,
      query: filter.query,
      limit: filter.showAll ? null : 40,
    }),
    [items, filter]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h5 className="cash-lila-section-title">
          Pago a proveedores · {formatAccessinCashDate(ACCESSIN_SUPPLIER_PAYMENTS_AS_OF)}
        </h5>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Reporte LILA Accessin
          {ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.periodFrom
            ? ` · ${formatAccessinCashDate(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.periodFrom)} → ${formatAccessinCashDate(ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT.periodTo)}`
            : ''}
          {' · '}
          {items.length} orden(es).
        </p>
        <div className="cash-lila-cards">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`cash-lila-card${card.emphasize ? ' is-total' : ''}`}
            >
              <div className="cash-lila-card-label">{card.label}</div>
              <div className="cash-lila-card-value">
                {card.isCount ? card.value : formatCurrency(card.value)}
              </div>
              <div className="cash-lila-card-caption">{card.caption}</div>
              {card.filter?.paymentMethod ? (
                <button
                  type="button"
                  className="cash-lila-card-btn"
                  onClick={() => setFilter((f) => ({
                    ...f,
                    paymentMethod: card.filter.paymentMethod,
                    showAll: false,
                  }))}
                >
                  Filtrar medio
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="form-input"
          style={{ maxWidth: 200 }}
          value={filter.paymentMethod || ''}
          onChange={(e) => setFilter((f) => ({
            ...f,
            paymentMethod: e.target.value || null,
            showAll: false,
          }))}
        >
          <option value="">Todos los medios</option>
          {Object.entries(ACCESSIN_SUPPLIER_PAYMENTS_METHOD_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <label className="cash-lila-search">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Proveedor, OP, concepto, comprobante…"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
        </label>
        {(filter.paymentMethod || filter.query) ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter({ paymentMethod: null, query: '', showAll: false })}
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>OP</th>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Concepto</th>
              <th>Comprobante</th>
              <th>Medio</th>
              <th>Banco</th>
              <th>Confecciona</th>
              <th>Autoriza</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ color: 'var(--text-muted)' }}>
                  Sin pagos a proveedores en el reporte Accessin al {formatAccessinCashDate(ACCESSIN_SUPPLIER_PAYMENTS_AS_OF)}.
                  Cuando haya movimientos en LILA, regenerá el seed.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.orderId}</td>
                  <td>{formatAccessinCashDate(row.date)}</td>
                  <td>{row.supplierName || '—'}</td>
                  <td>{row.concept || '—'}</td>
                  <td>{row.invoiceNumber || '—'}</td>
                  <td>{row.paymentMethodLabel || '—'}</td>
                  <td>{row.bankName || '—'}</td>
                  <td>{row.preparedBy || '—'}</td>
                  <td>{row.authorizedBy || '—'}</td>
                  <td style={{ fontWeight: 700, color: '#f59e0b' }}>
                    {formatCurrency(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!filter.showAll && items.length > 40 ? (
        <button
          type="button"
          className="cash-lila-see-all"
          onClick={() => setFilter((f) => ({ ...f, showAll: true }))}
        >
          Ver todos los pagos
        </button>
      ) : filter.showAll ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setFilter((f) => ({ ...f, showAll: false }))}
        >
          Ver solo primeras 40
        </button>
      ) : null}
    </div>
  );
}
