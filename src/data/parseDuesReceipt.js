import { isSupabaseConfigured, supabase } from '../lib/supabase';

/** Lee imagen/PDF como base64 (sin prefijo data:). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const comma = raw.indexOf(',');
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Gemini desglosa el comprobante. Si falla o no hay key, devolve null (no bloquea el cobro).
 */
export async function parseDuesReceipt(file, { expectedAmount = null, methodHint = null } = {}) {
  if (!file || !isSupabaseConfigured || !supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.access_token) return null;

  let base64;
  try {
    base64 = await fileToBase64(file);
  } catch {
    return null;
  }
  if (!base64) return null;

  try {
    const { data, error } = await supabase.functions.invoke('parse-dues-receipt', {
      body: {
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name || 'comprobante',
        base64,
        expectedAmount: expectedAmount != null ? Number(expectedAmount) : null,
        methodHint: methodHint || null,
      },
    });
    if (error || data?.error) return null;
    if (!data || typeof data !== 'object') return null;
    return {
      amount: data.amount != null && Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
      date: data.date ? String(data.date).slice(0, 10) : null,
      time: data.time ? String(data.time) : null,
      method: data.method ? String(data.method) : null,
      bankOrCard: data.bankOrCard ? String(data.bankOrCard) : null,
      reference: data.reference ? String(data.reference) : null,
      payerName: data.payerName ? String(data.payerName) : null,
      notes: data.notes ? String(data.notes) : null,
      confidence: data.confidence != null ? Number(data.confidence) : null,
      source: data.source || 'gemini',
    };
  } catch {
    return null;
  }
}
