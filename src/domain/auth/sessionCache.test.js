import { describe, expect, it } from 'vitest';
import { clearMemberDeviceCache } from './sessionCache.js';

function memoryStorage(seed) {
  const data = { ...seed };
  return {
    get length() {
      return Object.keys(data).length;
    },
    key(index) {
      return Object.keys(data)[index] || null;
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

describe('caché del dispositivo al cambiar de usuario', () => {
  it('borra el grupo familiar y la ficha, y conserva el tema', () => {
    const storage = memoryStorage({
      'jockey-theme': 'dark',
      'jockey-household': '[{"memberId":"101452"}]',
      'jockey-family-group': '101452',
      'jockey-member-card': 'otra-persona',
      'jockey-portal-user': 'viejo',
      'jockey-own-member': '101453',
    });

    const removed = clearMemberDeviceCache(storage);

    expect(removed).toEqual([
      'jockey-household',
      'jockey-family-group',
      'jockey-member-card',
      'jockey-portal-user',
      'jockey-own-member',
    ]);
    expect(storage.snapshot()).toEqual({ 'jockey-theme': 'dark' });
  });

  it('no borra nada si el almacenamiento no es el del navegador', () => {
    expect(clearMemberDeviceCache(null)).toEqual([]);
  });
});
