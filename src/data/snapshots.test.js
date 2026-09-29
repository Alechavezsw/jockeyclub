import { beforeEach, describe, expect, it } from 'vitest';
import {
  assembleSnapshotChunks,
  clearSnapshots,
  getSnapshotsGeneration,
  hasLocalSnapshot,
  loadSnapshot,
  readSnapshot,
  reloadSnapshot,
  requireSnapshots,
  SNAPSHOT_NAMES,
  snapshotStatus,
} from './snapshots';

const EMPTY = Object.freeze({ ACCESSIN_CHEQUES: [], ACCESSIN_CHEQUES_AS_OF: '', EXTRA: 'vacío' });

describe('assembleSnapshotChunks', () => {
  function encode(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  }

  it('arma el JSON cuando las partes empiezan en 0 y siguen en orden', () => {
    const payload = { ACCESSIN_MONTHLY_BALANCE_SNAPSHOT: { detailSheets: [{ total: 57387000 }] } };
    const b64 = encode(payload);
    const mid = Math.floor(b64.length / 2);
    expect(assembleSnapshotChunks([
      { seq: 1, chunk: b64.slice(mid) },
      { seq: 0, chunk: b64.slice(0, mid) },
    ])).toEqual(payload);
  });

  it('no arma un corte al que le falta la primera parte', () => {
    expect(assembleSnapshotChunks([{ seq: 8, chunk: encode({ ok: true }) }])).toBeNull();
  });
});

describe('registro de snapshots', () => {
  beforeEach(() => {
    clearSnapshots();
  });

  it('devuelve el valor vacío hasta que el snapshot carga', async () => {
    expect(snapshotStatus('accessinCheques')).toBe('idle');
    expect(readSnapshot('accessinCheques', EMPTY)).toBe(EMPTY);

    const pending = loadSnapshot('accessinCheques');
    expect(snapshotStatus('accessinCheques')).toBe('loading');
    await pending;

    expect(snapshotStatus('accessinCheques')).toBe('ready');
    const value = readSnapshot('accessinCheques', EMPTY);
    expect(value.ACCESSIN_CHEQUES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value.EXTRA).toBe('vacío');
    expect(readSnapshot('accessinCheques', EMPTY)).toBe(value);
  });

  it('pide cada snapshot una sola vez', () => {
    expect(loadSnapshot('accessinCheques')).toBe(loadSnapshot('accessinCheques'));
  });

  it('marca como error los nombres que no están en el catálogo', async () => {
    await expect(loadSnapshot('noExiste')).resolves.toBeNull();
    expect(snapshotStatus('noExiste')).toBe('error');
  });

  it('al limpiar olvida lo cargado y avisa con una nueva generación', async () => {
    await loadSnapshot('accessinCheques');
    const generation = getSnapshotsGeneration();
    clearSnapshots();
    expect(getSnapshotsGeneration()).toBe(generation + 1);
    expect(snapshotStatus('accessinCheques')).toBe('idle');
    expect(readSnapshot('accessinCheques', EMPTY)).toBe(EMPTY);
  });

  it('una carga que termina después de limpiar no repone datos viejos', async () => {
    const pending = loadSnapshot('accessinCheques');
    clearSnapshots();
    await pending;
    expect(snapshotStatus('accessinCheques')).toBe('idle');
    expect(readSnapshot('accessinCheques', EMPTY)).toBe(EMPTY);
  });

  it('en desarrollo usa los seeds locales del catálogo', () => {
    expect(SNAPSHOT_NAMES.every(hasLocalSnapshot)).toBe(true);
  });

  it('reloadSnapshot vuelve a pedir sin vaciar lo que ya se ve', async () => {
    await loadSnapshot('accessinCheques');
    const first = readSnapshot('accessinCheques', EMPTY);
    const pending = reloadSnapshot('accessinCheques');
    expect(snapshotStatus('accessinCheques')).toBe('ready');
    expect(readSnapshot('accessinCheques', EMPTY)).toBe(first);
    await pending;
    expect(snapshotStatus('accessinCheques')).toBe('ready');
  });

  it('requireSnapshots resuelve con los datos cargados', async () => {
    const [cheques] = await requireSnapshots(['accessinCheques']);
    expect(Array.isArray(cheques.ACCESSIN_CHEQUES)).toBe(true);
  });
});
