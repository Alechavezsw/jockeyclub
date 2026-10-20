import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_OUTBOX_KEY,
  drainAccessOutbox,
  enqueueAccessLog,
  readAccessOutbox,
} from './accessOutbox';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

const log = (id) => ({ id, memberId: '1001', status: 'granted', date: '2026-10-20', time: '15:00:00' });

describe('accessOutbox', () => {
  it('guarda la lectura y no la duplica', () => {
    const storage = fakeStorage();
    expect(enqueueAccessLog(storage, log('log-1'), 'db-1')).toBe(1);
    expect(enqueueAccessLog(storage, log('log-1'), 'db-1')).toBe(1);
    expect(enqueueAccessLog(storage, log('log-2'))).toBe(2);
    expect(readAccessOutbox(storage).map((row) => row.log.id)).toEqual(['log-1', 'log-2']);
  });

  it('al volver internet manda todo y vacía la cola', async () => {
    const storage = fakeStorage();
    enqueueAccessLog(storage, log('log-1'), 'db-1');
    enqueueAccessLog(storage, log('log-2'), null);
    const insert = vi.fn().mockResolvedValue({});
    expect(await drainAccessOutbox(storage, insert)).toEqual({ sent: 2, pending: 0 });
    expect(insert).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'log-1' }), 'db-1');
    expect(readAccessOutbox(storage)).toEqual([]);
  });

  it('sin red corta en la primera y deja el resto para después', async () => {
    const storage = fakeStorage();
    ['log-1', 'log-2', 'log-3'].forEach((id) => enqueueAccessLog(storage, log(id)));
    const insert = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    expect(await drainAccessOutbox(storage, insert)).toEqual({ sent: 0, pending: 3 });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(readAccessOutbox(storage)).toHaveLength(3);
  });

  it('una lectura rota no traba a las demás', async () => {
    const storage = fakeStorage();
    ['log-1', 'log-2'].forEach((id) => enqueueAccessLog(storage, log(id)));
    const insert = vi.fn()
      .mockRejectedValueOnce(new Error('violates check constraint'))
      .mockResolvedValueOnce({});
    expect(await drainAccessOutbox(storage, insert)).toEqual({ sent: 1, pending: 1 });
    const [left] = readAccessOutbox(storage);
    expect(left.log.id).toBe('log-1');
    expect(left.tries).toBe(1);
  });

  it('un storage roto no tira la pantalla', async () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readAccessOutbox(broken)).toEqual([]);
    expect(enqueueAccessLog(broken, log('log-1'))).toBe(1);
    expect(await drainAccessOutbox(broken, vi.fn())).toEqual({ sent: 0, pending: 0 });
    expect(ACCESS_OUTBOX_KEY).toMatch(/access-outbox/);
  });
});
