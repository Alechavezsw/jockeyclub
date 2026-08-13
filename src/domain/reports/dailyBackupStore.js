import { backupDayKey, buildBackupPayload } from './backupPayload';

const DB_NAME = 'jockey-club-backups';
const DB_VERSION = 1;
const STORE = 'daily';
const SETTINGS_KEY = 'jockey-daily-backup-enabled';
const RETENTION_DAYS = 30;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible en este navegador.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir el almacén de backups.'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada.'));
  });
}

export function isDailyBackupEnabled() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw == null) return true;
  return raw !== 'false';
}

export function setDailyBackupEnabled(enabled) {
  localStorage.setItem(SETTINGS_KEY, enabled ? 'true' : 'false');
  return enabled;
}

/** Guarda (o reemplaza) el backup del día. */
export async function saveDailyBackup(payload, { source = 'auto' } = {}) {
  const id = backupDayKey();
  const record = {
    id,
    createdAt: new Date().toISOString(),
    source,
    bytes: JSON.stringify(payload).length,
    payload,
  };
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
  await pruneOldBackups(RETENTION_DAYS);
  return record;
}

export async function listDailyBackups() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return rows
      .map(({ id, createdAt, source, bytes }) => ({ id, createdAt, source, bytes }))
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  } finally {
    db.close();
  }
}

export async function getDailyBackup(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return row;
  } finally {
    db.close();
  }
}

export async function deleteDailyBackup(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function pruneOldBackups(keepDays = RETENTION_DAYS) {
  const list = await listDailyBackups();
  if (list.length <= keepDays) return 0;
  const toDelete = list.slice(keepDays);
  await Promise.all(toDelete.map((row) => deleteDailyBackup(row.id)));
  return toDelete.length;
}

/**
 * Si los backups diarios están activos y aún no hay uno de hoy, lo crea.
 * @returns {{ created: boolean, record?: object, skipped?: string }}
 */
export async function ensureTodayDailyBackup(snapshot) {
  if (!isDailyBackupEnabled()) {
    return { created: false, skipped: 'disabled' };
  }
  const today = backupDayKey();
  const existing = await getDailyBackup(today);
  if (existing?.payload) {
    return { created: false, skipped: 'exists', record: existing };
  }
  const payload = buildBackupPayload(snapshot, { source: 'auto' });
  const record = await saveDailyBackup(payload, { source: 'auto' });
  return { created: true, record };
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
