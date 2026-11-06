import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { formatAccessinCashDate } from '../../domain/accounting/cashLedger';
import { cashIncomeCalendar } from '../../domain/accounting/liveCashLedger';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function shiftMonth(monthKey, delta) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return monthKey;
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function intensityClass(inflow, maxInflow) {
  if (!(inflow > 0) || !(maxInflow > 0)) return 'is-empty';
  const ratio = inflow / maxInflow;
  if (ratio >= 0.72) return 'is-hot';
  if (ratio >= 0.4) return 'is-warm';
  if (ratio >= 0.15) return 'is-soft';
  return 'is-tint';
}

export default function CashDayCalendar({
  ledger = [],
  monthKey = '',
  selectedDate = '',
  today = '',
  onSelectDay,
  onChangeMonth,
}) {
  const calendar = useMemo(
    () => cashIncomeCalendar(ledger, monthKey),
    [ledger, monthKey],
  );

  const [year, month] = String(calendar.monthKey || '').split('-').map(Number);
  const firstWeekday = year && month
    ? (new Date(year, month - 1, 1).getDay() + 6) % 7
    : 0;
  const blanks = Array.from({ length: firstWeekday }, (_, i) => i);
  const title = year && month
    ? `${MONTHS[month - 1]} ${year}`
    : 'Calendario';

  return (
    <section className="cash-day-cal" aria-label="Calendario de ingresos">
      <header className="cash-day-cal-head">
        <div className="cash-day-cal-title-wrap">
          <p className="cash-day-cal-kicker">Ingresos del mes</p>
          <h5 className="cash-day-cal-title serif-font">{title}</h5>
          <p className="cash-day-cal-meta">
            {formatCurrency(calendar.totalInflow)} · tocá un día para ver sus ingresos
          </p>
        </div>
        <div className="cash-day-cal-nav">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label="Mes anterior"
            onClick={() => onChangeMonth?.(shiftMonth(calendar.monthKey, -1))}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label="Mes siguiente"
            onClick={() => onChangeMonth?.(shiftMonth(calendar.monthKey, 1))}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </header>

      <div className="cash-day-cal-weekdays" aria-hidden>
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="cash-day-cal-grid">
        {blanks.map((i) => (
          <span key={`blank-${i}`} className="cash-day-cal-cell is-blank" />
        ))}
        {calendar.days.map((day) => {
          const selected = selectedDate === day.date;
          const isToday = today === day.date;
          const intensity = intensityClass(day.inflow, calendar.maxInflow);
          const label = formatAccessinCashDate(day.date);
          return (
            <button
              key={day.date}
              type="button"
              className={[
                'cash-day-cal-cell',
                intensity,
                selected ? 'is-selected' : '',
                isToday ? 'is-today' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={selected}
              aria-label={
                day.inflow > 0
                  ? `${label}: ${formatCurrency(day.inflow)}, ${day.count} ingresos`
                  : `${label}: sin ingresos`
              }
              onClick={() => onSelectDay?.(day.date)}
            >
              <span className="cash-day-cal-num">{Number(day.date.slice(8, 10))}</span>
              {day.inflow > 0 ? (
                <span className="cash-day-cal-amt">
                  {day.inflow >= 1000000
                    ? `${(day.inflow / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
                    : day.inflow >= 1000
                      ? `${Math.round(day.inflow / 1000)}k`
                      : Math.round(day.inflow)}
                </span>
              ) : (
                <span className="cash-day-cal-amt is-quiet">—</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
