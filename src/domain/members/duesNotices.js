/** Avisos reales de cuota: 5 días antes, el 10 y el 15. Mensaje interno + mail. */

export const DUES_NOTICE_STAGES = ['upcoming', 'due', 'mora'];
export const DUES_NOTICE_ADVANCE_DAYS = 5;

export const MORA_CONSEQUENCES = [
  'A partir del día 11, socio familiar y socio individual pagan un recargo del 10 %.',
  'En mora no se ingresa al club hasta regularizar la cuota.',
  'Tampoco se puede pagar pileta hasta estar al día.',
];

export function duesNoticeCalendar(dueDay = 10, advanceDays = DUES_NOTICE_ADVANCE_DAYS) {
  const due = Number(dueDay);
  const advance = Number(advanceDays);
  const safeDue = Number.isInteger(due) && due >= 1 && due <= 28 ? due : 10;
  const safeAdvance = Number.isInteger(advance) && advance >= 1 && advance <= 10
    ? advance
    : DUES_NOTICE_ADVANCE_DAYS;
  return {
    dueDay: safeDue,
    advanceDays: safeAdvance,
    upcomingDay: safeDue - safeAdvance,
    moraDay: Math.min(28, safeDue + safeAdvance),
  };
}

export function cycleDueOnFromToday(todayIso, dueDay = 10) {
  const stamp = String(todayIso || '').slice(0, 10);
  const yearMonth = stamp.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return '';
  return `${yearMonth}-${String(dueDay).padStart(2, '0')}`;
}

/** Qué avisos corresponden según el día del mes (reloj de San Juan). */
export function duesNoticeStagesForDay(todayIso, dueDay = 10, advanceDays = DUES_NOTICE_ADVANCE_DAYS) {
  const day = Number(String(todayIso || '').slice(8, 10));
  if (!Number.isFinite(day) || day < 1) return [];
  const cal = duesNoticeCalendar(dueDay, advanceDays);
  const stages = [];
  if (day >= cal.upcomingDay && day < cal.dueDay) stages.push('upcoming');
  if (day >= cal.dueDay && day < cal.moraDay) stages.push('due');
  if (day >= cal.moraDay) stages.push('mora');
  return stages;
}

export function duesNoticeKind(stage) {
  if (stage === 'upcoming') return 'dues_upcoming';
  if (stage === 'mora') return 'dues_mora';
  return 'dues_due';
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function longDueDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function duesNoticeCopy({ name, dueOn, stage }) {
  const who = String(name || '').trim() || 'socio';
  const when = longDueDate(dueOn);
  const consequences = MORA_CONSEQUENCES.join(' ');
  if (stage === 'upcoming') {
    return {
      subject: `Tu cuota vence el ${when}`,
      lead: `Faltan 5 días: el ${when} vence la cuota social del Jockey Club San Juan.`,
      consequences,
    };
  }
  if (stage === 'mora') {
    return {
      subject: 'Tu cuota está en mora',
      lead: `El ${when} venció la cuota social y seguís sin regularizar. Ya estás en mora.`,
      consequences,
    };
  }
  return {
    subject: 'Hoy vence tu cuota',
    lead: `Hoy, ${when}, vence la cuota social del Jockey Club San Juan. Si abonás hoy no lleva recargo.`,
    consequences,
  };
}
