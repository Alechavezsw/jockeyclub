/**
 * Estadísticas en vivo del padrón: edades, rangos, horarios de ingreso y pagos.
 * Misma partición etaria del informe integral (corte 15/11/2026).
 */

import { todayISODateAR } from '../../lib/arDate';
import { clubDayOfAccessLog, normalizeAccessLog } from '../credentials/accessLog';
import { isLiveMember, isTitularMember } from './households';
import { getMemberPaymentHistory } from './paymentHistory';
import { getTierDisplayName } from './tiers';

export const MEMBER_AGE_BUCKETS = Object.freeze([
  { id: 'lt4', label: 'Menores de 4', min: 0, max: 3 },
  { id: '4_5', label: '4 a 5', min: 4, max: 5 },
  { id: '6_12', label: '6 a 12', min: 6, max: 12 },
  { id: '13_17', label: '13 a 17', min: 13, max: 17 },
  { id: '18_25', label: '18 a 25', min: 18, max: 25 },
  { id: '26_35', label: '26 a 35', min: 26, max: 35 },
  { id: '36_45', label: '36 a 45', min: 36, max: 45 },
  { id: '46_55', label: '46 a 55', min: 46, max: 55 },
  { id: '56_65', label: '56 a 65', min: 56, max: 65 },
  { id: '66_plus', label: '66 o más', min: 66, max: 200 },
]);

/** Rangos del informe pileta / censo (4+). */
export const MEMBER_AGE_CENSUS_BUCKETS = Object.freeze(
  MEMBER_AGE_BUCKETS.filter((b) => b.id !== 'lt4'),
);

const PAY_METHOD_LABELS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  debito: 'Débito Galicia',
  debito_automatico: 'Débito Galicia',
  galicia: 'Débito Galicia',
  caja: 'Caja',
  mixto: 'Mixto',
};

function parseBirth(iso) {
  const raw = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/** Edad en años cumplidos al día `on` (reloj AR). */
export function ageYearsOn(birthIso, on = new Date()) {
  const birth = parseBirth(birthIso);
  if (!birth) return null;
  const day = String(on instanceof Date ? todayISODateAR(on) : on).slice(0, 10);
  const [yy, mm, dd] = day.split('-').map(Number);
  if (!yy || !mm || !dd) return null;
  let age = yy - birth.y;
  if (mm < birth.m || (mm === birth.m && dd < birth.d)) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function ageBucketForYears(years) {
  if (years == null || !Number.isFinite(years)) return null;
  return MEMBER_AGE_BUCKETS.find((b) => years >= b.min && years <= b.max) || null;
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hourOfLog(log) {
  const t = String(log?.time || '').slice(0, 8);
  const h = Number(t.slice(0, 2));
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null;
}

/**
 * @param {object[]} members
 * @param {{ on?: Date|string }} [opts]
 */
export function buildMemberAgeStats(members = [], { on = new Date() } = {}) {
  const live = (members || []).filter(isLiveMember);
  const buckets = MEMBER_AGE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
  const ages = [];
  let sinEdad = 0;
  let titulares = 0;
  let familiares = 0;

  for (const m of live) {
    if (isTitularMember(m)) titulares += 1;
    else familiares += 1;
    const years = ageYearsOn(m.birthDate || m.birth_date, on);
    if (years == null) {
      sinEdad += 1;
      continue;
    }
    ages.push(years);
    const bucket = ageBucketForYears(years);
    if (bucket) byId[bucket.id].count += 1;
  }

  ages.sort((a, b) => a - b);
  const withAge = ages.length;
  const avg = withAge ? ages.reduce((s, n) => s + n, 0) / withAge : null;
  const censusBuckets = MEMBER_AGE_CENSUS_BUCKETS.map((b) => ({
    ...b,
    count: byId[b.id]?.count || 0,
  }));
  const v4 = censusBuckets.reduce((s, b) => s + b.count, 0);
  const m4 = byId.lt4?.count || 0;

  return {
    asOf: String(on instanceof Date ? todayISODateAR(on) : on).slice(0, 10),
    activos: live.length,
    titulares,
    familiares,
    withAge,
    sinEdad,
    under4: m4,
    census4plus: v4,
    averageAge: avg == null ? null : Math.round(avg * 10) / 10,
    medianAge: median(ages),
    buckets,
    censusBuckets,
  };
}

/**
 * Horarios de ingreso (molinete / QR) por hora, ventana de días.
 * @param {object[]} entryLogs
 * @param {{ days?: number, today?: string }} [opts]
 */
export function buildEntryHourStats(entryLogs = [], { days = 30, today = todayISODateAR() } = {}) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    count: 0,
  }));
  const byDay = new Map();
  let total = 0;
  let granted = 0;
  let denied = 0;

  const cutoff = (() => {
    const [y, m, d] = String(today).slice(0, 10).split('-').map(Number);
    const dt = new Date(y, m - 1, d - Math.max(0, Number(days) || 30) + 1, 12, 0, 0);
    return todayISODateAR(dt);
  })();

  for (const raw of entryLogs || []) {
    const log = normalizeAccessLog(raw);
    const day = clubDayOfAccessLog(log);
    if (!day || day < cutoff || day > today) continue;
    total += 1;
    if (log.status === 'denied' || /deneg/i.test(String(log.activity || ''))) denied += 1;
    else granted += 1;
    byDay.set(day, (byDay.get(day) || 0) + 1);
    const h = hourOfLog(log);
    if (h != null) hours[h].count += 1;
  }

  const peak = hours.reduce(
    (best, row) => (row.count > best.count ? row : best),
    { hour: null, label: '—', count: 0 },
  );
  const daySeries = [...byDay.entries()]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  return {
    days: Number(days) || 30,
    today,
    total,
    granted,
    denied,
    peakHour: peak.count > 0 ? peak : null,
    hours,
    daySeries,
  };
}

function methodKey(row) {
  const raw = String(row?.method || row?.methodLabel || 'otro').trim().toLowerCase();
  if (!raw) return 'otro';
  if (PAY_METHOD_LABELS[raw]) return raw;
  if (/mercado/.test(raw)) return 'mercadopago';
  if (/transf/.test(raw)) return 'transferencia';
  if (/efect|cash/.test(raw)) return 'efectivo';
  if (/tarj|visa|master/.test(raw)) return 'tarjeta';
  if (/debit|galicia/.test(raw)) return 'debito';
  return raw.slice(0, 24);
}

/**
 * Pagos: saldos vivos del padrón + historial de fichas o filas de `member_payments`.
 * @param {object[]} members
 * @param {{ months?: number, on?: Date|string, paymentRows?: object[] }} [opts]
 */
export function buildPaymentStats(members = [], { months = 6, on = new Date(), paymentRows } = {}) {
  const live = (members || []).filter(isLiveMember);
  const asOf = String(on instanceof Date ? todayISODateAR(on) : on).slice(0, 10);
  const [yy, mm] = asOf.split('-').map(Number);
  const monthKeys = [];
  for (let i = Math.max(0, Number(months) || 6) - 1; i >= 0; i -= 1) {
    const d = new Date(yy, mm - 1 - i, 1, 12, 0, 0);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const byMonth = Object.fromEntries(monthKeys.map((k) => [k, { key: k, count: 0, amount: 0 }]));
  const byMethod = new Map();
  let payments = 0;
  let amount = 0;
  let withDebt = 0;
  let debtAmount = 0;
  let alDia = 0;

  for (const m of live) {
    const bal = Math.max(0, Number(m.outstandingBalance) || 0);
    if (bal > 0) {
      withDebt += 1;
      debtAmount += bal;
    } else {
      alDia += 1;
    }
  }

  const ledger = Array.isArray(paymentRows) && paymentRows.length
    ? paymentRows
    : live.flatMap((m) => getMemberPaymentHistory(m, { allowDemo: false }) || []);

  for (const row of ledger) {
      const when = String(row.date || row.paidOn || row.paid_at || '').slice(0, 10);
      const mk = when.slice(0, 7);
      const pay = money(row.amount);
      if (pay <= 0) continue;
      payments += 1;
      amount += pay;
      if (byMonth[mk]) {
        byMonth[mk].count += 1;
        byMonth[mk].amount += pay;
      }
      const key = methodKey(row);
      const prev = byMethod.get(key) || { id: key, label: PAY_METHOD_LABELS[key] || key, count: 0, amount: 0 };
      prev.count += 1;
      prev.amount += pay;
      byMethod.set(key, prev);
  }

  const methods = [...byMethod.values()].toSorted((a, b) => b.amount - a.amount);
  const monthSeries = monthKeys.map((k) => ({
    key: k,
    label: monthLabelEs(k),
    count: byMonth[k].count,
    amount: money(byMonth[k].amount),
  }));

  return {
    asOf,
    months: Number(months) || 6,
    payments,
    amount: money(amount),
    withDebt,
    debtAmount: money(debtAmount),
    alDia,
    methods,
    monthSeries,
  };
}

function monthLabelEs(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return ym;
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Categorías del padrón vivo (titulares / familiares por display name). */
export function buildCategoryStats(members = []) {
  const live = (members || []).filter(isLiveMember);
  const map = new Map();
  for (const m of live) {
    const label = getTierDisplayName(m.tier) || 'Sin categoría';
    const prev = map.get(label) || { label, count: 0, withAge: 0, sinEdad: 0 };
    prev.count += 1;
    if (ageYearsOn(m.birthDate || m.birth_date) == null) prev.sinEdad += 1;
    else prev.withAge += 1;
    map.set(label, prev);
  }
  return [...map.values()].toSorted((a, b) => b.count - a.count);
}

/**
 * Paquete completo para el escritorio Estadísticas.
 */
export function buildMemberStatsBundle(members = [], entryLogs = [], opts = {}) {
  const on = opts.on || new Date();
  const ages = buildMemberAgeStats(members, { on });
  const entries = buildEntryHourStats(entryLogs, {
    days: opts.entryDays ?? 30,
    today: opts.today || todayISODateAR(on),
  });
  const payments = buildPaymentStats(members, {
    months: opts.paymentMonths ?? 6,
    on,
    paymentRows: opts.paymentRows,
  });
  const categories = buildCategoryStats(members);
  return {
    generatedAt: new Date().toISOString(),
    ages,
    entries,
    payments,
    categories,
  };
}

/** Texto corto para pegar en JEV. */
export function memberStatsJevPrompt(bundle) {
  const a = bundle?.ages || {};
  const e = bundle?.entries || {};
  const p = bundle?.payments || {};
  const topAges = (a.censusBuckets || [])
    .filter((b) => b.count > 0)
    .toSorted((x, y) => y.count - x.count)
    .slice(0, 3)
    .map((b) => `${b.label}: ${b.count}`)
    .join('; ');
  const peak = e.peakHour ? `${e.peakHour.label} (${e.peakHour.count})` : 'sin pico';
  return [
    'Analizá estas estadísticas del padrón del Jockey Club San Juan (datos en vivo):',
    `Activos ${a.activos || 0} · con edad ${a.withAge || 0} · sin edad ${a.sinEdad || 0} · edad media ${a.averageAge ?? '—'} · mediana ${a.medianAge ?? '—'}.`,
    `Rangos 4+: ${topAges || 'sin datos'}.`,
    `Ingresos ${e.days || 30} días: ${e.total || 0} lecturas · pico ${peak}.`,
    `Pagos recientes: ${p.payments || 0} cobros · $${Math.round(p.amount || 0).toLocaleString('es-AR')} · con deuda ${p.withDebt || 0}.`,
    'Dame hallazgos accionables para Secretaría y Comisión (edades, horarios de ingreso y cobranza).',
  ].join('\n');
}
