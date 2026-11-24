import { memberMayOperate, operationalAudienceFilter, clubToday } from "./operationalMember.ts";

export const CLUB_MAIL_PAGE = 500;
export const CLUB_MAIL_BATCH = 100;
export const CLUB_MAIL_MAX_BATCHES = 6;
export const CLUB_MAIL_PREVIEW_MS = 30 * 60 * 1000;
export const CLUB_MAIL_FROM = "Jockey Club San Juan <socios@jockeyclubsj.com.ar>";
export const CLUB_MAIL_RESERVED = "reservado";
export const CLUB_MAIL_UNCERTAIN_MARK = "incierto";

export function clubMailCap() {
  return CLUB_MAIL_BATCH * CLUB_MAIL_MAX_BATCHES;
}

const CLUB_MAIL_ADDRESS = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Mail real. Los alias de prueba, el dominio que rebota y las direcciones rotas no salen. */
export function deliverableClubEmail(value: string | null | undefined) {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower || lower.includes(" ") || lower.split("@").length !== 2) return "";
  if (lower.includes("@lila-jockey")) return "";
  if (lower.endsWith("@jockeyclubsj.com")) return "";
  if (!CLUB_MAIL_ADDRESS.test(lower)) return "";
  return lower;
}

export function maskClubEmail(value: string | null | undefined) {
  const email = deliverableClubEmail(value) || String(value || "").trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 1) return "";
  return `${email.slice(0, 1)}•••@${email.slice(at + 1)}`;
}

/** Un socio común no pasa has_staff_access. Sin ese permiso no hay envío. */
export function clubMailStaffAllowed(staff: unknown) {
  return staff === true;
}

export function clubMailAuthDecision({
  authorization = "",
  staff,
  staffError = false,
}: {
  authorization?: string;
  staff?: unknown;
  staffError?: boolean;
}) {
  if (!/^bearer\s+\S+/i.test(String(authorization || "").trim())) {
    return { status: 401, error: "Sesión vencida. Volvé a entrar." };
  }
  if (staffError || !clubMailStaffAllowed(staff)) {
    return { status: 403, error: "Solo el personal del club puede enviar comunicados." };
  }
  return { status: 200, error: "" };
}

export type ClubMailRow = {
  email?: string | null;
  member_number?: string | null;
  full_name?: string | null;
  status?: string | null;
  meta?: Record<string, unknown> | null;
  bajaFecha?: unknown;
};

export type ClubMailTarget = { email: string; memberNumber: string };

export type ClubMailReason = "recipient" | "shared" | "missing" | "alias" | "baja" | "not-operational";

/**
 * El cliente no elige la lista. Solo puede pedir todo el padrón o un número de socio.
 * Cualquier arreglo de correos que viaje en el cuerpo se ignora.
 */
/** Claves exactas para un número escrito con o sin ceros. No reescribe el padrón. */
export function clubMailNumberKeys(value: string) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return [];
  const bare = text.replace(/^0+/, "") || "0";
  const keys = new Set<string>();
  for (let size = bare.length; size <= 8; size += 1) keys.add(bare.padStart(size, "0"));
  return [...keys];
}

export function clubMailRequestScope(body: Record<string, unknown> | null | undefined) {
  const raw = String(body?.audience || "all").trim();
  const audience = raw === "one" || raw === "staff" || raw === "admin" ? raw : "all";
  return {
    audience,
    memberNumber: audience === "one"
      ? String(body?.memberNumber || body?.memberId || "").replace(/\D/g, "")
      : "",
  };
}

function calendarBaja(row: ClubMailRow | null) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const fecha = String(row?.bajaFecha || meta.bajaFecha || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "";
}

export function classifyClubMailRow(
  row: ClubMailRow | null,
  seen: Map<string, number>,
  today = clubToday(),
): { reason: ClubMailReason; email: string; memberNumber: string } {
  const memberNumber = String(row?.member_number || "");
  if (!row || !memberMayOperate(row, today)) {
    const baja = calendarBaja(row);
    if (baja && baja <= today) return { reason: "baja", email: "", memberNumber };
    return { reason: "not-operational", email: "", memberNumber };
  }
  const raw = String(row.email || "").trim();
  const email = deliverableClubEmail(raw);
  if (!raw || !raw.includes("@")) return { reason: "missing", email: "", memberNumber };
  if (!email) return { reason: "alias", email: "", memberNumber };
  const next = (seen.get(email) || 0) + 1;
  seen.set(email, next);
  if (next > 1) return { reason: "shared", email, memberNumber };
  return { reason: "recipient", email, memberNumber };
}

export type ClubMailSummary = {
  operational: number;
  withRealEmail: number;
  uniqueAddresses: number;
  missingEmail: number;
  aliasExcluded: number;
  sharedAddresses: number;
  excludedByBaja: number;
  recipients: number;
  audienceSha256: string;
  targets: ClubMailTarget[];
  sharedGroups: string[][];
};

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function bodyFingerprint(subject: string, text: string, images: string[] = []) {
  const base = `${String(subject || "").trim()}\n${String(text || "").trim()}`;
  const extra = images.map((item) => String(item || "").trim()).filter(Boolean);
  return sha256Hex(extra.length ? `${base}\n${extra.join("\n")}` : base);
}

export async function scanClubMailAudience(
  fetchPage: (from: number, to: number) => Promise<ClubMailRow[]>,
  { pageSize = CLUB_MAIL_PAGE, today = clubToday() }: { pageSize?: number; today?: string } = {},
): Promise<ClubMailSummary> {
  const seen = new Map<string, number>();
  const holders = new Map<string, string[]>();
  let operational = 0;
  let missingEmail = 0;
  let aliasExcluded = 0;
  let excludedByBaja = 0;
  let from = 0;
  for (;;) {
    const rows = await fetchPage(from, from + pageSize - 1);
    for (const row of rows) {
      const item = classifyClubMailRow(row, seen, today);
      if (item.reason === "baja") excludedByBaja += 1;
      if (item.reason === "not-operational") continue;
      if (item.reason !== "recipient" && item.reason !== "shared" && item.reason !== "missing" && item.reason !== "alias") {
        continue;
      }
      operational += 1;
      if (item.reason === "missing") missingEmail += 1;
      if (item.reason === "alias") aliasExcluded += 1;
      if (item.email) {
        const group = holders.get(item.email) || [];
        group.push(item.memberNumber);
        holders.set(item.email, group);
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  const targets: ClubMailTarget[] = [];
  const sharedGroups: string[][] = [];
  for (const [email, numbers] of holders) {
    targets.push({ email, memberNumber: numbers[0] || "" });
    if (numbers.length > 1) sharedGroups.push(numbers);
  }
  targets.sort((a, b) => a.email.localeCompare(b.email));
  const audienceSha256 = await sha256Hex(targets.map((item) => item.email).join("\n"));
  return {
    operational,
    withRealEmail: targets.length + sharedGroups.reduce((sum, group) => sum + group.length - 1, 0),
    uniqueAddresses: targets.length,
    missingEmail,
    aliasExcluded,
    sharedAddresses: sharedGroups.length,
    excludedByBaja,
    recipients: targets.length,
    audienceSha256,
    targets,
    sharedGroups,
  };
}

export function publicMailCounts(summary: ClubMailSummary) {
  return {
    operational: summary.operational,
    withRealEmail: summary.withRealEmail,
    uniqueAddresses: summary.uniqueAddresses,
    missingEmail: summary.missingEmail,
    aliasExcluded: summary.aliasExcluded,
    sharedAddresses: summary.sharedAddresses,
    excludedByBaja: summary.excludedByBaja,
    recipients: summary.recipients,
    sharedGroups: summary.sharedGroups.slice(0, 12).map((group) => group.filter(Boolean)),
  };
}

export type PreviewRow = {
  id?: string;
  audienceSha256?: string;
  audience_sha256?: string;
  bodySha256?: string;
  body_sha256?: string;
  consumedAt?: string | null;
  consumed_at?: string | null;
  expiresAt?: string | null;
  expires_at?: string | null;
  campaignId?: string | null;
  campaign_id?: string | null;
};

/**
 * Si el padrón o el texto cambiaron, no se envía.
 * Una campaña ya empezada puede seguir después del vencimiento, con el mismo texto y el mismo padrón.
 * Una revisión vencida que nadie confirmó no sale.
 */
export function decidePreviewClaim(
  preview: PreviewRow | null,
  request: { audienceSha256: string; bodySha256: string; campaignId: string },
  now = new Date(),
) {
  if (!preview) return { ok: false, status: 404, retry: false, error: "No está esa revisión. Volvé a contar los destinatarios." };
  const audience = String(preview.audienceSha256 || preview.audience_sha256 || "");
  const body = String(preview.bodySha256 || preview.body_sha256 || "");
  if (audience !== request.audienceSha256 || body !== request.bodySha256) {
    return { ok: false, status: 409, retry: false, error: "El padrón o el texto cambiaron. Hacé una revisión nueva." };
  }
  const consumed = preview.consumedAt || preview.consumed_at;
  const campaignId = String(preview.campaignId || preview.campaign_id || "");
  if (consumed) {
    if (campaignId && campaignId === request.campaignId) return { ok: true, status: 200, retry: true, error: "" };
    return { ok: false, status: 409, retry: false, error: "Esa revisión ya se usó para un envío." };
  }
  const expires = new Date(String(preview.expiresAt || preview.expires_at || 0));
  if (!(expires.getTime() > now.getTime())) {
    return { ok: false, status: 409, retry: false, error: "La revisión venció. Volvé a contar los destinatarios." };
  }
  return { ok: true, status: 200, retry: false, error: "" };
}

/** Resend acepta el lote. Eso no prueba que el correo haya llegado. */
export function interpretResendBatch(
  status: number,
  payload: { data?: Array<{ id?: string }>; message?: string } | null,
  prepared: number,
) {
  const ids = Array.isArray(payload?.data) ? payload.data.map((item) => String(item?.id || "")) : [];
  if (status < 200 || status >= 300) {
    return {
      accepted: 0,
      failed: prepared,
      ids,
      error: String(payload?.message || `Resend ${status}`),
    };
  }
  const accepted = ids.filter(Boolean).length;
  return { accepted, failed: Math.max(prepared - accepted, 0), ids, error: "" };
}

/**
 * Sin respuesta, o con una respuesta que no identifica cada correo, el lote queda en duda.
 * Un rechazo explícito de Resend no se reintenta solo: la fila queda y otro proceso no la vuelve a tomar.
 */
export function resendBatchDisposition(
  status: number | null,
  payload: { data?: Array<{ id?: string }>; message?: string } | null,
  prepared: number,
) {
  if (status == null) {
    return {
      disposition: "uncertain" as const,
      accepted: 0,
      failed: 0,
      ids: [] as string[],
      error: "Resend no respondió. El lote queda en duda y no se reenvía solo.",
    };
  }
  if (status === 409) {
    return {
      disposition: "uncertain" as const,
      accepted: 0,
      failed: 0,
      ids: [] as string[],
      error: "Resend ya registró ese lote con otra carga. No lo reenvío.",
    };
  }
  const batch = interpretResendBatch(status, payload, prepared);
  if (status < 200 || status >= 300) {
    return { disposition: "rejected" as const, ...batch };
  }
  if (batch.accepted !== prepared || batch.ids.length !== prepared || batch.ids.some((id) => !id)) {
    return {
      disposition: "uncertain" as const,
      accepted: batch.accepted,
      failed: batch.failed,
      ids: batch.ids,
      error: "Resend no devolvió un identificador por cada correo. No reenvío ese lote.",
    };
  }
  return { disposition: "accepted" as const, accepted: batch.accepted, failed: 0, ids: batch.ids, error: "" };
}

export function explainClubMailMember(row: ClubMailRow | null, siblingNumbers: string[] = [], today = clubToday()) {
  const seen = new Map<string, number>();
  const item = classifyClubMailRow(row, seen, today);
  return {
    memberNumber: item.memberNumber,
    name: String(row?.full_name || "").trim(),
    reason: item.reason,
    maskedEmail: item.email ? maskClubEmail(item.email) : "",
    alsoHeldBy: item.reason === "shared" || item.reason === "recipient"
      ? siblingNumbers.filter((number) => number && number !== item.memberNumber)
      : [],
  };
}

/**
 * Un destinatario operativo con mail real que todavía no está en el lote.
 * El mismo correo, aunque pertenezca a dos fichas, sale una sola vez.
 */
export function takeClubMailTarget(
  row: ClubMailRow | null,
  seen: Set<string>,
  today?: string,
): ClubMailTarget | null {
  const counts = new Map<string, number>();
  for (const email of seen) counts.set(email, 1);
  const item = classifyClubMailRow(row, counts, today);
  if (item.reason !== "recipient") return null;
  seen.add(item.email);
  return { email: item.email, memberNumber: item.memberNumber };
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

export { operationalAudienceFilter, clubToday };
