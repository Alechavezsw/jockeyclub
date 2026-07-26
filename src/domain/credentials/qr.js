/** Payload estándar del QR de credencial: lo lee el Control de Acceso QR. */
export function buildCredentialQRPayload(member) {
  return `JCSJ:${member?.memberId || ''}`;
}

/** Extrae memberId desde el payload leído por el molinete / cámara. */
export function parseCredentialQRPayload(raw) {
  if (!raw) return null;
  // Normaliza basura típica de lectores (espacios, saltos, BOM, comillas).
  const text = String(raw)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');

  if (/^JCSJ:/i.test(text)) {
    const id = text.slice(5).trim();
    return id || null;
  }

  // Algunos lectores entregan solo el número de credencial
  if (/^\d{10,20}$/.test(text)) return text;

  // Último recurso: buscar patrón JCSJ:… embebido
  const embedded = text.match(/JCSJ:(\d{10,20})/i);
  if (embedded) return embedded[1];

  return null;
}
