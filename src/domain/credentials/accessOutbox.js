/**
 * Cola de lecturas de portería que no llegaron a la base (sin señal, corte, error).
 * Se guardan en el equipo y se reintentan solas: una lectura no se pierde porque se cortó
 * internet un rato. El alta en la base es idempotente por clientId, así que reintentar no duplica.
 */

export const ACCESS_OUTBOX_KEY = 'jcsj-access-outbox-v1';
const MAX_QUEUE = 500;
const MAX_TRIES = 40;

export function readAccessOutbox(storage) {
  try {
    const raw = storage?.getItem(ACCESS_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((row) => row?.log?.id) : [];
  } catch {
    return [];
  }
}

function writeAccessOutbox(storage, rows) {
  try {
    storage?.setItem(ACCESS_OUTBOX_KEY, JSON.stringify(rows.slice(-MAX_QUEUE)));
  } catch {
    /* sin espacio o sin storage: no se puede guardar, la lectura sigue en pantalla */
  }
}

/** Agrega una lectura a la cola. Si ya está, no la duplica. */
export function enqueueAccessLog(storage, log, memberDbId = null) {
  if (!log?.id) return 0;
  const rows = readAccessOutbox(storage);
  if (!rows.some((row) => String(row.log.id) === String(log.id))) {
    rows.push({ log, memberDbId, queuedAt: new Date().toISOString(), tries: 0 });
  }
  writeAccessOutbox(storage, rows);
  return rows.length;
}

/**
 * Reintenta la cola. `insert(log, memberDbId)` devuelve una promesa.
 * @returns {Promise<{ sent: number, pending: number }>}
 */
export async function drainAccessOutbox(storage, insert, { batch = 25 } = {}) {
  const rows = readAccessOutbox(storage);
  if (!rows.length) return { sent: 0, pending: 0 };
  const keep = [];
  let sent = 0;
  let offline = false;
  for (const row of rows) {
    if (offline || sent >= batch) {
      keep.push(row);
      continue;
    }
    try {
      await insert(row.log, row.memberDbId);
      sent += 1;
    } catch (error) {
      const tries = (row.tries || 0) + 1;
      // Sin red: se corta y se vuelve a intentar más tarde, sin gastar intentos de las demás.
      if (!globalThis.navigator || globalThis.navigator.onLine === false || /fetch|network|failed to fetch/i.test(String(error?.message || ''))) {
        offline = true;
        keep.push(row);
      } else if (tries < MAX_TRIES) {
        keep.push({ ...row, tries });
      }
    }
  }
  writeAccessOutbox(storage, keep);
  return { sent, pending: keep.length };
}
