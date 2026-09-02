import { describe, it, expect } from 'vitest';
import {
  canAccessAdmin,
  canAccessConcessions,
  canTakeAttendance,
  canManageProfiles,
  isSuperAdmin,
  allowedAdminTabs,
  allowedAccountingSubtabs,
  navItemsForRole,
  primaryRoleFromList,
  hasRoleInList,
  ROLE_PANEL_META,
} from './roles';

describe('canAccessAdmin', () => {
  it('los roles operativos acceden al panel; el socio y el profesor no', () => {
    expect(canAccessAdmin('member')).toBe(false);
    expect(canAccessAdmin('teacher')).toBe(false);
    for (const role of ['staff', 'cashier', 'accountant', 'admin', 'superadmin', 'gate_operator', 'admin_employee', 'hr']) {
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
    expect(tabs).toContain('access');
  });

  it('el cajero ve socios y módulo de caja (accounting) pero no migración', () => {
    const tabs = allowedAdminTabs('cashier');
    expect(tabs).toContain('members');
    expect(tabs).toContain('accounting');
    expect(tabs).toContain('access');
    expect(tabs).not.toContain('migration');
  });

  it('el contador ve reportes pero no gestiona socios', () => {
    const tabs = allowedAdminTabs('accountant');
    expect(tabs).toContain('reports');
    expect(tabs).not.toContain('members');
  });

  it('el admin inicia en dashboard, no ve contabilidad, ni QR/concesiones como pestaña', () => {
    const tabs = allowedAdminTabs('admin');
    expect(tabs[0]).toBe('dashboard');
    expect(tabs).not.toContain('accounting');
    expect(tabs).not.toContain('qr_control');
    expect(tabs).not.toContain('concessions');
    expect(tabs).toContain('disciplines');
    expect(tabs).toContain('access');
    expect(tabs.length).toBeGreaterThanOrEqual(14);
  });

  it('operador de portería ve caja e ingresos', () => {
    const tabs = allowedAdminTabs('gate_operator');
    expect(tabs).toContain('accounting');
    expect(tabs).toContain('access');
    expect(tabs).not.toContain('migration');
  });

  it('empleado de administración no ve contabilidad ni sistema', () => {
    const tabs = allowedAdminTabs('admin_employee');
    expect(tabs).toContain('members');
    expect(tabs).not.toContain('accounting');
    expect(tabs).not.toContain('system');
  });

  it('recursos humanos ve personal', () => {
    const tabs = allowedAdminTabs('hr');
    expect(tabs).toEqual(['dashboard', 'staff', 'alerts']);
  });

  it('un rol desconocido no ve ninguna', () => {
    expect(allowedAdminTabs('member')).toEqual([]);
  });
  it('el superadministrador ve todas las pestañas del panel', () => {
    const tabs = allowedAdminTabs('superadmin');
    expect(tabs).toContain('system');
    expect(tabs).toContain('migration');
    expect(tabs).toContain('accounting');
    expect(tabs.length).toBeGreaterThan(allowedAdminTabs('admin').length);
  });
});

describe('canManageProfiles', () => {
  it('solo el superadministrador modifica perfiles', () => {
    expect(isSuperAdmin('superadmin')).toBe(true);
    expect(canManageProfiles('superadmin')).toBe(true);
    expect(canManageProfiles('admin')).toBe(false);
    expect(canManageProfiles('staff')).toBe(false);
    expect(canManageProfiles([{ roleKey: 'superadmin' }, { roleKey: 'member' }])).toBe(true);
    expect(canManageProfiles([{ roleKey: 'admin' }, { roleKey: 'presidente' }])).toBe(false);
  });
});

describe('multi-role helpers', () => {
  it('deriva el rol primario y detecta roles acumulados', () => {
    expect(primaryRoleFromList(['member', 'superadmin', 'presidente'])).toBe('superadmin');
    expect(hasRoleInList(['superadmin', 'presidente', 'member'], 'presidente')).toBe(true);
    expect(hasRoleInList(['superadmin'], 'member')).toBe(false);
  });
});

describe('canAccessConcessions', () => {
  it('admin y contador acceden a /concesiones; cajero y socio no', () => {
    expect(canAccessConcessions('admin')).toBe(true);
    expect(canAccessConcessions('superadmin')).toBe(true);
    expect(canAccessConcessions('accountant')).toBe(true);
    expect(canAccessConcessions('cashier')).toBe(false);
    expect(canAccessConcessions('staff')).toBe(false);
    expect(canAccessConcessions('member')).toBe(false);
  });
});

describe('allowedAccountingSubtabs', () => {
  it('el cajero y el operador de portería solo ven operación de caja', () => {
    expect(allowedAccountingSubtabs('cashier')).toEqual(['cash']);
    expect(allowedAccountingSubtabs('gate_operator')).toEqual(['cash']);
  });

  it('el administrador no ve subtabs de contabilidad', () => {
    expect(allowedAccountingSubtabs('admin')).toEqual([]);
  });
});

describe('navItemsForRole', () => {
  it('el socio ve inicio, reservas y revista', () => {
    expect(navItemsForRole('member').map((i) => i.id)).toEqual([
      'dashboard',
      'reservations',
      'payments',
      'news',
    ]);
  });

  it('el profesor ve solo asistencia', () => {
    expect(navItemsForRole('teacher').map((i) => i.id)).toEqual(['attendance']);
  });

  it('los roles operativos ven solo su panel, sin revista de socios', () => {
    for (const role of ['staff', 'cashier', 'accountant', 'admin']) {
      expect(navItemsForRole(role)).toEqual([]);
    }
  });
});

describe('canTakeAttendance', () => {
  it('profesor, personal y admin pueden tomar asistencia', () => {
    expect(canTakeAttendance('teacher')).toBe(true);
    expect(canTakeAttendance('staff')).toBe(true);
    expect(canTakeAttendance('admin')).toBe(true);
    expect(canTakeAttendance('member')).toBe(false);
    expect(canTakeAttendance('cashier')).toBe(false);
  });
});

describe('ROLE_PANEL_META', () => {
  it('cada rol operativo tiene título propio de panel', () => {
    for (const role of ['staff', 'cashier', 'accountant', 'admin', 'superadmin', 'teacher']) {
      expect(ROLE_PANEL_META[role]?.title).toBeTruthy();
    }
    const titles = ['staff', 'cashier', 'accountant', 'superadmin', 'teacher'].map((r) => ROLE_PANEL_META[r].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
