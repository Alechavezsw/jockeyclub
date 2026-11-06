import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  buildLiveSupplierPayments,
  filterAccessinSupplierPayments,
  supplierPaymentsSeed,
} from '../../domain/accounting/supplierPaymentsReport';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

function formatCashAmount(value) {
  return formatCurrency(Number(value) || 0);
}

export default function CashSupplierPaymentsSection(props) {
  return (
    <SnapshotGate names={['accessinSupplierPayments']}>
      <CashSupplierPaymentsContent {...props} />
    </SnapshotGate>
  );
}

function CashSupplierPaymentsContent({
  items = [],
  paymentOrders = [],
  expenses = [],
}) {
  const { ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT } = useSnapshotSeed(
    ['accessinSupplierPayments'],
    supplierPaymentsSeed,
  );
  const live = useMemo(
    () => buildLiveSupplierPayments({
      items,
      snapshot: ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT,
      paymentOrders,
      expenses,
    }),
    [items, ACCESSIN_SUPPLIER_PAYMENTS_SNAPSHOT, paymentOrders, expenses],
  );
  const cards = live.cards || [];
  const [filter, setFilter] = useState({
    paymentMethod: null,
    query: '',
    showAll: false,
    onDate: null,
  });

  const methodLabels = useMemo(() => {
    const labels = { ...live.methodLabels };
    live.rows.forEach((row) => {
      if (row.paymentMethod && !labels[row.paymentMethod]) {
        labels[row.paymentMethod] = row.paymentMethodLabel || row.paymentMethod;
      }
    });
    return labels;
  }, [live.methodLabels, live.rows]);

  const rows = useMemo(
    () => filterAccessinSupplierPayments(live.rows, {
      paymentMethod: filter.paymentMethod,
      query: filter.query,
      onDate: filter.onDate || null,
      monthKey: filter.onDate ? null : (live.monthKey || null),
      limit: filter.showAll ? null : 40,
    }),
    [live.rows, live.monthKey, filter],
  );

  function openDayPayments(paymentMethod = null) {
    setFilter((f) => ({
      ...f,
      paymentMethod: paymentMethod || null,
      onDate: live.asOf,
      showAll: true,
      query: '',
    }));
  }

  function openMonthMethod(paymentMethod = null) {
    setFilter((f) => ({
      ...f,
      paymentMethod: paymentMethod || null,
      onDate: null,
      showAll: false,
      query: '',
    }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="cash-lila-balance-block">
        <div className="cash-day-strip">
          <div className="cash-day-strip-copy">
            <p className="cash-day-strip-kicker">
              Pago a proveedores · {live.asOfLabel}
            </p>
            <p className="cash-day-strip-lead">
              Órdenes y gastos pagados al día. Abajo, solo el acumulado de{' '}
              {live.monthLabel || 'este mes'}. No es el saldo de proveedores.
              {live.extraCount > 0
                ? ` · ${live.extraCount} posteriores al ${live.cutoffLabel}`
                : ''}
            </p>
          </div>
          <div className="cash-day-strip-total">
            <span className="cash-day-strip-total-label">Pagado hoy</span>
            <strong className="cash-day-strip-total-value serif-font">
              {formatCashAmount(live.dayTotal || 0)}
            </strong>
            <span className="cash-day-strip-total-meta">
              {(live.dayCount || 0) === 1
                ? '1 pago'
                : `${live.dayCount || 0} pagos`}
            </span>
          </div>
        </div>

        <div className="cash-lila-cards cash-lila-cards--lila cash-lila-cards--four">
          {cards.filter((c) => c.id !== 'total').map((card) => {
            const dayAmount = Number(card.dayInflow) || 0;
            const monthAmount = Number(card.monthInflow) || 0;
            const hasDay = dayAmount > 0;
            return (
              <button
                key={card.id}
                type="button"
                className={[
                  'cash-pocket-card',
                  hasDay ? 'has-day' : 'no-day',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  if (hasDay) openDayPayments(card.filter?.paymentMethod || null);
                  else openMonthMethod(card.filter?.paymentMethod || null);
                }}
              >
                <div className="cash-pocket-card-top">
                  <span className="cash-pocket-card-name">{card.label}</span>
                </div>
                <div className="cash-pocket-card-day">
                  <span className="cash-pocket-card-day-label">
                    {hasDay ? 'Pagado hoy' : 'Hoy sin pagos'}
                  </span>
                  <strong className={`cash-pocket-card-day-value${hasDay ? '' : ' is-zero'}`}>
                    {hasDay ? formatCashAmount(dayAmount) : '$ 0'}
                  </strong>
                  {hasDay ? (
                    <span className="cash-pocket-card-day-meta">
                      {card.dayCount === 1 ? '1 pago' : `${card.dayCount || 0} pagos`}
                      {' · tocá para verlos'}
                    </span>
                  ) : (
                    <span className="cash-pocket-card-day-meta">
                      Sin pagos de este medio hoy
                    </span>
                  )}
                </div>
                <div className="cash-pocket-card-stock">
                  <span className="cash-pocket-card-stock-label">
                    En el mes · {live.monthLabel || ''}
                  </span>
                  <span className="cash-pocket-card-stock-value">
                    {formatCashAmount(monthAmount)}
                  </span>
                  {card.monthCount > 0 ? (
                    <span className="cash-pocket-card-stock-meta">
                      {card.monthCount === 1 ? '1 pago' : `${card.monthCount} pagos`}
                      {' del mes'}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="cash-lila-balance-lower">
          {cards.filter((c) => c.id === 'total').map((card) => {
            const dayAmount = Number(card.dayInflow) || 0;
            const monthAmount = Number(card.monthInflow) || 0;
            return (
              <button
                key={card.id}
                type="button"
                className="cash-pocket-card cash-pocket-card--total has-day"
                onClick={() => openDayPayments(null)}
              >
                <div className="cash-pocket-card-top">
                  <span className="cash-pocket-card-name">Pagos del día</span>
                </div>
                <div className="cash-pocket-card-day">
                  <span className="cash-pocket-card-day-label">Pagado hoy en total</span>
                  <strong className="cash-pocket-card-day-value">
                    {dayAmount > 0 ? formatCashAmount(dayAmount) : '$ 0'}
                  </strong>
                  <span className="cash-pocket-card-day-meta">
                    {card.dayCount === 1 ? '1 pago' : `${card.dayCount || 0} pagos`}
                    {' · ver el día'}
                  </span>
                </div>
                <div className="cash-pocket-card-stock">
                  <span className="cash-pocket-card-stock-label">
                    En el mes · {live.monthLabel || ''}
                  </span>
                  <span className="cash-pocket-card-stock-value">
                    {formatCashAmount(monthAmount)}
                  </span>
                  {card.monthCount > 0 ? (
                    <span className="cash-pocket-card-stock-meta">
                      {card.monthCount === 1 ? '1 pago' : `${card.monthCount} pagos`}
                      {' del mes'}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
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
          {Object.entries(methodLabels).map(([id, label]) => (
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
        {filter.onDate ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter((f) => ({ ...f, onDate: null, showAll: false }))}
          >
            Ver mes completo
          </button>
        ) : null}
        {(filter.paymentMethod || filter.query || filter.onDate) ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter({ paymentMethod: null, query: '', showAll: false, onDate: null })}
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
                  No hay pagos a proveedores con este filtro.
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

      {!filter.showAll && (filter.onDate ? rows.length >= 40 : (live.monthCount || live.rows.length) > 40) ? (
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
          Ver solo primeros 40
        </button>
      ) : null}
    </div>
  );
}
