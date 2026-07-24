import { describe, it, expect } from 'vitest';
import {
  canAccessAdmin,
  allowedAdminTabs,
  allowedAccountingSubtabs,
  navItemsForRole,
  ROLE_PANEL_META,
} from './roles';

describe('canAccessAdmin', () => {
  it('los roles operativos acceden al panel; el socio no', () => {
    expect(canAccessAdmin('member')).toBe(false);
    for (const role of ['staff', 'cashier', 'accountant', 'admin', 'superadmin']) {
      expect(canAccessAdmin(role)).toBe(true);
    }
  });
});

describe('allowedAdminTabs', () => {
  it('el personal no ve contabilidad ni mensajería', () => {
    const tabs = allowedAdminTabs('staff');
    expect(tabs).not.toContain('accounting');
    expect(tabs).not.toContain('messaging');
    expect(tabs).toContain('claims');
    expect(tabs).toContain('bookings');
  });

  it('el cajero ve socios y contabilidad pero no migración', () => {
    const tabs = allowedAdminTabs('cashier');
    expect(tabs).toContain('members');
    expect(tabs).toContain('accounting');
    expect(tabs).not.toContain('migration');
  });

  it('el contador ve reportes pero no gestiona socios', () => {
    const tabs = allowedAdminTabs('accountant');
    expect(tabs).toContain('reports');
    expect(tabs).not.toContain('members');
  });

  it('el admin ve las pestañas operativas sin dashboard ni control QR (página aparte)', () => {
    const tabs = allowedAdminTabs('admin');
    expect(tabs).not.toContain('dashboard');
    expect(tabs).not.toContain('qr_control');
    expect(tabs.length).toBeGreaterThanOrEqual(11);
  });

  it('un rol desconocido no ve ninguna', () => {
    expect(allowedAdminTabs('member')).toEqual([]);
  });
});

describe('allowedAccountingSubtabs', () => {
  it('el cajero opera diario, caja y gastos', () => {
    expect(allowedAccountingSubtabs('cashier')).toEqual(['diary', 'cash', 'expenses']);
  });
});

describe('navItemsForRole', () => {
  it('el socio ve inicio, reservas y revista', () => {
    expect(navItemsForRole('member').map((i) => i.id)).toEqual(['dashboard', 'reservations', 'news']);
  });

  it('los roles operativos ven solo su panel, sin revista de socios', () => {
    for (const role of ['staff', 'cashier', 'accountant', 'admin']) {
      expect(navItemsForRole(role)).toEqual([]);
    }
  });
});

describe('ROLE_PANEL_META', () => {
  it('cada rol operativo tiene título propio de panel', () => {
    for (const role of ['staff', 'cashier', 'accountant', 'admin']) {
      expect(ROLE_PANEL_META[role]?.title).toBeTruthy();
    }
    const titles = ['staff', 'cashier', 'accountant'].map((r) => ROLE_PANEL_META[r].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
