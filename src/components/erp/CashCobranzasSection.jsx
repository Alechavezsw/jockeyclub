import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  ACCESSIN_COBRANZAS_AS_OF,
  ACCESSIN_COBRANZAS_METHOD_LABELS,
  ACCESSIN_COBRANZAS_SNAPSHOT,
  cobranzasBalanceCards,
  filterAccessinCobranzas,
} from '../../domain/accounting/cobranzas';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';

export default function CashCobranzasSection({ items = [] }) {
  const [filter, setFilter] = useState({
    type: null,
    paymentMethod: null,
    query: '',
    showAll: false,
  });

  const cards = useMemo(() => cobranzasBalanceCards(items, ACCESSIN_COBRANZAS_SNAPSHOT), [items]);

  const rows = useMemo(
    () => filterAccessinCobranzas(items, {
      type: filter.type,
      paymentMethod: filter.paymentMethod,
      query: filter.query,
      limit: filter.showAll ? null : 40,
    }),
    [items, filter]
  );

  const types = useMemo(
    () => [...new Set((items || []).map((r) => r.type).filter(Boolean))].sort(),
    [items]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h5 className="cash-lila-section-title">
          Cobranzas Accessin · {formatAccessinCashDate(ACCESSIN_COBRANZAS_AS_OF)}
        </h5>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Período {formatAccessinCashDate(ACCESSIN_COBRANZAS_SNAPSHOT.periodFrom)} → {formatAccessinCashDate(ACCESSIN_COBRANZAS_SNAPSHOT.periodTo)} · {items.length} líneas del reporte LILA.
        </p>
        <div className="cash-lila-cards">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`cash-lila-card${card.emphasize ? ' is-total' : ''}`}
            >
              <div className="cash-lila-card-label">{card.label}</div>
              <div className="cash-lila-card-value">{formatCurrency(card.value)}</div>
              <div className="cash-lila-card-caption">{card.caption}</div>
              {card.filter?.type ? (
                <button
                  type="button"
                  className="cash-lila-card-btn"
                  onClick={() => setFilter((f) => ({ ...f, type: card.filter.type, showAll: false }))}
                >
                  Filtrar {card.filter.type}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="form-input"
          style={{ maxWidth: 180 }}
          value={filter.type || ''}
          onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value || null, showAll: false }))}
        >
          <option value="">Todos los tipos</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ maxWidth: 200 }}
          value={filter.paymentMethod || ''}
          onChange={(e) => setFilter((f) => ({ ...f, paymentMethod: e.target.value || null, showAll: false }))}
        >
          <option value="">Todos los medios</option>
          {Object.entries(ACCESSIN_COBRANZAS_METHOD_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <label className="cash-lila-search">
          <Search size={14} />
          <input
            className="form-input"
            placeholder="Socio, recibo, concepto, DNI…"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
        </label>
        {(filter.type || filter.paymentMethod || filter.query) ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter({ type: null, paymentMethod: null, query: '', showAll: false })}
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Recibo</th>
              <th>Fecha</th>
              <th>Socio</th>
              <th>Nombre</th>
              <th>Concepto</th>
              <th>Medio</th>
              <th>Banco</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: 'var(--text-muted)' }}>
                  No hay cobranzas con este filtro.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.type}</td>
                  <td>{row.receiptId}</td>
                  <td>{formatAccessinCashDate(row.date)}</td>
                  <td>{row.memberNumber || '—'}</td>
                  <td>{row.memberName || '—'}</td>
                  <td>{row.concept || '—'}</td>
                  <td>{row.paymentMethodLabel || '—'}</td>
                  <td>{row.bankName || '—'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--emerald-accent)' }}>
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
          Ver todas las cobranzas
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
