/** Predicciones de Jev: ritmo real del libro, sin inventar cortes que no están. */

import { duesDueDay } from '../members/dues';
import { mergePoolSettings } from '../pool/poolAccess';

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dayOf(value) {
  return String(value || '').slice(0, 10);
}

function monthKeyOf(iso) {
  return String(iso || '').slice(0, 7);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function monthLabelOf(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
}

function addDays(iso, delta) {
  const [year, month, day] = String(iso).split('-').map(Number);
  const next = new Date(year, month - 1, day + delta);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekdayLabel(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
}

export function dailyCashIncomes(movements = [], monthKey = '') {
  const byDay = new Map();
  const seen = new Set();
  for (const row of movements || []) {
    const date = dayOf(row.date);
    if (!monthKey || !date.startsWith(monthKey)) continue;
    const type = String(row.movementType || 'income');
    if (type === 'expense' || type === 'transfer_out') continue;
    const amount = money(row.amount);
    if (amount <= 0) continue;
    const key = String(row.accessinId ?? row.id ?? '');
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    byDay.set(date, money((byDay.get(date) || 0) + amount));
  }
  return byDay;
}

function countByDay(rows, today, days, pickDate) {
  const start = addDays(today, -(days - 1));
  const map = new Map();
  for (let i = 0; i < days; i += 1) {
    map.set(addDays(start, i), 0);
  }
  for (const row of rows || []) {
    const date = dayOf(pickDate(row));
    if (!map.has(date)) continue;
    if (/cancel/i.test(String(row.status || ''))) continue;
    map.set(date, (map.get(date) || 0) + 1);
  }
  return [...map.entries()].map(([date, value]) => ({ date, value }));
}

export function buildMonthHorizon({
  today,
  collected = 0,
  liquidated = 0,
  cashMovements = [],
} = {}) {
  const iso = dayOf(today);
  const monthKey = monthKeyOf(iso);
  const [year, month, todayDay] = iso.split('-').map(Number);
  const lastDay = daysInMonth(year, month);
  const daily = dailyCashIncomes(cashMovements, monthKey);
  const cashSum = [...daily.values()].reduce((sum, value) => sum + value, 0);
  const remainder = Math.max(0, money(collected) - cashSum);
  if (remainder > 0) {
    const lastKey = `${monthKey}-${String(todayDay).padStart(2, '0')}`;
    daily.set(lastKey, money((daily.get(lastKey) || 0) + remainder));
  }

  let running = 0;
  const actual = [];
  for (let day = 1; day <= todayDay; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`;
    running = money(running + (daily.get(key) || 0));
    actual.push({ day, date: key, value: running, kind: 'actual' });
  }

  const elapsed = Math.max(1, todayDay);
  const increments = actual.map((row, index) => (
    index === 0 ? row.value : money(row.value - actual[index - 1].value)
  ));
  const peak = Math.max(0, ...increments);
  const steady = increments.filter((value) => value !== peak);
  const used = steady.length ? steady : increments;
  const pace = money(used.reduce((sum, value) => sum + value, 0) / Math.max(1, used.length) || money(collected) / elapsed);
  const dueDay = duesDueDay();
  const leftDue = Math.max(0, dueDay - todayDay);
  const leftMonth = Math.max(0, lastDay - todayDay);
  const forecastDue = money(Math.min(money(liquidated) || Infinity, money(collected) + pace * leftDue));
  const forecastMonth = money(Math.min(money(liquidated) || Infinity, money(collected) + pace * leftMonth));
  const rest = Math.max(0, money(liquidated) - money(collected));

  const points = [...actual];
  let cursor = running;
  for (let day = todayDay + 1; day <= lastDay; day += 1) {
    cursor = money(Math.min(money(liquidated) || cursor + pace, cursor + pace));
    points.push({
      day,
      date: `${monthKey}-${String(day).padStart(2, '0')}`,
      value: cursor,
      kind: 'forecast',
    });
  }

  const atDue = points.find((row) => row.day === dueDay)?.value ?? forecastDue;
  const pctDue = liquidated > 0 ? Math.round((atDue / liquidated) * 100) : 0;
  const pctNow = liquidated > 0 ? Math.round((collected / liquidated) * 100) : 0;

  let verdict = `${pctNow}% cobrado. Al ${dueDay} irías al ${pctDue}%.`;
  if (liquidated <= 0) verdict = 'Todavía no hay liquidación para proyectar el mes.';
  else if (pctDue >= 90) verdict = `El ritmo cubre el ${dueDay}: ${pctDue}% proyectado.`;
  else if (pctDue >= 70) verdict = `Vas a llegar justo: ${pctDue}% al vencimiento.`;
  else verdict = `El ritmo no cierra el ${dueDay}: ${pctDue}% si seguís igual.`;

  return {
    monthKey,
    todayDay,
    lastDay,
    dueDay,
    collected: money(collected),
    liquidated: money(liquidated),
    rest,
    pace,
    forecastDue,
    forecastMonth,
    pctNow,
    pctDue,
    verdict,
    points,
  };
}

export function buildDoorWeek({
  today,
  entryLogs = [],
  reservations = [],
  poolAccesses = [],
} = {}) {
  const iso = dayOf(today);
  const door = countByDay(entryLogs, iso, 7, (row) => row.date || row.logged_on || row.loggedOn);
  const bookings = countByDay(reservations, iso, 7, (row) => row.date || row.reservation_date);
  const pool = countByDay(poolAccesses, iso, 7, (row) => row.date || row.access_date || row.accessDate);
  const days = door.map((row, index) => ({
    date: row.date,
    label: weekdayLabel(row.date),
    door: row.value,
    bookings: bookings[index]?.value || 0,
    pool: pool[index]?.value || 0,
  }));
  const avg = (key) => Math.round(days.reduce((sum, row) => sum + row[key], 0) / Math.max(1, days.length));
  const next = {
    door: avg('door'),
    bookings: avg('bookings'),
    pool: avg('pool'),
  };
  return { days, next };
}

export function buildPadronOutlook({
  activos = 0,
  bien = 0,
  fichas = 0,
  deudores = 0,
} = {}) {
  const live = Number(activos) || 0;
  const ok = Number(bien) || 0;
  const dirty = Number(fichas) || Math.max(0, live - ok);
  const debt = Number(deudores) || 0;
  const okPct = live > 0 ? Math.round((ok / live) * 100) : 0;
  return {
    activos: live,
    bien: ok,
    fichas: dirty,
    deudores: debt,
    alDia: Math.max(0, live - debt),
    okPct,
    slices: [
      { id: 'bien', label: 'En orden', value: ok, tone: 'ok' },
      { id: 'fichas', label: 'A corregir', value: dirty, tone: 'watch' },
    ],
  };
}

export function buildLiquidationBars(feePeriods = [], today, limit = 6) {
  const iso = dayOf(today);
  const [year, month] = iso.split('-').map(Number);
  const bars = [];
  for (let offset = limit - 1; offset >= 0; offset -= 1) {
    const date = new Date(year, month - 1 - offset, 1);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const period = (feePeriods || []).find((row) => (
      Number(row.year) === y
      && Number(row.month) === m
      && row.status !== 'cancelled'
    ));
    const amount = money(period?.amount || period?.total || 0);
    bars.push({
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: monthLabelOf(y, m),
      value: amount,
      current: y === year && m === month,
    });
  }
  return bars;
}

function daysBetween(from, to) {
  const a = new Date(`${dayOf(from)}T12:00:00`);
  const b = new Date(`${dayOf(to)}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function inRange(date, from, to) {
  const iso = dayOf(date);
  return iso >= dayOf(from) && iso <= dayOf(to);
}

function accessDate(row) {
  return dayOf(row?.date || row?.access_date || row?.accessDate);
}

function accessPay(row) {
  return money(row?.payment?.amount ?? row?.payment_amount ?? row?.amount);
}

/** Temporada de pileta del club: diciembre a marzo. */
export function poolSeasonWindow(today) {
  const [year, month] = dayOf(today).split('-').map(Number);
  if (month >= 4 && month <= 11) {
    return {
      open: `${year}-12-01`,
      close: `${year + 1}-03-31`,
      previousOpen: `${year - 1}-12-01`,
      previousClose: `${year}-03-31`,
      live: false,
    };
  }
  if (month === 12) {
    return {
      open: `${year}-12-01`,
      close: `${year + 1}-03-31`,
      previousOpen: `${year - 1}-12-01`,
      previousClose: `${year}-03-31`,
      live: true,
    };
  }
  return {
    open: `${year - 1}-12-01`,
    close: `${year}-03-31`,
    previousOpen: `${year - 2}-12-01`,
    previousClose: `${year - 1}-03-31`,
    live: true,
  };
}

function listSeasonAccesses(rows, from, to) {
  return (rows || []).filter((row) => (
    inRange(accessDate(row), from, to) && !/revok|cancel/i.test(String(row.status || ''))
  ));
}

function monthBuckets(open, close, rows) {
  const start = new Date(`${dayOf(open)}T12:00:00`);
  const end = new Date(`${dayOf(close)}T12:00:00`);
  const bars = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const hits = rows.filter((row) => accessDate(row).startsWith(key));
    bars.push({
      key,
      label: monthLabelOf(y, m),
      visits: hits.length,
      canon: money(hits.reduce((sum, row) => sum + accessPay(row), 0)),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return bars;
}

function weekPoints(open, close, today, rows, paceVisits) {
  const start = dayOf(open);
  const end = dayOf(close);
  const iso = dayOf(today);
  const points = [];
  let running = 0;
  let week = 1;
  for (let date = start; date <= end; date = addDays(date, 7), week += 1) {
    const until = addDays(date, 6) < end ? addDays(date, 6) : end;
    const seen = rows.filter((row) => inRange(accessDate(row), date, until)).length;
    const actual = date <= iso;
    if (actual) running += seen;
    else running = money(running + paceVisits * (daysBetween(date, until) + 1));
    points.push({
      week,
      date,
      value: running,
      kind: actual ? 'actual' : 'forecast',
    });
  }
  return points;
}

export function buildPoolSeason({
  today,
  poolAccesses = [],
  poolSettings = {},
} = {}) {
  const settings = mergePoolSettings(poolSettings);
  const window = poolSeasonWindow(today);
  const iso = dayOf(today);
  const seasonDays = daysBetween(window.open, window.close) + 1;
  const prevDays = daysBetween(window.previousOpen, window.previousClose) + 1;
  const daysUntilOpen = window.live ? 0 : Math.max(0, daysBetween(iso, window.open));
  const daysLeft = window.live ? Math.max(0, daysBetween(iso, window.close)) : seasonDays;
  const daysElapsed = window.live ? Math.max(1, daysBetween(window.open, iso) + 1) : 0;
  const current = listSeasonAccesses(poolAccesses, window.open, window.live ? iso : window.close);
  const previous = listSeasonAccesses(poolAccesses, window.previousOpen, window.previousClose);
  const visitsNow = current.length;
  const visitsPrev = previous.length;
  const canonNow = money(current.reduce((sum, row) => sum + accessPay(row), 0));
  const canonPrev = money(previous.reduce((sum, row) => sum + accessPay(row), 0));
  const visitPace = visitsPrev > 0
    ? visitsPrev / prevDays
    : (visitsNow > 0 && daysElapsed ? visitsNow / daysElapsed : 0);
  const canonPace = canonPrev > 0
    ? canonPrev / prevDays
    : (canonNow > 0 && daysElapsed ? canonNow / daysElapsed : 0);
  const fee = money(settings.memberDayFee);
  const forecastVisits = Math.round(visitsNow + visitPace * daysLeft);
  const forecastCanon = money(
    canonNow + (canonPace > 0 ? canonPace * daysLeft : visitPace * daysLeft * fee),
  );
  const source = visitsPrev > 0 ? 'pasada' : (visitsNow > 0 ? 'este verano' : 'tarifa');
  let verdict = `Faltan ${daysUntilOpen} días. Abre el 1 de diciembre y cierra el 31 de marzo.`;
  if (window.live && visitPace > 0) {
    verdict = `Llevás ${visitsNow} pases. Al cierre irías a ${forecastVisits} si se mantiene el ritmo.`;
  } else if (!window.live && visitsPrev > 0) {
    verdict = `La temporada pasada fueron ${visitsPrev} pases. Si se repite, esta ronda rinde ${formatPlain(forecastCanon)}.`;
  } else if (!window.live) {
    verdict = `Aún no hay pases en el libro. La temporada abre el 1 de diciembre · ${seasonDays} días.`;
  }

  const upcomingMonths = monthBuckets(window.open, window.close, current);
  const previousMonths = monthBuckets(window.previousOpen, window.previousClose, previous);

  return {
    ...window,
    live: window.live,
    seasonDays,
    daysUntilOpen,
    daysLeft,
    visitsNow,
    visitsPrev,
    canonNow,
    canonPrev,
    visitPace,
    forecastVisits,
    forecastCanon,
    memberFee: fee,
    guestFee: money(settings.guestDayFee),
    source,
    verdict,
    months: upcomingMonths.map((bar, index) => ({
      ...bar,
      prevVisits: previousMonths[index]?.visits || 0,
      prevCanon: previousMonths[index]?.canon || 0,
    })),
    points: weekPoints(
      window.open,
      window.close,
      window.live ? iso : addDays(window.open, -1),
      current,
      visitPace,
    ),
  };
}

function formatPlain(value) {
  return money(value).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

export function buildJevForecasts(input = {}) {
  const horizon = buildMonthHorizon(input);
  const door = buildDoorWeek(input);
  const padron = buildPadronOutlook(input);
  const liquidations = buildLiquidationBars(input.feePeriods, input.today);
  const pool = buildPoolSeason(input);
  return { horizon, door, padron, liquidations, pool };
}
