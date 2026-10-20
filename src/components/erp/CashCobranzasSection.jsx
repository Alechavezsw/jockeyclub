import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  cobranzasBalanceCards,
  cobranzasSeed,
  filterAccessinCobranzas,
} from '../../domain/accounting/cobranzas';
import {
  cashMovementMonthSheets,
  formatAccessinCashDate,
} from '../../domain/accounting/cashLedger';
import { formatCurrency } from '../../domain/accounting/journal';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

export default function CashCobranzasSection(props) {
  return (
    <SnapshotGate names={['accessinCobranzas']}>
      <CashCobranzasContent {...props} />
    </SnapshotGate>
  );
}

function CashCobranzasContent({ items = [], asOf, periodTo, extraCount = 0, cutoff }) {
  const {
    ACCESSIN_COBRANZAS_AS_OF,
    ACCESSIN_COBRANZAS_METHOD_LABELS,
    ACCESSIN_COBRANZAS_SNAPSHOT,
  } = useSnapshotSeed(['accessinCobranzas'], cobranzasSeed);
  const liveAsOf = asOf || ACCESSIN_COBRANZAS_AS_OF;
  const livePeriodTo = periodTo || ACCESSIN_COBRANZAS_SNAPSHOT.periodTo;
  const [filter, setFilter] = useState({
    type: null,
    paymentMethod: null,
    query: '',
    showAll: false,
  });
  const [sheetMonth, setSheetMonth] = useState('');

  const cards = useMemo(
    () => cobranzasBalanceCards(items, {
      ...ACCESSIN_COBRANZAS_SNAPSHOT,
      asOf: liveAsOf,
      periodTo: livePeriodTo,
    }),
    [items, ACCESSIN_COBRANZAS_SNAPSHOT, liveAsOf, livePeriodTo]
  );

  const monthSheets = useMemo(() => cashMovementMonthSheets(items), [items]);
  const todayMonth = String(liveAsOf || '').slice(0, 7);
  const activeMonth = monthSheets.some((sheet) => sheet.key === sheetMonth)
    ? sheetMonth
    : (monthSheets.find((sheet) => sheet.key === todayMonth)?.key || monthSheets[0]?.key || '');
  const activeSheet = monthSheets.find((sheet) => sheet.key === activeMonth) || null;
  const activeSheetIndex = monthSheets.findIndex((sheet) => sheet.key === activeMonth);
  const newerSheet = activeSheetIndex > 0 ? monthSheets[activeSheetIndex - 1] : null;
  const olderSheet = activeSheetIndex >= 0 ? monthSheets[activeSheetIndex + 1] || null : null;

  const rows = useMemo(
    () => filterAccessinCobranzas(items, {
      type: filter.type,
      paymentMethod: filter.paymentMethod,
      query: filter.query,
      monthKey: activeMonth || null,
      limit: filter.showAll ? null : 40,
    }),
    [items, filter, activeMonth]
  );

  const types = useMemo(
    () => [...new Set((items || []).map((r) => r.type || 'Otros').filter(Boolean))].sort(),
    [items]
  );

  const methodLabels = useMemo(() => {
    const labels = { ...ACCESSIN_COBRANZAS_METHOD_LABELS };
    (items || []).forEach((row) => {
      if (row.paymentMethod && !labels[row.paymentMethod]) {
        labels[row.paymentMethod] = row.paymentMethodLabel || row.paymentMethod;
      }
    });
    return labels;
  }, [ACCESSIN_COBRANZAS_METHOD_LABELS, items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h5 className="cash-lila-section-title">
          Cobranzas · {formatAccessinCashDate(liveAsOf)}
        </h5>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Cobros del club al día (recibo, socio y medio). No es el saldo de caja.
          {' '}Período {formatAccessinCashDate(ACCESSIN_COBRANZAS_SNAPSHOT.periodFrom)} → {formatAccessinCashDate(livePeriodTo)}
          {' · '}
          {items.length} líneas
          {extraCount > 0
            ? ` · ${extraCount} posteriores al ${formatAccessinCashDate(cutoff)}`
            : ''}
          .
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
          {Object.entries(methodLabels).map(([id, label]) => (
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

      {activeSheet ? (
        <div className="cash-month-sheet-nav">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!olderSheet}
            aria-label="Mes anterior"
            onClick={() => olderSheet && setSheetMonth(olderSheet.key)}
          >
            <ChevronLeft size={14} />
            {olderSheet ? olderSheet.label.replace(/ de \d{4}$/, '') : 'Anterior'}
          </button>
          <div className="cash-month-sheet-title">
            <span className="cash-month-sheet-kicker">Una hoja</span>
            <strong className="cash-month-sheet-name serif-font">{activeSheet.label}</strong>
            <span className="cash-month-sheet-meta">
              {activeSheet.count.toLocaleString('es-AR')} cobros
            </span>
          </div>
          <label className="cash-month-sheet-jump">
            <select
              className="form-input"
              aria-label="Elegir mes"
              value={activeMonth}
              onChange={(e) => setSheetMonth(e.target.value)}
            >
              {monthSheets.map((sheet) => (
                <option key={sheet.key} value={sheet.key}>{sheet.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!newerSheet}
            aria-label="Mes siguiente"
            onClick={() => newerSheet && setSheetMonth(newerSheet.key)}
          >
            {newerSheet ? newerSheet.label.replace(/ de \d{4}$/, '') : 'Siguiente'}
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}

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

      {!filter.showAll && (activeSheet?.count || items.length) > 40 ? (
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
