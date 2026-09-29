import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ChevronDown } from 'lucide-react';
import { buildWhatsAppDuesUrl, duesDueMoment } from '../../domain/members/dues';
import { memberNumberOf } from '../../domain/members/households';
import { todayISODateAR } from '../../lib/arDate';
import { formatCurrency } from '../../domain/accounting/journal';
import { composeClubFinance, financeFromMonthlySummary, lilaContabilidadFromSnapshots } from '../../domain/accounting/opsFinanceSnapshot';
import { monthlyBalanceSeed } from '../../domain/accounting/monthlyBalance';
import { monthlyBalanceSummarySeed } from '../../domain/accounting/monthlyBalanceSummary';
import {
  detailedCcSeed,
  listUnpaidFeeMembersForPeriod,
  periodKeyFromDate,
} from '../../domain/accounting/detailedCurrentAccounts';
import { cashSeed } from '../../domain/accounting/cashLedger';
import { cobranzasSeed } from '../../domain/accounting/cobranzas';
import { useSnapshotSeed } from '../../hooks/useSnapshots';

const LILA_MONEY_SNAPSHOTS = [
  'accessinMonthlyBalance',
  'accessinMonthlyBalanceSummary',
  'accessinDetailedCurrentAccounts',
  'accessinCashSnapshot',
  'accessinCobranzas',
];

function readLilaMoney() {
  const summary = monthlyBalanceSummarySeed();
  const currentMonth = financeFromMonthlySummary({
    snapshot: summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT,
    sections: summary.ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
  });
  const detailed = lilaContabilidadFromSnapshots({
    monthlySnapshot: monthlyBalanceSeed().ACCESSIN_MONTHLY_BALANCE_SNAPSHOT,
    detailedSnapshot: detailedCcSeed().ACCESSIN_DETAILED_CC_SNAPSHOT,
    cashSnapshot: cashSeed().ACCESSIN_CASH_SNAPSHOT,
    cobranzas: cobranzasSeed().ACCESSIN_COBRANZAS,
  });
  if (!currentMonth) return detailed;
  return {
    ...currentMonth,
    lastIncomes: detailed?.lastIncomes || [],
  };
}

function monthFromPeriod(periodTo, fallback) {
  if (!periodTo) return fallback;
  const [y, m] = String(periodTo).split('-');
  const raw = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function WhatsAppLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function membersByNumber(members = []) {
  const map = new Map();
  for (const member of members) {
    const key = memberNumberOf(member);
    if (key) map.set(key, member);
  }
  return map;
}

function DueUnpaidMonthList({ rows = [], monthLabel = '', formatMoney = formatCurrency, members = [] }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!q) return rows;
    return rows.filter((row) => {
      const name = String(row.memberName || '').toLowerCase();
      const number = String(row.memberNumber || '');
      return name.includes(q) || (digits && number.includes(digits));
    });
  }, [rows, deferredQuery]);
  const roster = useMemo(() => membersByNumber(members), [members]);
  const totalOwed = rows.reduce((sum, row) => sum + (Number(row.owed) || 0), 0);
  const count = rows.length;
  if (count === 0) return null;

  return (
    <details className="due-unpaid">
      <summary className="due-unpaid-summary">
        <i className="due-fold-arrow" aria-hidden="true">
          <ChevronDown size={18} strokeWidth={2.5} />
        </i>
        <span>
          {count === 1 ? '1 socio no pagó' : `${count.toLocaleString('es-AR')} socios no pagaron`}
          {monthLabel ? ` ${monthLabel}` : ''}
        </span>
        <b className="tabular-nums">{formatMoney(totalOwed)}</b>
      </summary>
      <div className="due-unpaid-body">
        <label className="due-unpaid-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nombre o Nº"
            aria-label="Buscar en quienes no pagaron"
          />
        </label>
        <p className="due-unpaid-hint">
          {visible.length === count
            ? 'Lista completa del mes. Cobrar abre la ficha; WhatsApp manda el aviso.'
            : `${visible.length.toLocaleString('es-AR')} de ${count.toLocaleString('es-AR')}`}
        </p>
        <ol className="due-unpaid-list">
          {visible.map((row) => {
            const id = row.memberNumber;
            const member = roster.get(String(id).replace(/\D/g, '')) || roster.get(String(id));
            const profileTo = `/panel/members/${encodeURIComponent(id)}`;
            const wa = buildWhatsAppDuesUrl({
              name: member?.name || row.memberName,
              phone: member?.phone,
              amountDue: row.owed,
              dueDate: member?.nextDueDate || member?.dueDate,
            }, formatMoney);
            return (
              <li key={id || row.memberName} className="due-unpaid-row">
                <Link to={`${profileTo}?cobrar=1`} className="due-unpaid-who">
                  <strong>{row.memberName}</strong>
                  <span>Nº {id}</span>
                </Link>
                <b className="tabular-nums">{formatMoney(row.owed)}</b>
                <div className="due-unpaid-actions">
                  <Link
                    className="admin-overdue-btn admin-overdue-btn--icon"
                    to={`${profileTo}?cobrar=1`}
                    state={{ cobrar: true, memberId: id, member }}
                    title={`Cobrar a ${row.memberName}`}
                    aria-label={`Cobrar a ${row.memberName}`}
                  >
                    <Banknote size={16} aria-hidden="true" />
                  </Link>
                  {wa ? (
                    <a
                      className="admin-overdue-btn admin-overdue-btn--wa"
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`WhatsApp ${member.phone}`}
                      aria-label={`WhatsApp a ${row.memberName}`}
                    >
                      <WhatsAppLogo size={18} />
                    </a>
                  ) : (
                    <span className="admin-overdue-btn admin-overdue-btn--wa is-disabled" aria-hidden="true">
                      <WhatsAppLogo size={18} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

export default function DuesDueBanner({
  enabled = true,
  today = todayISODateAR(),
  members = [],
  journalEntries = [],
  chartOfAccounts = [],
  feePeriods = [],
  afterCollect = null,
}) {
  const moment = duesDueMoment(today);
  const lilaCut = useSnapshotSeed(enabled ? LILA_MONEY_SNAPSHOTS : [], readLilaMoney);
  const money = useMemo(
    () => composeClubFinance({
      lila: lilaCut,
      members,
      journalEntries,
      chartOfAccounts,
      feePeriods,
      today,
    }) || lilaCut,
    [lilaCut, members, journalEntries, chartOfAccounts, feePeriods, today],
  );
  const periodKey = periodKeyFromDate(money?.periodTo) || periodKeyFromDate(money?.periodKey);
  const unpaidRows = useMemo(
    () => (enabled && periodKey ? listUnpaidFeeMembersForPeriod(periodKey) : []),
    [enabled, periodKey, money],
  );
  if (!enabled) return null;

  const collected = Number(money?.recaudado) || 0;
  const liquidated = Number(money?.liquidado) || 0;
  const hasCut = collected > 0 || liquidated > 0;
  const pending = Math.max(0, liquidated - collected);
  const rate = liquidated > 0 ? Math.min(100, Math.round((collected / liquidated) * 100)) : 0;
  const monthLabel = monthFromPeriod(money?.periodTo, `${moment.monthName} ${moment.year}`);
  const urgent = moment.phase === 'today' || moment.phase === 'after';

  let headline = `El vencimiento es el ${moment.dueLabel}`;
  let detail = moment.daysUntil === 1
    ? 'Falta 1 día.'
    : `Faltan ${moment.daysUntil} días.`;
  if (moment.phase === 'today') {
    headline = 'Hoy vencen las cuotas';
    detail = `El vencimiento es el ${moment.dueLabel}.`;
  } else if (moment.phase === 'after') {
    headline = `Vencieron el ${moment.dueLabel}`;
    detail = moment.daysSince === 1
      ? 'Pasó 1 día del vencimiento.'
      : `Pasaron ${moment.daysSince} días del vencimiento.`;
  }

  return (
    <div className="due-collect-stack">
      <section className={`due-collect phase-${moment.phase}`} aria-label="Vencimiento y recaudación">
        <div className="due-collect-copy">
          <p className="due-collect-kicker">Vencimiento · día {moment.dueDay}</p>
          <h2>{headline}</h2>
          <p>{detail}</p>
        </div>
        <div className="due-collect-money">
          <p className="due-collect-kicker">Recaudado{hasCut ? ` · ${monthLabel}` : ''}</p>
          <p className="due-collect-amount tabular-nums">
            {hasCut ? formatCurrency(collected) : '—'}
          </p>
          {hasCut ? (
            <p className="due-collect-rest">
              de {formatCurrency(liquidated)} liquidado
              {pending > 0 ? ` · falta cobrar ${formatCurrency(pending)}` : ' · el mes está cubierto'}
            </p>
          ) : (
            <p className="due-collect-rest">El corte del mes todavía no cargó.</p>
          )}
          {hasCut && liquidated > 0 ? (
            <div
              className="due-collect-track"
              role="meter"
              aria-valuenow={rate}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${rate}% recaudado de lo liquidado`}
            >
              <span style={{ width: `${Math.max(collected > 0 ? 4 : 0, rate)}%` }} />
            </div>
          ) : null}
        </div>
        {urgent ? <span className="due-collect-mark" aria-hidden="true">{moment.dueDay}</span> : null}
      </section>
      {afterCollect}
      <DueUnpaidMonthList rows={unpaidRows} monthLabel={monthLabel} members={members} />
    </div>
  );
}
