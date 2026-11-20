/** Validación HMAC de webhooks Mercado Pago (Edge / Deno). */

export const MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS = 300;
export const MP_EXPECTED_CURRENCY = "ARS";
export const MP_AMOUNT_TOLERANCE = 0.05;

export function mpNormalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

/** Solo `approved` acredita cobros puntuales / débitos mensuales. */
export function mpIsPaymentCreditableStatus(status: unknown) {
  return mpNormalizeStatus(status) === "approved";
}

export function mpCurrencyOk(value: unknown, expected = MP_EXPECTED_CURRENCY) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return true;
  return raw === String(expected || MP_EXPECTED_CURRENCY).toUpperCase();
}

export function mpAmountMatchesIntent(
  paidAmount: unknown,
  intentAmount: unknown,
  tolerance = MP_AMOUNT_TOLERANCE,
) {
  const paid = Number(paidAmount);
  const expected = Number(intentAmount);
  if (!Number.isFinite(paid) || paid <= 0) return false;
  if (!Number.isFinite(expected) || expected <= 0) return false;
  const delta = Math.abs(paid - expected);
  if (delta <= tolerance) return true;
  if (paid < expected - tolerance) return false;
  if (paid > expected * 1.5 + tolerance) return false;
  return true;
}

export function parseMpSignatureHeader(header: string) {
  const raw = String(header || "").trim();
  const parts: Record<string, string> = {};
  if (!raw) return parts;
  for (const chunk of raw.split(",")) {
    const [key, ...rest] = chunk.split("=");
    if (!key) continue;
    parts[key.trim().toLowerCase()] = rest.join("=").trim();
  }
  return parts;
}

export function buildMpWebhookManifest(input: {
  dataId: string;
  requestId?: string;
  ts: string;
}) {
  const id = String(input.dataId || "").trim().toLowerCase();
  const req = String(input.requestId || "").trim();
  const stamp = String(input.ts || "").trim();
  const chunks: string[] = [];
  if (id) chunks.push(`id:${id}`);
  if (req) chunks.push(`request-id:${req}`);
  chunks.push(`ts:${stamp}`);
  return `${chunks.join(";")};`;
}

export function mpSignatureTimestampMs(ts: string) {
  const raw = String(ts || "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (raw.length >= 13) return n;
  return n * 1000;
}

export function isMpWebhookTimestampFresh(
  ts: string,
  opts: { nowMs?: number; toleranceSeconds?: number } = {},
) {
  const tsMs = mpSignatureTimestampMs(ts);
  if (tsMs == null) return false;
  const nowMs = opts.nowMs ?? Date.now();
  const tolMs = Math.max(0, Number(opts.toleranceSeconds) || 0) * 1000;
  return Math.abs(Number(nowMs) - tsMs) <= tolMs;
}

function hexOf(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(left: string, right: string) {
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function mpWebhookHmacHex(secret: string, manifest: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return hexOf(signed);
}

export async function verifyMpWebhookSignature(input: {
  xSignature: string;
  xRequestId?: string;
  dataId: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!String(input.secret || "").trim()) return { ok: false, reason: "missing_secret" };
  const parts = parseMpSignatureHeader(input.xSignature);
  const ts = parts.ts || "";
  const v1 = String(parts.v1 || "").toLowerCase();
  const id = String(input.dataId || "").trim();
  if (!String(input.xSignature || "").trim()) return { ok: false, reason: "missing_signature" };
  if (!ts || !v1) return { ok: false, reason: "malformed_signature" };
  if (!id) return { ok: false, reason: "missing_data_id" };
  const toleranceSeconds = input.toleranceSeconds ?? MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS;
  if (!isMpWebhookTimestampFresh(ts, { nowMs: input.nowMs, toleranceSeconds })) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }
  const manifest = buildMpWebhookManifest({
    dataId: id,
    requestId: input.xRequestId,
    ts,
  });
  const expected = await mpWebhookHmacHex(input.secret, manifest);
  if (!sameHex(expected, v1)) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}

export function extractMpSignedResourceId(req: Request, rawBody: string) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("data.id")
    || url.searchParams.get("id")
    || "";
  if (fromQuery.trim()) return fromQuery.trim();
  try {
    const parsed = JSON.parse(rawBody || "{}") as { data?: { id?: string | number }; id?: string | number };
    return String(parsed?.data?.id || parsed?.id || "").trim();
  } catch {
    return "";
  }
}

export function mpWebhookTsToleranceSeconds() {
  const raw = Number(Deno.env.get("MP_WEBHOOK_TS_TOLERANCE_SECONDS") || "");
  if (Number.isFinite(raw) && raw > 0) return raw;
  return MP_WEBHOOK_DEFAULT_TS_TOLERANCE_SECONDS;
}
