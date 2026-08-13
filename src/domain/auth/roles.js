/** Roles operativos del club y matriz de permisos. */

export const ROLES = {
  member: 'member',
  staff: 'staff',
  cashier: 'cashier',
  accountant: 'accountant',
  admin: 'admin',
  superadmin: 'superadmin',
};

export const ROLE_LABELS = {
  member: 'Socio',
  staff: 'Personal',
  cashier: 'Cajero',
  accountant: 'Contador',
  admin: 'Administrador',
  superadmin: 'Superadmin',
};

/** Quién puede entrar al panel de administración. */
export function canAccessAdmin(role) {
  return ['staff', 'cashier', 'accountant', 'admin', 'superadmin'].includes(role);
}

/** Quién puede usar la página móvil de Control QR / molinete. */
export function canAccessQrGate(role) {
  return ['staff', 'cashier', 'admin', 'superadmin'].includes(role);
}

/** Quién puede usar la sección aparte de Concesiones (`/concesiones`). */
export function canAccessConcessions(role) {
  return ['admin', 'superadmin', 'accountant'].includes(role);
}

/** Tabs del AdminView permitidos por rol. */
export function allowedAdminTabs(role) {
  if (role === 'admin' || role === 'superadmin') {
    return [
      'dashboard',
      'members',
      'dues',
      'bookings',
      'disciplines',
      'access',
      'accounting',
      'staff',
      'events',
      'alerts',
      'claims',
      'messaging',
      'reports',
      'surveys',
      'migration',
    ];
  }
  if (role === 'accountant') {
    return ['dashboard', 'dues', 'accounting', 'reports', 'events'];
  }
  if (role === 'cashier') {
    return ['dashboard', 'members', 'dues', 'access', 'accounting', 'events'];
  }
  if (role === 'staff') {
    return ['dashboard', 'bookings', 'disciplines', 'access', 'staff', 'events', 'alerts', 'claims'];
  }
  return [];
}

/** Subpestañas de Contabilidad por rol. */
export function allowedAccountingSubtabs(role) {
  if (role === 'admin' || role === 'superadmin' || role === 'accountant') {
    return [
      'diary', 'mayor', 'create', 'balance', 'results', 'charts', 'plan',
      'cash', 'expenses', 'suppliers',
      'unidentified', 'galicia', 'fixed_expenses', 'fixed_discounts', 'balances', 'payment_orders',
    ];
  }
  if (role === 'cashier') {
    // Solo operación de caja; gastos/proveedores/diario viven en Contabilidad (admin/contador).
    return ['cash'];
  }
  return ['diary'];
}

export function canManageMembers(role) {
  return ['cashier', 'admin', 'superadmin'].includes(role);
}

export function canPostJournal(role) {
  return ['cashier', 'accountant', 'admin', 'superadmin'].includes(role);
}

export function navItemsForRole(role) {
  if (role === 'member') {
    return [
      { id: 'dashboard', label: 'Inicio' },
      { id: 'reservations', label: 'Reservar Canchas' },
      { id: 'payments', label: 'Mi Cuenta' },
      { id: 'news', label: 'Revista Digital' },
    ];
  }
  // Roles operativos: navegan por las pestañas del panel (/panel/:tab), no por este menú.
  return [];
}

/** Cabecera del panel operativo según rol. */
export const ROLE_PANEL_META = {
  admin: {
    title: 'Administración',
    subtitle: 'Operaciones, socios, contabilidad y control del club',
  },
  superadmin: {
    title: 'Administración',
    subtitle: 'Operaciones, socios, contabilidad y control del club',
  },
  accountant: {
    title: 'Contabilidad',
    subtitle: 'Libro diario, mayores, balances y reportes',
  },
  cashier: {
    title: 'Caja',
    subtitle: 'Cuotas, padrón, arqueo y acceso',
  },
  staff: {
    title: 'Operaciones',
    subtitle: 'Reservas, reclamos, personal y eventos',
  },
};
