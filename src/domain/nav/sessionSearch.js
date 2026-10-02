/** Buscador de la barra de sesión: secciones del panel y herramientas. */

const ADMIN_SECTIONS = [
  { key: 'dashboard', title: 'Inicio', keywords: 'inicio tablero panel' },
  { key: 'members', title: 'Socios', keywords: 'socios padron ficha alta' },
  { key: 'dues', title: 'Cuotas', keywords: 'cuotas socios liquidacion vencimiento saldos cuentas' },
  { key: 'bookings', title: 'Reservas', keywords: 'reservas canchas turnos' },
  { key: 'disciplines', title: 'Disciplinas', keywords: 'disciplinas deportes' },
  { key: 'pool', title: 'Pileta', keywords: 'pileta natacion' },
  { key: 'access', title: 'Ingresos', keywords: 'ingresos porteria acceso' },
  { key: 'accounting', title: 'Contabilidad', keywords: 'contabilidad caja tesoreria libros' },
  { key: 'staff', title: 'Personal', keywords: 'personal empleados rrhh' },
  { key: 'teachers', title: 'Profesores', keywords: 'profesores docentes' },
  { key: 'events', title: 'Fiestas', keywords: 'fiestas eventos' },
  { key: 'alerts', title: 'Alertas', keywords: 'alertas avisos' },
  { key: 'claims', title: 'Reclamos', keywords: 'reclamos' },
  { key: 'messaging', title: 'Mensajería', keywords: 'mensajeria mensajes' },
  { key: 'news', title: 'Novedades', keywords: 'novedades revista' },
  { key: 'reports', title: 'Reportes', keywords: 'reportes informes' },
  { key: 'surveys', title: 'Encuestas', keywords: 'encuestas' },
  { key: 'system', title: 'Usuarios y altas', keywords: 'usuarios altas permisos' },
  { key: 'migration', title: 'Migración', keywords: 'migracion datos' },
  { key: 'jev', title: 'IA', keywords: 'ia inteligencia artificial revision jev' },
];

const ACCOUNTING_TOOLS = [
  { key: 'diary', title: 'Libro Diario', keywords: 'diario asientos libros contabilidad' },
  { key: 'mayor', title: 'Libro Mayor', keywords: 'mayor cuentas libros contabilidad' },
  { key: 'create', title: 'Crear asiento', keywords: 'asiento nuevo diario contabilidad' },
  { key: 'balance', title: 'Balance', keywords: 'balance mensual contabilidad' },
  { key: 'results', title: 'Estado de resultados', keywords: 'resultados contabilidad' },
  { key: 'charts', title: 'Reportes y gráficos', keywords: 'graficos reportes contabilidad' },
  { key: 'acct_reports', title: 'Reportes contables', keywords: 'reportes contabilidad' },
  { key: 'libre_deuda', title: 'Libre deuda', keywords: 'libre deuda certificado socios' },
  { key: 'family_balances', title: 'Grupo familiar', keywords: 'familia grupo socios saldos' },
  { key: 'member_discounts', title: 'Descuentos extras', keywords: 'descuentos extras socios categorias bonificaciones' },
  { key: 'bonificaciones', title: 'Bonificaciones', keywords: 'bonificaciones descuentos socios' },
  { key: 'siap', title: 'SIAP', keywords: 'siap impuestos' },
  { key: 'plan', title: 'Plan de cuentas', keywords: 'plan cuentas contabilidad' },
  { key: 'cash', title: 'Cajas', keywords: 'caja cajas tesoreria efectivo' },
  { key: 'expenses', title: 'Gastos', keywords: 'gastos egresos proveedores tesoreria' },
  { key: 'suppliers', title: 'Proveedores', keywords: 'proveedores gastos' },
  { key: 'retenciones', title: 'Retenciones', keywords: 'retenciones impuestos' },
  { key: 'other_incomes', title: 'Otros ingresos', keywords: 'ingresos otros' },
  { key: 'interest_generators', title: 'Intereses', keywords: 'intereses recargos' },
  { key: 'unidentified', title: 'Sin identificar', keywords: 'cobranzas sin identificar' },
  { key: 'galicia', title: 'Galicia', keywords: 'galicia banco debitos' },
  { key: 'fixed_expenses', title: 'Gastos fijos', keywords: 'gastos fijos recurrentes' },
  { key: 'balances', title: 'Saldos', keywords: 'saldos socios cuentas' },
  { key: 'payment_orders', title: 'Órdenes de pago', keywords: 'ordenes pago' },
  { key: 'credit_purchases', title: 'Créditos socios', keywords: 'creditos socios' },
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokensOf(query) {
  return normalize(query).split(/\s+/).filter((token) => token.length >= 2);
}

function tokenHits(hay, tokens) {
  const text = normalize(hay);
  return tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function pushRanked(items, entry, tokens) {
  const hits = tokenHits(`${entry.title} ${entry.keywords || ''}`, tokens);
  if (!hits) return;
  items.push({ ...entry, score: hits * 10 + (hits === tokens.length ? 5 : 0) });
}

export function searchSession({
  query = '',
  tabs = [],
  accountingTabs = [],
  members = [],
  staffMembers = [],
  limit = 10,
} = {}) {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];

  const items = [];
  const allowed = new Set(tabs);

  ADMIN_SECTIONS.forEach((section) => {
    if (!allowed.has(section.key)) return;
    pushRanked(items, {
      id: `section-${section.key}`,
      kind: 'section',
      title: section.title,
      keywords: section.keywords,
      subtitle: 'Sección',
      path: `/panel/${section.key}`,
    }, tokens);
  });

  if (allowed.has('accounting')) {
    const accountingAllowed = new Set(accountingTabs);
    ACCOUNTING_TOOLS.forEach((tool) => {
      if (!accountingAllowed.has(tool.key)) return;
      pushRanked(items, {
        id: `tool-${tool.key}`,
        kind: 'tool',
        title: tool.title,
        keywords: tool.keywords,
        subtitle: 'Contabilidad',
        path: `/panel/accounting?sub=${tool.key}`,
      }, tokens);
    });
  }

  if (allowed.has('members')) {
    members.forEach((member) => {
      const hay = [
        member.name,
        member.memberId,
        member.documentNumber,
        member.email,
        member.phone,
      ].join(' ');
      if (tokenHits(hay, tokens) !== tokens.length) return;
      items.push({
        id: `member-${member.memberId}`,
        kind: 'member',
        title: member.name,
        subtitle: `Socio · ${member.memberId || '—'}`,
        path: `/panel/members/${member.memberId}`,
        score: 8,
      });
    });
  }

  if (allowed.has('staff')) {
    staffMembers.forEach((person) => {
      const hay = [person.name, person.role, person.area, person.email, person.phone, person.id].join(' ');
      if (tokenHits(hay, tokens) !== tokens.length) return;
      items.push({
        id: `staff-${person.id}`,
        kind: 'staff',
        title: person.name || 'Personal',
        subtitle: `Personal · ${person.role || person.area || person.id}`,
        path: `/panel/staff/${person.id}`,
        score: 8,
      });
    });
  }

  const kindRank = { tool: 0, section: 1, member: 2, staff: 3 };
  return items
    .toSorted((a, b) => b.score - a.score || kindRank[a.kind] - kindRank[b.kind] || a.title.localeCompare(b.title, 'es'))
    .slice(0, limit);
}
