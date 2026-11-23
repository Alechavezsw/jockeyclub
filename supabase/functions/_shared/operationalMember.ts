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
    `and(status.eq.inactive,meta->>bajaFecha.gt.${today},meta->>bajaFecha.match.^[0-9]{4}-[0-9]{2}-[0-9]{2}$)`,
    `and(status.eq.active,or(meta->>bajaFecha.is.null,meta->>bajaFecha.not.match.^[0-9]{4}-[0-9]{2}-[0-9]{2}$,meta->>bajaFecha.gt.${today}))`,
  ].join(",");
}
