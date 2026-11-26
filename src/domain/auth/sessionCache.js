const KEEP = new Set(['jockey-theme']);

/** Borra datos de ficha o grupo familiar guardados en el dispositivo. El tema queda. */
export function clearMemberDeviceCache(storage) {
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }
  const removed = [];
  for (const key of keys) {
    if (KEEP.has(key)) continue;
    if (/household|family|member-card|portal-user|own-member|grupo/i.test(key)) {
      storage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}
