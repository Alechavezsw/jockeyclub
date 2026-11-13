import { describe, it, expect } from 'vitest';
import {
  canAccessAdmin,
  canAccessConcessions,
  canAccessPool,
  canAccessQrGate,
  canPostJournal,
  canTakeAttendance,
  canLiquidateDues,
  canRemoveDuesSurcharge,
  canReopenFeePeriod,
  canWaiveDuesSurcharge,
  canAdjustMemberBalance,
  canReadMemberCards,
  canBackdateDuesPayment,
  canGenerateInterestRuns,
  canExemptMemberDues,
  canVoidDuesPayment,
  canManageProfiles,
  canManageTeachers,
  canManageMembers,
  canDeliverMemberAccess,
  canCollectDues,
  canWriteMemberLedger,
  canEditFeePackAmounts,
  isSuperAdmin,
  allowedAdminTabs,
  allowedAccountingSubtabs,
  navItemsForRole,
  primaryRoleFromList,
  hasRoleInList,
  hasSystemAdminRole,
  ROLE_PANEL_META,
} from './roles';

describe('canAccessAdmin', () => {
  it('los roles operativos acceden al panel; el socio y el profesor no', () => {
    expect(canAccessAdmin('member')).toBe(false);
    expect(canAccessAdmin('teacher')).toBe(false);
    for (const role of ['staff', 'cashier', 'accountant', 'admin', 'superadmin', 'gate_operator', 'pool_operator', 'admin_employee', 'hr']) {
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

  it('el cajero ve socios y módulo de caja pero no migración', () => {
    const tabs = allowedAdminTabs('cashier');
    expect(tabs).toContain('members');
    expect(tabs).toContain('subscriptions');
    expect(tabs).toContain('caja');
    expect(tabs).not.toContain('operation');
    expect(tabs).not.toContain('accounting');
    expect(tabs).toContain('access');
    expect(tabs).not.toContain('migration');
  });

  it('el contador ve reportes y cuotas, pero no gestiona socios', () => {
    const tabs = allowedAdminTabs('accountant');
    expect(tabs).toContain('reports');
    expect(tabs).toContain('dues');
    expect(tabs).toContain('subscriptions');
    expect(tabs).toContain('books');
    expect(tabs).toContain('informes');
    expect(tabs).toContain('caja');
    expect(tabs).toContain('operation');
    expect(tabs).not.toContain('members');
  });

  it('la liquidación de cuotas es de contador, superadministrador y administración', () => {
    expect(canLiquidateDues('superadmin')).toBe(true);
    expect(canLiquidateDues('accountant')).toBe(true);
    expect(canLiquidateDues('admin')).toBe(true);
    expect(canLiquidateDues('admin_employee')).toBe(true);
    expect(canLiquidateDues('cashier')).toBe(false);
    expect(canLiquidateDues('gate_operator')).toBe(false);
    expect(canLiquidateDues('pool_operator')).toBe(false);
    expect(canGenerateInterestRuns('superadmin')).toBe(true);
    expect(canGenerateInterestRuns('accountant')).toBe(true);
    expect(canGenerateInterestRuns('admin')).toBe(false);
    expect(canGenerateInterestRuns('cashier')).toBe(false);
    expect(canGenerateInterestRuns('gate_operator')).toBe(false);
  });

  it('el recargo se cobra siempre y solo un superadmin puede quitarlo', () => {
    expect(canWaiveDuesSurcharge({ roles: [{ roleKey: 'tesorero' }] })).toBe(false);
    expect(canWaiveDuesSurcharge('accountant')).toBe(false);
    expect(canWaiveDuesSurcharge('superadmin')).toBe(false);
    expect(canWaiveDuesSurcharge('admin')).toBe(false);
    expect(canRemoveDuesSurcharge('admin')).toBe(false);
    expect(canRemoveDuesSurcharge('superadmin')).toBe(true);
    expect(canReopenFeePeriod('admin')).toBe(false);
    expect(canReopenFeePeriod('accountant')).toBe(false);
    expect(canReopenFeePeriod('superadmin')).toBe(true);
    expect(canRemoveDuesSurcharge('cashier')).toBe(false);
    expect(canRemoveDuesSurcharge('accountant')).toBe(false);
    expect(canRemoveDuesSurcharge({ roles: [{ roleKey: 'tesorero' }] })).toBe(false);
    expect(canAdjustMemberBalance('cashier')).toBe(false);
    expect(canAdjustMemberBalance('gate_operator')).toBe(false);
    expect(canAdjustMemberBalance('admin')).toBe(false);
    expect(canAdjustMemberBalance('accountant')).toBe(true);
    expect(canAdjustMemberBalance('superadmin')).toBe(true);
    expect(canReadMemberCards('accountant')).toBe(true);
    expect(canReadMemberCards('superadmin')).toBe(true);
    expect(canReadMemberCards('admin')).toBe(false);
    expect(canReadMemberCards('cashier')).toBe(false);
    expect(canReadMemberCards('gate_operator')).toBe(false);
    expect(canReadMemberCards('staff')).toBe(false);
    expect(canBackdateDuesPayment('cashier')).toBe(false);
    expect(canBackdateDuesPayment('admin')).toBe(false);
    expect(canBackdateDuesPayment('accountant')).toBe(true);
    expect(canBackdateDuesPayment('superadmin')).toBe(true);
    expect(canExemptMemberDues('cashier')).toBe(false);
    expect(canExemptMemberDues('gate_operator')).toBe(false);
    expect(canExemptMemberDues('admin')).toBe(false);
    expect(canExemptMemberDues('accountant')).toBe(false);
    expect(canExemptMemberDues('superadmin')).toBe(true);
    expect(canVoidDuesPayment('cashier')).toBe(true);
    expect(canVoidDuesPayment('admin')).toBe(false);
    expect(canVoidDuesPayment('admin_employee')).toBe(false);
    expect(canVoidDuesPayment({ roles: [{ roleKey: 'tesorero' }] })).toBe(true);
    expect(canVoidDuesPayment('superadmin')).toBe(true);
  });

  it('saldos lo ven caja y administración', () => {
    expect(allowedAdminTabs('cashier')).toContain('dues');
    expect(allowedAdminTabs('admin')).toContain('dues');
    expect(allowedAdminTabs('admin_employee')).toContain('dues');
    expect(allowedAdminTabs('gate_operator')).not.toContain('dues');
  });

  it('caja cobra cuota sin editar el padrón', () => {
    expect(canCollectDues('cashier')).toBe(true);
    expect(canCollectDues('accountant')).toBe(true);
    expect(canCollectDues('gate_operator')).toBe(true);
    expect(canCollectDues('pool_operator')).toBe(true);
    expect(canCollectDues('admin')).toBe(true);
    expect(canCollectDues('member')).toBe(false);
    expect(canCollectDues('teacher')).toBe(false);
    expect(canManageMembers('cashier')).toBe(false);
    expect(canWriteMemberLedger('cashier')).toBe(true);
    expect(canWriteMemberLedger('pool_operator')).toBe(true);
    expect(canWriteMemberLedger('member')).toBe(false);
  });

  it('el admin inicia en dashboard y ve caja, contabilidad y débitos', () => {
    const tabs = allowedAdminTabs('admin');
    expect(tabs[0]).toBe('dashboard');
    expect(tabs).toContain('operation');
    expect(tabs).toContain('accounting');
    expect(tabs).toContain('books');
    expect(tabs).toContain('informes');
    expect(tabs).toContain('caja');
    expect(allowedAccountingSubtabs('admin')).toContain('cash');
    expect(allowedAccountingSubtabs('admin')).toContain('diary');
    expect(allowedAccountingSubtabs('admin')).toContain('prisma');
    expect(tabs).not.toContain('qr_control');
    expect(tabs).toContain('concessions');
    expect(tabs).toContain('disciplines');
    expect(tabs).toContain('access');
    expect(tabs.length).toBeGreaterThanOrEqual(14);
  });

  it('operador de portería ve caja e ingresos', () => {
    const tabs = allowedAdminTabs('gate_operator');
    expect(tabs).toContain('caja');
    expect(tabs).not.toContain('operation');
    expect(tabs).toContain('access');
    expect(tabs).toContain('gate_income');
    expect(tabs).not.toContain('migration');
  });

  it('el operario de pileta ve el mostrador, sin los débitos de administración', () => {
    expect(allowedAdminTabs('admin_employee').filter((tab) => tab !== 'operation'))
      .toEqual(allowedAdminTabs('pool_operator'));
    expect(allowedAdminTabs('admin_employee')).toContain('operation');
    expect(allowedAdminTabs('pool_operator')).not.toContain('operation');
  });

  it('el operario de pileta cobra en la puerta y no entra a libros contables', () => {
    const tabs = allowedAdminTabs('pool_operator');
    expect(tabs).toContain('pool');
    expect(tabs).toContain('members');
    expect(tabs).toContain('dues');
    expect(tabs).not.toContain('accounting');
    expect(tabs).not.toContain('operation');
    expect(tabs).not.toContain('system');
    expect(tabs).not.toContain('migration');
    expect(canAccessAdmin('pool_operator')).toBe(true);
    expect(canAccessPool('pool_operator')).toBe(true);
    expect(canAccessQrGate('pool_operator')).toBe(false);
    expect(canLiquidateDues('pool_operator')).toBe(false);
    expect(canPostJournal('pool_operator')).toBe(true);
  });

  it('empleado de administración arma débitos y no ve sistema', () => {
    const tabs = allowedAdminTabs('admin_employee');
    expect(tabs).toContain('members');
    expect(tabs).toContain('operation');
    expect(allowedAccountingSubtabs('admin_employee')).toEqual(['prisma', 'galicia', 'debit_moves']);
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
    expect(tabs).toContain('settings');
    expect(tabs).toContain('migration');
    expect(tabs).toContain('accounting');
    expect(tabs).toContain('books');
    expect(tabs).toContain('informes');
    expect(tabs).toContain('operation');
    expect(allowedAccountingSubtabs('superadmin').length).toBe(allowedAccountingSubtabs('admin').length);
  });

  it('admin ve Caja, Contabilidad y Débitos; cajero solo Caja; contador ve ambos', () => {
    expect(allowedAdminTabs('admin')).toContain('operation');
    expect(allowedAdminTabs('admin')).toContain('books');
    expect(allowedAdminTabs('admin')).toContain('informes');
    expect(allowedAdminTabs('admin')).toContain('accounting');
    expect(allowedAdminTabs('admin')).toContain('caja');
    expect(allowedAdminTabs('cashier')).toContain('caja');
    expect(allowedAdminTabs('cashier')).not.toContain('operation');
    expect(allowedAdminTabs('cashier')).not.toContain('books');
    expect(allowedAdminTabs('cashier')).not.toContain('informes');
    expect(allowedAdminTabs('cashier')).not.toContain('accounting');
    expect(allowedAdminTabs('admin_employee')).toContain('operation');
    expect(allowedAdminTabs('admin_employee')).not.toContain('caja');
    expect(allowedAdminTabs('admin_employee')).not.toContain('books');
    expect(allowedAdminTabs('admin_employee')).not.toContain('informes');
    expect(allowedAdminTabs('admin_employee')).not.toContain('accounting');
    expect(allowedAdminTabs('accountant')).toContain('caja');
    expect(allowedAdminTabs('accountant')).toContain('operation');
    expect(allowedAdminTabs('superadmin')).toContain('caja');
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

describe('canEditFeePackAmounts', () => {
  it('solo el superadministrador cambia valores de categoría en liquidación', () => {
    expect(canEditFeePackAmounts('superadmin')).toBe(true);
    expect(canEditFeePackAmounts([{ roleKey: 'superadmin' }])).toBe(true);
    for (const role of ['admin', 'accountant', 'admin_employee', 'cashier', 'staff']) {
      expect(canEditFeePackAmounts(role)).toBe(false);
    }
  });
});

describe('canManageMembers', () => {
  it('solo administrador y superadministrador editan el padrón', () => {
    expect(canManageMembers('superadmin')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    for (const role of ['accountant', 'cashier', 'gate_operator', 'admin_employee', 'pool_operator', 'staff', 'hr', 'teacher', 'member']) {
      expect(canManageMembers(role)).toBe(false);
    }
  });
});

describe('canDeliverMemberAccess', () => {
  it('cualquier rol de staff del panel puede entregar acceso de socio', () => {
    for (const role of ['superadmin', 'admin', 'admin_employee', 'cashier', 'accountant', 'gate_operator', 'pool_operator', 'staff', 'hr']) {
      expect(canDeliverMemberAccess(role)).toBe(true);
    }
    expect(canDeliverMemberAccess('teacher')).toBe(false);
    expect(canDeliverMemberAccess('member')).toBe(false);
  });
});

describe('multi-role helpers', () => {
  it('deriva el rol primario y detecta roles acumulados', () => {
    expect(primaryRoleFromList(['member', 'superadmin', 'presidente'])).toBe('superadmin');
    expect(hasRoleInList(['superadmin', 'presidente', 'member'], 'presidente')).toBe(true);
    expect(hasRoleInList(['superadmin'], 'member')).toBe(false);
  });
});

describe('hasSystemAdminRole', () => {
  it('excluye socios y personal; incluye admin, superadmin y ambos roles', () => {
    expect(hasSystemAdminRole('member')).toBe(false);
    expect(hasSystemAdminRole('staff')).toBe(false);
    expect(hasSystemAdminRole('admin')).toBe(true);
    expect(hasSystemAdminRole('superadmin')).toBe(true);
    expect(hasSystemAdminRole(['member', 'admin'])).toBe(true);
    expect(hasSystemAdminRole([{ roleKey: 'member' }, { roleKey: 'socio_titular' }])).toBe(false);
    expect(hasSystemAdminRole({ role: 'member', roles: [{ roleKey: 'admin' }] })).toBe(true);
    expect(hasSystemAdminRole({ role: 'admin', roles: [] })).toBe(true);
    expect(hasSystemAdminRole({ role: 'member', roles: [{ roleKey: 'member' }] })).toBe(false);
  });
});

describe('canAccessConcessions', () => {
  it('admin y contador acceden a concesiones; cajero y socio no', () => {
    expect(canAccessConcessions('admin')).toBe(true);
    expect(canAccessConcessions('superadmin')).toBe(true);
    expect(canAccessConcessions('accountant')).toBe(true);
    expect(canAccessConcessions('cashier')).toBe(false);
    expect(canAccessConcessions('staff')).toBe(false);
    expect(canAccessConcessions('member')).toBe(false);
  });
});

describe('allowedAccountingSubtabs', () => {
  it('el cajero y el operador de portería ven caja y otros ingresos', () => {
    expect(allowedAccountingSubtabs('cashier')).toEqual(['cash', 'other_incomes']);
    expect(allowedAccountingSubtabs('gate_operator')).toEqual(['cash', 'other_incomes']);
  });

  it('admin ve libros y caja; el empleado de administración solo débitos', () => {
    expect(allowedAccountingSubtabs('admin')).toContain('diary');
    expect(allowedAccountingSubtabs('admin')).toContain('cash');
    expect(allowedAccountingSubtabs('admin')).toContain('prisma');
    expect(allowedAccountingSubtabs('admin_employee')).toEqual(['prisma', 'galicia', 'debit_moves']);
    expect(allowedAccountingSubtabs('admin_employee')).not.toContain('diary');
    expect(allowedAccountingSubtabs('pool_operator')).toEqual([]);
  });

  it('el contador emite libre deuda y ve grupos familiares', () => {
    expect(allowedAccountingSubtabs('accountant')).toContain('libre_deuda');
    expect(allowedAccountingSubtabs('accountant')).toContain('family_balances');
    expect(allowedAccountingSubtabs('accountant')).toContain('member_discounts');
    expect(allowedAccountingSubtabs('accountant')).toContain('bonificaciones');
    expect(allowedAccountingSubtabs('accountant')).toContain('balance_summary');
    expect(allowedAccountingSubtabs('accountant')).toContain('siap');
    expect(allowedAccountingSubtabs('accountant')).toContain('impuestos');
    expect(allowedAccountingSubtabs('superadmin')).toContain('libre_deuda');
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
    expect(navItemsForRole('member', { membersCanViewCurrentAccounts: false }).map((i) => i.id))
      .toEqual(['dashboard', 'reservations', 'news']);
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

describe('canManageTeachers', () => {
  it('admin y superadmin gestionan profesores', () => {
    expect(canManageTeachers('admin')).toBe(true);
    expect(canManageTeachers('superadmin')).toBe(true);
    expect(canManageTeachers('staff')).toBe(false);
    expect(canManageTeachers('teacher')).toBe(false);
  });
});

describe('allowedAdminTabs teachers', () => {
  it('admin y superadmin ven la pestaña profesores', () => {
    expect(allowedAdminTabs('admin')).toContain('teachers');
    expect(allowedAdminTabs('superadmin')).toContain('teachers');
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
