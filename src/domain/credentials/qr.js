/** Payload estándar del QR de credencial: lo lee el Control de Acceso QR. */
export function buildCredentialQRPayload(member) {
  return `JCSJ:${member?.memberId || ''}`;
}

/** Extrae memberId desde el payload leído por el molinete / cámara. */
export function parseCredentialQRPayload(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (text.startsWith('JCSJ:')) {
    const id = text.slice(5).trim();
    return id || null;
  }
  // Fallback: solo dígitos de credencial
  if (/^\d{10,20}$/.test(text)) return text;
  return null;
}
