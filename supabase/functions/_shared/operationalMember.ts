/**
 * Misma regla que src/domain/members/operationalVisibility.js
 * y que public.member_is_operational.
 * La baja programada opera hasta el día anterior. El día de la fecha ya no.
 */

export function clubToday(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function bajaDate(member: { bajaFecha?: unknown; meta?: Record<string, unknown> | null }) {
  const meta = member?.meta && typeof member.meta === "object" ? member.meta : {};
  const fecha = String(member?.bajaFecha || meta.bajaFecha || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "";
}

function pendingBaja(member: { pendingBaja?: unknown; meta?: Record<string, unknown> | null }) {
  const meta = member?.meta && typeof member.meta === "object" ? member.meta : {};
  const flag = member?.pendingBaja ?? meta.pendingBaja;
  return flag === true || flag === "true" || flag === "t" || flag === "1";
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
  if (pendingBaja(member) && baja && baja <= today) return false;
  return status === "active";
}

/** Mismo filtro que operationalListFilter. */
export function operationalAudienceFilter(today = clubToday()) {
  return [
    `and(status.eq.inactive,meta->>bajaFecha.gt.${today})`,
    `and(status.eq.active,meta->>pendingBaja.not.in.(true,t,1))`,
    `and(status.eq.active,meta->>pendingBaja.is.null)`,
    `and(status.eq.active,meta->>bajaFecha.gt.${today})`,
    `and(status.eq.active,meta->>bajaFecha.is.null)`,
  ].join(",");
}
