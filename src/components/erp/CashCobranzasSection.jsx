import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import {
  cobranzasBalanceCards,
  cobranzasSeed,
  filterAccessinCobranzas,
} from '../../domain/accounting/cobranzas';
import {
  cashMovementMonthSheets,
  formatAccessinCashDate,
} from '../../domain/accounting/cashLedger';
import {
  buildCashPaymentDetailFromCobranza,
  cashReceiptLabel,
  matchMemberPaymentForCobranza,
} from '../../domain/accounting/cashPaymentDetail';
import { exportCashPaymentPdf } from '../../domain/accounting/exportCashPaymentPdf';
import { downloadPaymentReceiptPdf } from '../../domain/members/exportPaymentReceiptPdf';
import { formatCurrency } from '../../domain/accounting/journal';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

function formatCashAmount(value, { withArs = false } = {}) {
  const money = formatCurrency(Number(value) || 0);
  return withArs ? `${money} (ARS)` : money;
}

export default function CashCobranzasSection(props) {
  return (
    <SnapshotGate names={['accessinCobranzas']}>
      <CashCobranzasContent {...props} />
    </SnapshotGate>
  );
}

function CashCobranzasContent({ items = [], members = [], asOf, periodTo, extraCount = 0, cutoff }) {
  const [receiptError, setReceiptError] = useState('');
  const [receiptBusyId, setReceiptBusyId] = useState('');
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
    onDate: null,
  });
  const [sheetMonth, setSheetMonth] = useState('');

  const balance = useMemo(
    () => cobranzasBalanceCards(items, {
      ...ACCESSIN_COBRANZAS_SNAPSHOT,
      asOf: liveAsOf,
      periodTo: livePeriodTo,
    }),
    [items, ACCESSIN_COBRANZAS_SNAPSHOT, liveAsOf, livePeriodTo]
  );
  const cards = balance.cards || [];

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
      onDate: filter.onDate || null,
      monthKey: filter.onDate ? null : (activeMonth || null),
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

  function openDayCobranzas(type = null) {
    setFilter((f) => ({
      ...f,
      type: type || null,
      onDate: liveAsOf,
      showAll: true,
      query: '',
    }));
    if (todayMonth) setSheetMonth(todayMonth);
  }

  function openMonthType(type = null) {
    setFilter((f) => ({
      ...f,
      type: type || null,
      onDate: null,
      showAll: false,
      query: '',
    }));
    if (todayMonth) setSheetMonth(todayMonth);
  }

  async function downloadCobranzaReceipt(row) {
    const key = String(row?.id || row?.receiptId || '');
    setReceiptError('');
    setReceiptBusyId(key);
    try {
      const matched = matchMemberPaymentForCobranza(row, members);
      if (matched?.member && matched?.payment) {
        await downloadPaymentReceiptPdf(matched);
        return;
      }
      const detail = buildCashPaymentDetailFromCobranza(row, members);
      if (!detail) throw new Error('No se pudo armar el recibo.');
      await exportCashPaymentPdf(detail);
    } catch (err) {
      setReceiptError(err?.message || 'No se pudo descargar el recibo.');
    } finally {
      setReceiptBusyId('');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="cash-lila-balance-block">
        <div className="cash-day-strip">
          <div className="cash-day-strip-copy">
            <p className="cash-day-strip-kicker">
              Cobranzas · {balance.asOfLabel || formatAccessinCashDate(liveAsOf)}
            </p>
            <p className="cash-day-strip-lead">
              Cobros del club al día (recibo, socio y medio). Abajo, solo el acumulado de{' '}
              {balance.monthLabel || 'este mes'}. No es el saldo de caja.
              {extraCount > 0
                ? ` · ${extraCount} posteriores al ${formatAccessinCashDate(cutoff)}`
                : ''}
            </p>
          </div>
          <div className="cash-day-strip-total">
            <span className="cash-day-strip-total-label">Cobrado hoy</span>
            <strong className="cash-day-strip-total-value serif-font">
              {formatCashAmount(balance.dayTotal || 0)}
            </strong>
            <span className="cash-day-strip-total-meta">
              {(balance.dayCount || 0) === 1
                ? '1 cobro'
                : `${balance.dayCount || 0} cobros`}
            </span>
          </div>
        </div>

        {receiptError ? (
          <p style={{ margin: '0 0 0.65rem', fontSize: '0.8rem', color: 'var(--danger, #b42318)' }}>
            {receiptError}
          </p>
        ) : null}

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
                  if (hasDay) openDayCobranzas(card.filter?.type || null);
                  else openMonthType(card.filter?.type || null);
                }}
              >
                <div className="cash-pocket-card-top">
                  <span className="cash-pocket-card-name">{card.label}</span>
                </div>
                <div className="cash-pocket-card-day">
                  <span className="cash-pocket-card-day-label">
                    {hasDay ? 'Cobrado hoy' : 'Hoy sin cobros'}
                  </span>
                  <strong className={`cash-pocket-card-day-value${hasDay ? '' : ' is-zero'}`}>
                    {hasDay ? `+${formatCashAmount(dayAmount)}` : '$ 0'}
                  </strong>
                  {hasDay ? (
                    <span className="cash-pocket-card-day-meta">
                      {card.dayCount === 1 ? '1 cobro' : `${card.dayCount || 0} cobros`}
                      {' · tocá para verlos'}
                    </span>
                  ) : (
                    <span className="cash-pocket-card-day-meta">
                      Sin cobros de este tipo hoy
                    </span>
                  )}
                </div>
                <div className="cash-pocket-card-stock">
                  <span className="cash-pocket-card-stock-label">
                    En el mes · {balance.monthLabel || ''}
                  </span>
                  <span className="cash-pocket-card-stock-value">
                    {formatCashAmount(monthAmount)}
                  </span>
                  {card.monthCount > 0 ? (
                    <span className="cash-pocket-card-stock-meta">
                      {card.monthCount === 1 ? '1 cobro' : `${card.monthCount} cobros`}
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
                onClick={() => openDayCobranzas(null)}
              >
                <div className="cash-pocket-card-top">
                  <span className="cash-pocket-card-name">Cobranzas del día</span>
                </div>
                <div className="cash-pocket-card-day">
                  <span className="cash-pocket-card-day-label">Cobrado hoy en total</span>
                  <strong className="cash-pocket-card-day-value">
                    {dayAmount > 0 ? `+${formatCashAmount(dayAmount)}` : '$ 0'}
                  </strong>
                  <span className="cash-pocket-card-day-meta">
                    {card.dayCount === 1 ? '1 cobro' : `${card.dayCount || 0} cobros`}
                    {' · ver el día'}
                  </span>
                </div>
                <div className="cash-pocket-card-stock">
                  <span className="cash-pocket-card-stock-label">
                    En el mes · {balance.monthLabel || ''}
                  </span>
                  <span className="cash-pocket-card-stock-value">
                    {formatCashAmount(monthAmount)}
                  </span>
                  {card.monthCount > 0 ? (
                    <span className="cash-pocket-card-stock-meta">
                      {card.monthCount === 1 ? '1 cobro' : `${card.monthCount} cobros`}
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
        {filter.onDate ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter((f) => ({ ...f, onDate: null, showAll: false }))}
          >
            Ver mes completo
          </button>
        ) : null}
        {(filter.type || filter.paymentMethod || filter.query || filter.onDate) ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFilter({ type: null, paymentMethod: null, query: '', showAll: false, onDate: null })}
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
            <span className="cash-month-sheet-kicker">
              {filter.onDate ? `Día · ${formatAccessinCashDate(filter.onDate)}` : 'Una hoja'}
            </span>
            <strong className="cash-month-sheet-name serif-font">{activeSheet.label}</strong>
            <span className="cash-month-sheet-meta">
              {filter.onDate
                ? `${rows.length.toLocaleString('es-AR')} cobros del día`
                : `${activeSheet.count.toLocaleString('es-AR')} cobros`}
            </span>
          </div>
          <label className="cash-month-sheet-jump">
            <select
              className="form-input"
              aria-label="Elegir mes"
              value={activeMonth}
              onChange={(e) => {
                setSheetMonth(e.target.value);
                setFilter((f) => ({ ...f, onDate: null, showAll: false }));
              }}
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
              rows.map((row) => {
                const receiptKey = String(row.id || row.receiptId || '');
                const label = cashReceiptLabel(row.receiptId) || 'Recibo';
                const busy = receiptBusyId === receiptKey;
                return (
                  <tr key={row.id}>
                    <td>{row.type}</td>
                    <td>
                      {row.receiptId ? (
                        <button
                          type="button"
                          className="cash-lila-receipt-link"
                          title="Descargar recibo PDF"
                          aria-label={`Descargar recibo ${label}`}
                          disabled={busy}
                          onClick={() => { void downloadCobranzaReceipt(row); }}
                        >
                          <Download size={12} aria-hidden />
                          <span>{busy ? 'Bajando…' : label}</span>
                        </button>
                      ) : '—'}
                    </td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!filter.showAll && (filter.onDate ? rows.length >= 40 : (activeSheet?.count || 0) > 40) ? (
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
