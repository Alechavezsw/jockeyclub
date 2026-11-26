// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CollectDuesModal from './CollectDuesModal';
import { setRuntimeTierCatalog } from '../../domain/members/tiers';

const store = vi.hoisted(() => ({ rows: [] }));

vi.mock('../../data/storage', () => ({
  uploadDuesReceipt: vi.fn(),
  signedDuesReceiptUrl: vi.fn(async () => null),
}));
vi.mock('../../data/parseDuesReceipt', () => ({ parseDuesReceipt: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: null }));
vi.mock('../../data/repos', () => ({
  getMember: vi.fn(async () => null),
  getMemberByNumber: vi.fn(async () => null),
  listFeeLedgerLinesByMemberNumber: vi.fn(async () => []),
  listDuesPeriodAdjustments: vi.fn(async () => store.rows),
  ajustarCuotaPeriodo: vi.fn(async ({ dueOn, action, capital, reason }) => {
    const row = {
      id: `adj-${store.rows.length + 1}`,
      dueOn,
      action,
      capital,
      reason,
      createdByName: 'Ana Admin',
      createdAt: new Date().toISOString(),
    };
    store.rows = [...store.rows, row];
    return row;
  }),
  anularAjusteCuotaPeriodo: vi.fn(async () => null),
}));

import * as repos from '../../data/repos';

const member = {
  id: 'db-1',
  memberId: '100001',
  memberNumber: '100001',
  name: 'Socio Prueba',
  tier: 'socio_familiar',
  status: 'active',
  outstandingBalance: 140000,
  nextDueDate: '2026-10-10',
  paymentHistory: [],
};

const money = (n) => `$ ${Number(n).toLocaleString('es-AR')}`;

beforeEach(() => {
  store.rows = [];
  vi.clearAllMocks();
  setRuntimeTierCatalog([
    { id: 'socio_familiar', name: 'SOCIO FAMILIAR', monthlyDues: 70000, sortOrder: 1 },
  ]);
});

afterEach(() => {
  cleanup();
  setRuntimeTierCatalog(null);
});

describe('Cobrar cuota · ajuste administrativo', () => {
  it('un usuario que no es administrador no ve el ajuste', async () => {
    render(
      <CollectDuesModal member={member} onClose={() => {}} onConfirm={async () => {}} formatCurrency={money} canAdjustDues={false} />,
    );
    await screen.findByText(/Meses del recibo/i);
    expect(screen.queryByRole('button', { name: /Corregir meses y montos/i })).toBeNull();
  });

  it('el administrador corrige el monto del mes, se guarda y el cobro usa el monto nuevo', async () => {
    const onConfirm = vi.fn(async () => {});
    render(
      <CollectDuesModal member={member} onClose={() => {}} onConfirm={onConfirm} formatCurrency={money} canAdjustDues />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Corregir meses y montos/i }));
    const panel = screen.getByRole('region', { name: /Ajuste administrativo de cuota/i });
    const input = within(panel).getAllByRole('spinbutton', { name: /^Capital de / })[0];
    fireEvent.change(input, { target: { value: '40000' } });
    fireEvent.change(within(panel).getByPlaceholderText(/nivelación de migración/i), {
      target: { value: 'Nivelación de migración LILA' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: /Guardar ajuste \(1\)/ }));

    await waitFor(() => expect(repos.ajustarCuotaPeriodo).toHaveBeenCalledTimes(1));
    expect(repos.ajustarCuotaPeriodo).toHaveBeenCalledWith(expect.objectContaining({
      memberDbId: 'db-1',
      action: 'set',
      capital: 40000,
      reason: 'Nivelación de migración LILA',
    }));
    expect(await within(panel).findByText(/Ajuste guardado \(1 mes\)/)).toBeTruthy();
    // Octubre corregido a $ 40.000 + 10 % = $ 44.000; noviembre queda como lo calcula la regla.
    expect(await screen.findByText(/Ajuste adm\. \(Ana Admin\)/)).toBeTruthy();
    expect(screen.getAllByText('$ 44.000').length).toBeGreaterThan(0);
    const totalText = document.body.textContent || '';
    expect(totalText).toMatch(/\$ 114\.000/);
    expect(totalText).not.toMatch(/\$ 147\.000|\$ 154\.000/);

    fireEvent.click(screen.getByRole('button', { name: /Acreditar efectivo/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.amount).toBe(114000);
    expect(payload.duesPeriodAdjustments).toEqual([expect.objectContaining({ capital: 40000 })]);
  });
});
