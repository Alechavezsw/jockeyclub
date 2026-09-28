/**
 * Snapshots exportados de LILA/Accessin y Societas: padrón con DNI, cuentas corrientes,
 * caja, proveedores. No viajan en el build.
 *
 * - Producción: se leen de `public.club_snapshots` con la sesión del usuario. Si esa
 *   fila no está, se intenta el bucket privado `club-snapshots`. Se cargan con
 *   `npm run upload:snapshots` o escribiendo la fila.
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
const seenUpdatedAt = new Map();
const listeners = new Set();
let version = 0;
let generation = 0;
let authBound = false;
let liveBound = false;
let liveTimer = 0;

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

function forgetSnapshot(name) {
  loaded.delete(name);
  errors.delete(name);
  merged.delete(name);
  inflight.delete(name);
}

/** Olvida todo lo cargado. Se llama solo al cambiar la sesión. */
export function clearSnapshots() {
  generation += 1;
  loaded.clear();
  errors.clear();
  inflight.clear();
  merged.clear();
  seenUpdatedAt.clear();
  notify();
}

/** Vuelve a pedir el corte sin vaciar lo que ya se ve. */
export function reloadSnapshot(name) {
  inflight.delete(name);
  return loadSnapshot(name, { force: true });
}

export function reloadSnapshots(names = [...loaded.keys()]) {
  names.forEach((name) => inflight.delete(name));
  return Promise.all(names.map((name) => loadSnapshot(name, { force: true }).catch(() => null)));
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

function snapshotNameFromChange(payload) {
  return payload?.new?.name || payload?.old?.name || '';
}

async function refreshStaleSnapshots(supabase) {
  const names = [...loaded.keys()];
  if (!names.length) return;
  const { data, error } = await supabase
    .from('club_snapshots')
    .select('name, updated_at')
    .in('name', names);
  if (error || !data?.length) return;
  const stale = [];
  for (const row of data) {
    const prev = seenUpdatedAt.get(row.name);
    if (prev && prev !== row.updated_at) stale.push(row.name);
    if (row.updated_at) seenUpdatedAt.set(row.name, row.updated_at);
  }
  if (stale.length) await Promise.all(stale.map((name) => reloadSnapshot(name)));
}

function bindLive(supabase) {
  if (liveBound || typeof window === 'undefined') return;
  liveBound = true;
  supabase
    .channel('club-snapshots-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'club_snapshots' },
      (payload) => {
        const name = snapshotNameFromChange(payload);
        if (name && KNOWN.has(name)) {
          if (payload?.new?.updated_at) seenUpdatedAt.set(name, payload.new.updated_at);
          void reloadSnapshot(name);
          return;
        }
        void reloadSnapshots();
      },
    )
    .subscribe();

  const onVisible = () => {
    if (document.visibilityState === 'visible') void refreshStaleSnapshots(supabase);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  liveTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshStaleSnapshots(supabase);
  }, 20000);
}

/** Empieza a escuchar cortes nuevos en Supabase (realtime + foco + poll). */
export function startSnapshotLiveUpdates() {
  void import('../lib/supabase').then(({ isSupabaseConfigured, supabase }) => {
    if (!isSupabaseConfigured || !supabase) return;
    bindAuth(supabase);
    bindLive(supabase);
  });
}

const REMOTE_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(id); resolve(value); },
      (err) => { clearTimeout(id); reject(err); },
    );
  });
}

function isIndexPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && (payload.__storage || payload.__chunks));
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function fetchFromChunks(supabase, name) {
  const pageSize = 50;
  const parts = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await withTimeout(
      supabase
        .from('club_snapshot_load')
        .select('seq, chunk')
        .eq('name', name)
        .order('seq')
        .range(from, from + pageSize - 1),
      60000,
      `Tiempo agotado al armar ${name}`,
    );
    if (error) throw error;
    if (!data?.length) break;
    parts.push(...data);
    if (data.length < pageSize) break;
  }
  if (!parts.length) return null;
  const ordered = parts.toSorted((a, b) => a.seq - b.seq);
  if (ordered[0].seq !== 0) return null;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].seq !== i) return null;
  }
  return JSON.parse(decodeBase64Utf8(ordered.map((part) => part.chunk).join('')));
}

async function fetchRemote(name) {
  const { isSupabaseConfigured, supabase } = await import('../lib/supabase');
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Sin Supabase configurado y sin archivo local para este snapshot.');
  }
  bindAuth(supabase);
  bindLive(supabase);
  const { data: row, error: tableError } = await withTimeout(
    supabase
      .from('club_snapshots')
      .select('payload, updated_at')
      .eq('name', name)
      .maybeSingle(),
    REMOTE_TIMEOUT_MS,
    `Tiempo agotado al leer ${name}`,
  );
  if (row?.updated_at) seenUpdatedAt.set(name, row.updated_at);
  const payload = row?.payload;
  if (!tableError && payload && typeof payload === 'object' && !isIndexPayload(payload)) {
    return payload;
  }

  try {
    const { data, error } = await withTimeout(
      supabase.storage.from(SNAPSHOT_BUCKET).download(`${name}.json`),
      60000,
      `Tiempo agotado al bajar ${name}`,
    );
    if (!error && data) return JSON.parse(await data.text());
  } catch {
    // Storage vacío o timeout: se arma desde club_snapshot_load.
  }

  const assembled = await fetchFromChunks(supabase, name);
  if (assembled) return assembled;
  throw tableError || new Error(`Sin corte ${name} en tabla, storage ni partes.`);
}

/**
 * Carga un snapshot una sola vez. Si la descarga falla resuelve null y el snapshot queda
 * en 'error' (un nuevo pedido reintenta). Solo rechaza ante un nombre desconocido.
 */
export function loadSnapshot(name, { force = false } = {}) {
  if (!KNOWN.has(name)) {
    const err = new Error(`Snapshot desconocido: ${name}`);
    errors.set(name, err);
    notify();
    return Promise.resolve(null);
  }
  if (!force && loaded.has(name)) return Promise.resolve(loaded.get(name));
  if (inflight.has(name)) return inflight.get(name);

  const gen = generation;
  const local = localLoader(name);
  const promise = (local ? local().then((mod) => ({ ...mod })) : fetchRemote(name))
    .then((data) => {
      if (gen !== generation) return null;
      if (inflight.get(name) !== promise) return data;
      loaded.set(name, data);
      errors.delete(name);
      return data;
    })
    .catch((err) => {
      if (gen !== generation) return null;
      if (inflight.get(name) !== promise) return null;
      if (loaded.has(name)) {
        if (import.meta.env.DEV) console.warn(`[snapshots] ${name} (se mantiene el corte):`, err?.message || err);
        return loaded.get(name);
      }
      errors.set(name, err);
      if (import.meta.env.DEV) console.warn(`[snapshots] ${name}:`, err?.message || err);
      return null;
    })
    .finally(() => {
      if (gen !== generation) return;
      if (inflight.get(name) === promise) inflight.delete(name);
      notify();
    });

  inflight.set(name, promise);
  notify();
  return promise;
}

export function loadSnapshots(names = []) {
  return Promise.all(names.map((name) => loadSnapshot(name).catch(() => null)));
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
