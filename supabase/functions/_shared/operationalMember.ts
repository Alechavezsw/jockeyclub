/**
 * Misma regla que src/domain/members/operationalVisibility.js
 * y que public.member_is_operational.
 * La baja programada opera hasta el día anterior. El día de la fecha ya no.
 * Una fecha que no existe en el calendario no cuenta como baja.
 */

export const CALENDAR_DATE_PATTERN = "^([0-9]{4}-((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))|((([0-9]{2})(0[48]|[2468][048]|[13579][26])|0000|(0[48]|[2468][048]|[13579][26])00)-02-29))$";

export function clubToday(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

export function isCalendarDate(value: unknown) {
  const fecha = String(value || "").trim().slice(0, 10);
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(fecha);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function rawBajaFecha(member: { bajaFecha?: unknown; meta?: Record<string, unknown> | null; baja_fecha?: unknown }) {
  const meta = member?.meta && typeof member.meta === "object" ? member.meta : {};
  return String(member?.bajaFecha || meta.bajaFecha || member?.baja_fecha || "").trim().slice(0, 10);
}

function bajaDate(member: { bajaFecha?: unknown; meta?: Record<string, unknown> | null; baja_fecha?: unknown }) {
  const fecha = rawBajaFecha(member);
  return isCalendarDate(fecha) ? fecha : "";
}

/** Texto de baja ilegible. El socio activo sigue operando. */
export function bajaFechaNeedsReview(member: { bajaFecha?: unknown; meta?: Record<string, unknown> | null; baja_fecha?: unknown } | null) {
  if (!member) return false;
  const raw = rawBajaFecha(member);
  return Boolean(raw) && !isCalendarDate(raw);
}

export function memberMayOperate(
  member: { status?: string | null; meta?: Record<string, unknown> | null; bajaFecha?: unknown; pendingBaja?: unknown } | null,
  today = clubToday(),
) {
  if (!member) return false;
  const status = String(member.status || "").toLowerCase();
  if (status === "suspended" || status === "pending" || status === "baja") return false;
  const baja = bajaDate(member);
  if (status === "inactive") return Boolean(baja) && baja > today;
  if (status !== "active") return false;
  return !baja || baja > today;
}

/**
 * Mismo filtro que operationalListFilter.
 * El activo queda adentro de un AND: null, fecha inválida o fecha futura.
 * Una baja de hoy o anterior no entra por una rama suelta de status=active.
 */
export function operationalAudienceFilter(today = clubToday()) {
  return [
    `and(status.eq.inactive,meta->>bajaFecha.gt.${today},meta->>bajaFecha.match.${CALENDAR_DATE_PATTERN})`,
    `and(status.eq.active,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.${CALENDAR_DATE_PATTERN},meta->>bajaFecha.gt.${today}))`,
  ].join(",");
}
