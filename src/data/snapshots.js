/**
 * Snapshots exportados de LILA/Accessin y Societas: padrón con DNI, cuentas corrientes,
 * caja, proveedores. No viajan en el build.
 *
 * - Producción: se bajan del bucket privado `club-snapshots` de Supabase Storage con la
 *   sesión del usuario, y las políticas de storage.objects deciden quién los lee
 *   (supabase/migrations/20260916090000_club_snapshots_storage.sql). Se suben con
 *   `npm run upload:snapshots`.
 * - Desarrollo y tests: si existe src/data/seed/<nombre>.js, se usa ese archivo. El
 *   import.meta.glob va detrás de import.meta.env.DEV para que el build no lo empaquete
 *   y para que no falle cuando la carpeta no está (los seeds no se commitean).
 *
 * Las funciones de dominio leen con readSnapshot(), que es síncrono y devuelve el valor
 * vacío mientras el snapshot no cargó. Las pantallas los leen con useSnapshotSeed() o se
 * montan detrás de <SnapshotGate>; las acciones (exportar, reportes) usan
 * requireSnapshots().
 */

import { SNAPSHOT_BUCKET, SNAPSHOT_LABELS, SNAPSHOT_NAMES } from './snapshotCatalog';

export { SNAPSHOT_BUCKET, SNAPSHOT_LABELS, SNAPSHOT_NAMES };

const KNOWN = new Set(SNAPSHOT_NAMES);

const LOCAL_SEEDS = import.meta.env.DEV ? import.meta.glob('./seed/*.js') : {};

const loaded = new Map();
const errors = new Map();
const inflight = new Map();
const merged = new Map();
const listeners = new Set();
let version = 0;
let generation = 0;
let authBound = false;

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function localLoader(name) {
  return LOCAL_SEEDS[`./seed/${name}.js`] || null;
}

export function hasLocalSnapshot(name) {
  return Boolean(localLoader(name));
}

export function subscribeSnapshots(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cambia con cada carga, error o limpieza. */
export function getSnapshotsVersion() {
  return version;
}

/** Cambia solo al limpiar (cambio de usuario), para que las pantallas vuelvan a pedir. */
export function getSnapshotsGeneration() {
  return generation;
}

/** 'idle' | 'loading' | 'ready' | 'error' */
export function snapshotStatus(name) {
  if (loaded.has(name)) return 'ready';
  if (inflight.has(name)) return 'loading';
  if (errors.has(name)) return 'error';
  return 'idle';
}

export function snapshotError(name) {
  return errors.get(name) || null;
}

/** Olvida todo lo cargado. Se llama solo al cambiar la sesión. */
export function clearSnapshots() {
  generation += 1;
  loaded.clear();
  errors.clear();
  inflight.clear();
  merged.clear();
  notify();
}

function bindAuth(supabase) {
  if (authBound) return;
  authBound = true;
  let userId;
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    // Lo bajado con la sesión anterior no puede quedar a la vista de la siguiente.
    if (userId !== undefined && next !== userId) clearSnapshots();
    userId = next;
  });
}

async function fetchRemote(name) {
  const { isSupabaseConfigured, supabase } = await import('../lib/supabase');
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Sin Supabase configurado y sin archivo local para este snapshot.');
  }
  bindAuth(supabase);
  const { data, error } = await supabase.storage.from(SNAPSHOT_BUCKET).download(`${name}.json`);
  if (error) throw error;
  return JSON.parse(await data.text());
}

/**
 * Carga un snapshot una sola vez. Si la descarga falla resuelve null y el snapshot queda
 * en 'error' (un nuevo pedido reintenta). Solo rechaza ante un nombre desconocido.
 */
export function loadSnapshot(name) {
  if (!KNOWN.has(name)) {
    return Promise.reject(new Error(`Snapshot desconocido: ${name}`));
  }
  if (loaded.has(name)) return Promise.resolve(loaded.get(name));
  if (inflight.has(name)) return inflight.get(name);

  const gen = generation;
  const local = localLoader(name);
  const promise = (local ? local().then((mod) => ({ ...mod })) : fetchRemote(name))
    .then((data) => {
      if (gen !== generation) return null;
      loaded.set(name, data);
      errors.delete(name);
      return data;
    })
    .catch((err) => {
      if (gen !== generation) return null;
      errors.set(name, err);
      if (import.meta.env.DEV) console.warn(`[snapshots] ${name}:`, err?.message || err);
      return null;
    })
    .finally(() => {
      if (gen !== generation) return;
      inflight.delete(name);
      notify();
    });

  inflight.set(name, promise);
  notify();
  return promise;
}

export function loadSnapshots(names = []) {
  return Promise.all(names.map(loadSnapshot));
}

/** Para acciones (exportar, generar un reporte): carga y lanza un error legible si falta alguno. */
export async function requireSnapshots(names = []) {
  const results = await loadSnapshots(names);
  const missing = names.filter((_, index) => !results[index]);
  if (missing.length) {
    const labels = missing.map((name) => SNAPSHOT_LABELS[name] || name).join(', ');
    throw new Error(`No se pudieron cargar datos exportados de LILA: ${labels}.`);
  }
  return results;
}

/**
 * Valor actual del snapshot, completado con `empty` para las claves que falten.
 * Mientras no cargó devuelve `empty` tal cual. La identidad del resultado es estable
 * entre llamadas, así que sirve como dependencia de useMemo.
 */
export function readSnapshot(name, empty) {
  const data = loaded.get(name);
  if (!data) return empty;
  const cached = merged.get(name);
  if (cached && cached.data === data && cached.empty === empty) return cached.value;
  const value = { ...empty, ...data };
  merged.set(name, { data, empty, value });
  return value;
}
