import { memberMayOperate, operationalAudienceFilter } from "./operationalMember.ts";

export const CLUB_MAIL_PAGE = 500;
export const CLUB_MAIL_BATCH = 100;
export const CLUB_MAIL_MAX_BATCHES = 6;

export function clubMailCap() {
  return CLUB_MAIL_BATCH * CLUB_MAIL_MAX_BATCHES;
}

/** Mail real. Los alias de prueba y el dominio que rebota no salen. */
export function deliverableClubEmail(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email.includes("@")) return "";
  const lower = email.toLowerCase();
  if (lower.includes("@lila-jockey")) return "";
  if (lower.endsWith("@jockeyclubsj.com")) return "";
  return lower;
}

/** Un socio común no pasa has_staff_access. Sin ese permiso no hay envío. */
export function clubMailStaffAllowed(staff: unknown) {
  return staff === true;
}

export type ClubMailRow = {
  email?: string | null;
  member_number?: string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
  bajaFecha?: unknown;
};

export type ClubMailTarget = { email: string; memberNumber: string };

/**
 * Un destinatario operativo con mail real que todavía no está en el lote.
 * El mismo correo, aunque pertenezca a dos fichas, sale una sola vez.
 */
export function takeClubMailTarget(
  row: ClubMailRow | null,
  seen: Set<string>,
  today?: string,
): ClubMailTarget | null {
  if (!row || !memberMayOperate(row, today)) return null;
  const email = deliverableClubEmail(row.email);
  if (!email || seen.has(email)) return null;
  seen.add(email);
  return { email, memberNumber: String(row.member_number || "") };
}

export function collectClubMailReady(
  rows: ClubMailRow[],
  { seen = new Set<string>(), cap = clubMailCap(), today }: {
    seen?: Set<string>;
    cap?: number;
    today?: string;
  } = {},
) {
  const ready: ClubMailTarget[] = [];
  let index = 0;
  for (; index < rows.length && ready.length < cap; index += 1) {
    const target = takeClubMailTarget(rows[index], seen, today);
    if (target) ready.push(target);
  }
  return { ready, more: index < rows.length, seen };
}

export { operationalAudienceFilter };
