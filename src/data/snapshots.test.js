import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSnapshots,
  getSnapshotsGeneration,
  hasLocalSnapshot,
  loadSnapshot,
  readSnapshot,
  requireSnapshots,
  SNAPSHOT_NAMES,
  snapshotStatus,
} from './snapshots';

const EMPTY = Object.freeze({ ACCESSIN_CHEQUES: [], ACCESSIN_CHEQUES_AS_OF: '', EXTRA: 'vacío' });

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

  it('rechaza nombres que no están en el catálogo', async () => {
    await expect(loadSnapshot('noExiste')).rejects.toThrow(/desconocido/);
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

  it('requireSnapshots resuelve con los datos cargados', async () => {
    const [cheques] = await requireSnapshots(['accessinCheques']);
    expect(Array.isArray(cheques.ACCESSIN_CHEQUES)).toBe(true);
  });
});
