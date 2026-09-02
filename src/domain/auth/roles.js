/** Roles operativos del club y matriz de permisos. */

export const ROLES = {
  member: 'member',
  teacher: 'teacher',
  staff: 'staff',
  hr: 'hr',
  admin_employee: 'admin_employee',
  gate_operator: 'gate_operator',
  cashier: 'cashier',
  accountant: 'accountant',
  admin: 'admin',
  superadmin: 'superadmin',
};

export const ROLE_LABELS = {
  member: 'Socio',
  teacher: 'Profesor',
  staff: 'Personal',
  hr: 'Recursos humanos',
  admin_employee: 'Empleado de administración',
  gate_operator: 'Operador de portería',
  cashier: 'Cajero',
  accountant: 'Contador',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
};

/** Todos los roles asignables en el portal. */
export const PORTAL_ROLE_OPTIONS = [
  'member',
  'teacher',
  'staff',
  'hr',
  'admin_employee',
  'gate_operator',
  'cashier',
  'accountant',
  'admin',
  'superadmin',
];

/** Cargos / títulos institucionales (pueden coexistir con roles de sistema). */
export const TITLE_ROLE_OPTIONS = [
  { key: 'presidente', label: 'Presidente' },
  { key: 'vicepresidente', label: 'Vicepresidente' },
  { key: 'secretario', label: 'Secretario' },
  { key: 'tesorero', label: 'Tesorero' },
  { key: 'vocal', label: 'Vocal' },
  { key: 'socio_titular', label: 'Socio titular' },
  { key: 'socio_adherente', label: 'Socio adherente' },
];

const ROLE_RANK = {
  superadmin: 60,
  admin: 50,
  accountant: 40,
  cashier: 32,
  gate_operator: 31,
  admin_employee: 25,
  hr: 23,
  staff: 20,
  teacher: 15,
  member: 10,
};

export function roleRank(roleKey) {
  return ROLE_RANK[String(roleKey || '').toLowerCase()] || 0;
}

/** Deriva el rol operativo primario (mayor privilegio) desde una lista. */
export function primaryRoleFromList(roles = []) {
  const keys = (roles || [])
    .map((r) => (typeof r === 'string' ? r : r?.roleKey || r?.key))
    .filter(Boolean);
  if (!keys.length) return 'member';
  return keys.reduce((best, key) => (roleRank(key) > roleRank(best) ? key : best), keys[0]);
}

export function hasRoleInList(roles = [], roleKey) {
  const want = String(roleKey || '').toLowerCase();
  return (roles || []).some((r) => {
    const key = String(typeof r === 'string' ? r : r?.roleKey || r?.key || '').toLowerCase();
    return key === want;
  });
}

/** Pestañas del panel: el superadmin ve el set completo. */
export const ALL_ADMIN_TABS = [
  'dashboard',
  'members',
  'dues',
  'bookings',
  'disciplines',
  'pool',
  'access',
  'accounting',
  'staff',
  'events',
  'alerts',
  'claims',
  'messaging',
  'news',
  'reports',
  'surveys',
  'system',
  'migration',
];

/** Tabs sin contabilidad (Administrador operativo). */
const ADMIN_TABS_NO_ACCOUNTING = ALL_ADMIN_TABS.filter((t) => t !== 'accounting');

export function isSuperAdmin(roleOrRoles) {
  if (Array.isArray(roleOrRoles)) return hasRoleInList(roleOrRoles, 'superadmin');
  return roleOrRoles === 'superadmin';
}

/** Solo el superadministrador puede crear/editar perfiles de usuarios del portal. */
export function canManageProfiles(roleOrRoles) {
  return isSuperAdmin(roleOrRoles);
}

const OPS_ROLES = [
  'staff',
  'hr',
  'admin_employee',
  'gate_operator',
  'cashier',
  'accountant',
  'admin',
  'superadmin',
];

/** Quién puede entrar al panel de administración. */
export function canAccessAdmin(role) {
  return OPS_ROLES.includes(role);
}

/** Quién puede usar la página móvil de Control QR / molinete. */
export function canAccessQrGate(role) {
  return ['staff', 'cashier', 'gate_operator', 'admin', 'superadmin'].includes(role);
}

/** Quién puede tomar asistencia de disciplinas. */
export function canTakeAttendance(role) {
  return ['teacher', 'staff', 'admin', 'superadmin'].includes(role);
}

/** Quién puede usar la sección aparte de Concesiones (`/concesiones`). */
export function canAccessConcessions(role) {
  return ['admin', 'superadmin', 'accountant'].includes(role);
}

/** Tabs del AdminView permitidos por rol. */
export function allowedAdminTabs(role) {
  // Superadministrador: acceso absoluto a todas las funciones del panel.
  if (role === 'superadmin') {
    return [...ALL_ADMIN_TABS];
  }
  // Administrador: opera el club pero sin contabilidad.
  if (role === 'admin') {
    return [...ADMIN_TABS_NO_ACCOUNTING];
  }
  if (role === 'accountant') {
    return ['dashboard', 'dues', 'accounting', 'reports', 'events'];
  }
  // Operador de portería: caja + portería / ingresos.
  if (role === 'gate_operator') {
    return ['dashboard', 'members', 'dues', 'pool', 'access', 'accounting'];
  }
  if (role === 'cashier') {
    return ['dashboard', 'members', 'dues', 'pool', 'access', 'accounting', 'events'];
  }
  // Empleado de administración: padrón, cuotas, atención (sin contabilidad ni sistema).
  if (role === 'admin_employee') {
    return [
      'dashboard',
      'members',
      'dues',
      'bookings',
      'pool',
      'events',
      'alerts',
      'claims',
      'messaging',
      'news',
      'surveys',
    ];
  }
  // Recursos humanos: personal y novedades RR.HH.
  if (role === 'hr') {
    return ['dashboard', 'staff', 'alerts'];
  }
  if (role === 'staff') {
    return ['dashboard', 'bookings', 'disciplines', 'pool', 'access', 'staff', 'events', 'alerts', 'claims', 'news'];
  }
  return [];
}

/** Une permisos de todos los roles activos (multi-rol). */
export function allowedAdminTabsForRoles(rolesOrPrimary) {
  if (!Array.isArray(rolesOrPrimary)) {
    return allowedAdminTabs(rolesOrPrimary);
  }
  const keys = rolesOrPrimary
    .map((r) => (typeof r === 'string' ? r : r?.roleKey || r?.key))
    .filter(Boolean)
    .map((k) => String(k).toLowerCase());
  if (keys.includes('superadmin')) return [...ALL_ADMIN_TABS];
  const allowed = new Set();
  keys.forEach((key) => {
    allowedAdminTabs(key).forEach((tab) => allowed.add(tab));
  });
  return ALL_ADMIN_TABS.filter((tab) => allowed.has(tab));
}

export function allowedAccountingSubtabsForRoles(rolesOrPrimary) {
  if (!Array.isArray(rolesOrPrimary)) {
    return allowedAccountingSubtabs(rolesOrPrimary);
  }
  const keys = rolesOrPrimary
    .map((r) => (typeof r === 'string' ? r : r?.roleKey || r?.key))
    .filter(Boolean)
    .map((k) => String(k).toLowerCase());
  if (keys.includes('superadmin') || keys.includes('accountant')) {
    return allowedAccountingSubtabs('superadmin');
  }
  const allowed = new Set();
  keys.forEach((key) => {
    allowedAccountingSubtabs(key).forEach((tab) => allowed.add(tab));
  });
  return allowedAccountingSubtabs('superadmin').filter((tab) => allowed.has(tab));
}

/** Subpestañas de Contabilidad por rol. */
export function allowedAccountingSubtabs(role) {
  if (role === 'superadmin' || role === 'accountant') {
    return [
      'diary', 'mayor', 'create', 'balance', 'results', 'charts', 'plan',
      'cash', 'expenses', 'suppliers',
      'unidentified', 'galicia', 'fixed_expenses', 'fixed_discounts', 'balances', 'payment_orders',
    ];
  }
  // Administrador: sin contabilidad.
  if (role === 'admin') {
    return [];
  }
  if (role === 'cashier' || role === 'gate_operator') {
    // Solo operación de caja; gastos/proveedores/diario viven en Contabilidad (contador/superadmin).
    return ['cash'];
  }
  return [];
}

export function canManageMembers(role) {
  return ['cashier', 'gate_operator', 'admin_employee', 'admin', 'superadmin'].includes(role);
}

export function canPostJournal(role) {
  return ['cashier', 'gate_operator', 'accountant', 'superadmin'].includes(role);
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
  if (role === 'teacher') {
    return [
      { id: 'attendance', label: 'Asistencia' },
    ];
  }
  // Roles operativos: navegan por las pestañas del panel (/panel/:tab), no por este menú.
  return [];
}

/** Cabecera del panel operativo según rol. */
export const ROLE_PANEL_META = {
  admin: {
    title: 'Administración',
    subtitle: 'Operaciones, socios y control del club (sin contabilidad)',
  },
  superadmin: {
    title: 'Superadministración',
    subtitle: 'Acceso total al sistema y gestión de perfiles de usuario',
  },
  accountant: {
    title: 'Contabilidad',
    subtitle: 'Libro diario, mayores, balances y reportes',
  },
  cashier: {
    title: 'Caja',
    subtitle: 'Cuotas, padrón, arqueo y acceso',
  },
  gate_operator: {
    title: 'Portería',
    subtitle: 'Control de acceso, ingresos y caja',
  },
  admin_employee: {
    title: 'Administración',
    subtitle: 'Padrón, cuotas y atención al socio',
  },
  hr: {
    title: 'Recursos humanos',
    subtitle: 'Personal, novedades y legajos',
  },
  staff: {
    title: 'Operaciones',
    subtitle: 'Reservas, reclamos, personal y eventos',
  },
  teacher: {
    title: 'Profesores',
    subtitle: 'Asistencia y estado de cuota de alumnos',
  },
};

/**
 * Nombre corto para saludos en UI.
 * Evita cargos institucionales (“Comisión”, “Tesorería”…) y usa el rol.
 */
export function sessionGreetLabel(fullName = '', role = '') {
  const name = String(fullName).trim();
  const first = name.split(/\s+/)[0] || '';
  if (!first || /^(comisi[oó]n|tesorer[ií]a|secretar[ií]a|administraci[oó]n|jockey|personal|caja)/i.test(first)) {
    return ROLE_LABELS[role] || 'equipo';
  }
  return first;
}
