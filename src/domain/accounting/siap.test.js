import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import { listSiapOccupants, siapSeed, siapSummary } from './siap';

let ACCESSIN_SIAP;
let ACCESSIN_SIAP_AS_OF;
let ACCESSIN_SIAP_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinSiap']);
  ({ ACCESSIN_SIAP, ACCESSIN_SIAP_AS_OF, ACCESSIN_SIAP_SNAPSHOT } = siapSeed());
});

describe('padrón SIAP LILA', () => {
  it('carga el corte del 26 de septiembre (sin ocupantes)', () => {
    expect(ACCESSIN_SIAP_AS_OF).toBe('2026-09-26');
    expect(ACCESSIN_SIAP_SNAPSHOT.fileName).toMatch(/SIAP/i);
    expect(ACCESSIN_SIAP).toEqual([]);
    expect(ACCESSIN_SIAP_SNAPSHOT.count).toBe(0);
  });

  it('filtra ocupantes por nombre o documento', () => {
    const rows = [
      { occupantName: 'Juan Pérez', documentNumber: '20111222', cuit: '20-20111222-3' },
      { occupantName: 'Ana López', documentNumber: '30999888', cuit: '' },
    ];
    expect(listSiapOccupants({ query: 'perez', items: rows })).toHaveLength(1);
    expect(listSiapOccupants({ query: '30999888', items: rows })).toHaveLength(1);
    expect(listSiapOccupants({ query: 'zzz', items: rows })).toHaveLength(0);
    expect(siapSummary({ count: 2, withCuit: 1 }, rows).withCuit).toBe(1);
  });
});
