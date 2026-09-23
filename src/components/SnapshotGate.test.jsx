// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { clearSnapshots } from '../data/snapshots';
import { chequesSeed } from '../domain/accounting/cashLedger';
import { useSnapshotSeed } from '../hooks/useSnapshots';
import SnapshotGate from './SnapshotGate';

// Un snapshot del catálogo sin archivo local ni Supabase (los tests corren sin backend):
// sirve para probar el camino de error sin depender de la red.
vi.mock('../data/snapshotCatalog', async (importOriginal) => {
  const original = await importOriginal();
  const SNAPSHOT_LABELS = { ...original.SNAPSHOT_LABELS, snapshotQueFalta: 'datos de prueba' };
  return { ...original, SNAPSHOT_LABELS, SNAPSHOT_NAMES: Object.keys(SNAPSHOT_LABELS) };
});

afterEach(() => {
  cleanup();
  clearSnapshots();
});

function ChequesAsOf() {
  const { ACCESSIN_CHEQUES_AS_OF } = useSnapshotSeed(['accessinCheques'], chequesSeed);
  return <p>Cartera al {ACCESSIN_CHEQUES_AS_OF || '(sin cargar)'}</p>;
}

describe('SnapshotGate', () => {
  it('muestra la carga y monta el contenido cuando el snapshot está listo', async () => {
    render(
      <SnapshotGate names={['accessinCheques']}>
        <p>Panel de cheques</p>
      </SnapshotGate>
    );
    expect(screen.getByRole('status').textContent).toMatch(/Cargando datos de LILA/);
    expect(screen.queryByText('Panel de cheques')).toBeNull();

    expect(await screen.findByText('Panel de cheques')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('si un snapshot no se puede bajar, avisa con su nombre legible y muestra la pantalla igual', async () => {
    render(
      <SnapshotGate names={['snapshotQueFalta']}>
        <p>Panel con datos de la base</p>
      </SnapshotGate>
    );
    expect(await screen.findByText('Panel con datos de la base')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/datos de prueba/);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });
});

describe('useSnapshotSeed', () => {
  it('arranca con el valor vacío y re-renderiza cuando el snapshot carga', async () => {
    render(<ChequesAsOf />);
    expect(screen.getByText('Cartera al (sin cargar)')).toBeTruthy();
    expect(await screen.findByText(/^Cartera al \d{4}-\d{2}-\d{2}$/)).toBeTruthy();
  });
});
