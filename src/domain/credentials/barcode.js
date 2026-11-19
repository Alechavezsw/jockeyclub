/**
 * Código de barras de credencial (Code 128) para lector físico HID / láser.
 *
 * El QR firmado sigue siendo la credencial “fuerte” (anti-falsificación).
 * El barcode es el carnet físico / pistola de portería: payload corto y estable.
 *
 * Formato canónico: JCSJ-{memberId}[-{check}]
 * Ejemplo: JCSJ-10508-42
 *
 * El dígito de control (mod 97 de los dígitos del Nº) detecta errores de lectura
 * o tipografía; si viene sin check (JCSJ-10508 o solo 10508) igual se acepta.
 */

import { parseCredentialQRPayload } from './qr';
import { parseGuestPassPayload } from './guestPass';

export const BARCODE_PREFIX = 'JCSJ';
export const BARCODE_FORMAT = 'CODE128';

/** Solo dígitos del padrón (4–20): cubre Nº cortos tipo 10508 y largos Accessin. */
export function normalizeMemberIdDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{4,20}$/.test(digits)) return '';
  return digits;
}

/**
 * Check de 2 dígitos (00–96) sobre el Nº de socio.
 * Sirve para atrapar pistolas que “comen” un dígito o carnets mal impresos.
 */
export function credentialBarcodeCheckDigits(memberId) {
  const digits = normalizeMemberIdDigits(memberId);
  if (!digits) return '';
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum = (sum * 10 + (digits.charCodeAt(i) - 48)) % 97;
  }
  return String(sum).padStart(2, '0');
}

/**
 * Payload para imprimir / dibujar en Code 128.
 * @param {{ memberId?: string } | string} memberOrId
 * @param {{ withCheck?: boolean }} [opts]
 */
export function buildCredentialBarcodePayload(memberOrId, { withCheck = true } = {}) {
  const id = normalizeMemberIdDigits(
    typeof memberOrId === 'object' ? memberOrId?.memberId : memberOrId,
  );
  if (!id) return '';
  if (!withCheck) return `${BARCODE_PREFIX}-${id}`;
  return `${BARCODE_PREFIX}-${id}-${credentialBarcodeCheckDigits(id)}`;
}

/**
 * Limpia basura típica de lectores HID (AIM, CR/LF, comillas, espacios).
 */
export function sanitizeBarcodeScan(raw) {
  let text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\r\n\t]+/g, '')
    .trim()
    .replace(/^["']|["']$/g, '');

  // Identificadores AIM: ]C1 (Code 128), ]A0 (Code 39), ]E0 (EAN), etc.
  text = text.replace(/^\][A-Za-z][0-9]/, '');
  // Algunos firmware meten FNC1 como GS (\x1D) al inicio.
  text = text.replace(/^\x1D+/, '');
  text = text.replace(/\s+/g, '');
  return text;
}

/**
 * ¿Parece un scan de barras de credencial (no QR firmado largo)?
 */
export function looksLikeCredentialBarcode(raw) {
  const text = sanitizeBarcodeScan(raw);
  if (!text) return false;
  if (/^JCSJ:[0-9].*\./i.test(text)) return false; // QR firmado
  if (/^JCSJ-GUEST:/i.test(text)) return false;
  if (/^JCSJ-\d{4,20}(?:-\d{2})?$/i.test(text)) return true;
  if (/^JCSJ\d{4,20}$/i.test(text)) return true;
  // Solo Nº: también lo emiten muchas pistolas si el carnet es “solo número”.
  if (/^\d{4,20}$/.test(text)) return true;
  return false;
}

/**
 * @returns {{
 *   memberId: string,
 *   check: string|null,
 *   checkOk: boolean|null,
 *   kind: 'barcode',
 *   signed: false,
 *   raw: string,
 * } | null}
 */
export function parseCredentialBarcodePayload(raw) {
  const text = sanitizeBarcodeScan(raw);
  if (!text) return null;

  let memberId = '';
  let check = null;

  const dashed = text.match(/^JCSJ-(\d{4,20})(?:-(\d{2}))?$/i);
  if (dashed) {
    memberId = dashed[1];
    check = dashed[2] || null;
  } else {
    const glued = text.match(/^JCSJ(\d{4,20})$/i);
    if (glued) {
      memberId = glued[1];
    } else if (/^\d{4,20}$/.test(text)) {
      memberId = text;
    } else {
      return null;
    }
  }

  if (!normalizeMemberIdDigits(memberId)) return null;

  let checkOk = null;
  if (check != null) {
    checkOk = check === credentialBarcodeCheckDigits(memberId);
    if (!checkOk) return null;
  }

  return {
    memberId,
    check,
    checkOk,
    kind: 'barcode',
    signed: false,
    raw: text,
  };
}

/**
 * Clasifica lo que llegó al molinete (cámara, pistola HID o tipeo).
 * @returns {'qr'|'barcode'|'guest'|'search'|null}
 */
export function accessScanKind(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (parseGuestPassPayload(text)) return 'guest';
  const cleaned = sanitizeBarcodeScan(text);
  if (parseCredentialQRPayload(cleaned)?.signed) return 'qr';
  if (/^JCSJ:/i.test(cleaned) && parseCredentialQRPayload(cleaned)) return 'qr';
  if (looksLikeCredentialBarcode(cleaned) && parseCredentialBarcodePayload(cleaned)) return 'barcode';
  if (parseCredentialQRPayload(cleaned)) return 'qr';
  return 'search';
}

/**
 * Resuelve un scan a un payload usable por Acceso QR.
 * - QR firmado / sin firmar → forma parseCredentialQRPayload
 * - Barras → memberId + kind barcode
 * - Texto libre → null (buscar padrón a mano)
 */
export function resolveAccessScanPayload(raw) {
  const kind = accessScanKind(raw);
  if (kind === 'guest') {
    return { kind: 'guest', raw: String(raw || '').trim() };
  }
  if (kind === 'qr') {
    const parsed = parseCredentialQRPayload(sanitizeBarcodeScan(raw));
    if (!parsed) return null;
    return { kind: 'qr', ...parsed, raw: sanitizeBarcodeScan(raw) };
  }
  if (kind === 'barcode') {
    const parsed = parseCredentialBarcodePayload(raw);
    if (!parsed) return null;
    return parsed;
  }
  return { kind: 'search', raw: String(raw || '').trim() };
}

/** Altura mínima recomendada (mm) para impresión / PVC legible con láser. */
export const BARCODE_PRINT_MIN_HEIGHT_MM = 12;
/** Quiet zone lateral recomendada en módulos (≥ 10× X-dimension). */
export const BARCODE_QUIET_ZONE_MODULES = 10;
