// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CollectDuesModal from './CollectDuesModal';
import { setRuntimeTierCatalog } from '../../domain/members/tiers';

vi.mock('../../data/storage', () => ({
  uploadDuesReceipt: vi.fn(),
  signedDuesReceiptUrl: vi.fn(async () => null),
}));
vi.mock('../../data/parseDuesReceipt', () => ({
  parseDuesReceipt: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: false,
}));

afterEach(() => {
  cleanup();
  setRuntimeTierCatalog(null);
});

beforeEach(() => {
  setRuntimeTierCatalog([
    { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
  ]);
});

const overdueMember = {
  memberId: '100001',
  name: 'Socio Prueba',
  tier: 'socio_familiar',
  status: 'active',
  outstandingBalance: 77000,
  nextDueDate: '2026-10-10',
};

describe('CollectDuesModal asignación capital/mora en mixto', () => {
  it('muestra campos Capital/Mora del tramo cuando hay mora y medio mixto', async () => {
    render(
      <CollectDuesModal
        open
        member={overdueMember}
        onClose={() => {}}
        onConfirm={async () => {}}
        formatCurrency={(n) => `$ ${Number(n).toLocaleString('es-AR')}`}
        paymentPlans={[{
          id: 'visa-10',
          label: 'Visa 10%',
          active: true,
          installments: 3,
          financingMode: 'club_keeps',
          financingPercent: 10,
        }]}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Mixto/i }));

    expect(await screen.findAllByText(/Capital del tramo/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/Mora del tramo/i).length).toBeGreaterThan(0);
  });
});
