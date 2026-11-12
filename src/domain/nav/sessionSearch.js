/** Buscador de la barra de sesión: secciones del panel y herramientas. */

const ADMIN_SECTIONS = [
  { key: 'dashboard', title: 'Inicio', keywords: 'inicio tablero panel' },
  { key: 'members', title: 'Socios', keywords: 'socios padron ficha alta' },
  { key: 'members_app', title: 'Socios con app', keywords: 'socios app portal acceso credenciales con app' },
  { key: 'dues', title: 'Cuotas', keywords: 'cuotas socios liquidacion vencimiento saldos cuentas' },
  { key: 'bookings', title: 'Reservas', keywords: 'reservas canchas turnos' },
  { key: 'disciplines', title: 'Disciplinas', keywords: 'disciplinas deportes' },
  { key: 'pool', title: 'Pileta', keywords: 'pileta natacion canon' },
  { key: 'pool_gate', title: 'Entrada pileta', keywords: 'entrada pileta puerta apto invitado' },
  { key: 'access', title: 'Ingresos', keywords: 'ingresos porteria acceso' },
  { key: 'gate_income', title: 'Ingresos portería', keywords: 'ingresos porteria rendicion estacionamiento rindio' },
  { key: 'accounting', title: 'Contabilidad', keywords: 'contabilidad padron catalogo' },
  { key: 'books', title: 'Libros', keywords: 'libros diario mayor asientos contabilidad partida doble' },
  { key: 'informes', title: 'Informes', keywords: 'informes balance resultados graficos reportes contables' },
  { key: 'operation', title: 'Operación', keywords: 'operacion tesoreria gastos proveedores debitos' },
  { key: 'staff', title: 'Personal', keywords: 'personal empleados rrhh' },
  { key: 'teachers', title: 'Profesores', keywords: 'profesores docentes' },
  { key: 'events', title: 'Fiestas', keywords: 'fiestas eventos' },
  { key: 'alerts', title: 'Alertas', keywords: 'alertas avisos' },
  { key: 'claims', title: 'Reclamos', keywords: 'reclamos' },
  { key: 'messaging', title: 'Mensajería', keywords: 'mensajeria mensajes mail md whatsapp comunicado masivo ia redactar' },
  { key: 'news', title: 'Novedades', keywords: 'novedades revista' },
  { key: 'reports', title: 'Reportes', keywords: 'reportes exportaciones estadisticas' },
  { key: 'surveys', title: 'Encuestas', keywords: 'encuestas' },
  { key: 'system', title: 'Usuarios y altas', keywords: 'usuarios altas permisos' },
  { key: 'settings', title: 'Configuración', keywords: 'configuracion sistema sede pileta zonda vencimiento' },
  { key: 'migration', title: 'Migración', keywords: 'migracion datos' },
  { key: 'jev', title: 'IA', keywords: 'ia inteligencia artificial revision jev chat gemini analisis libro consulta predicciones manual uso' },
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
  { key: 'impuestos', title: 'Impuestos', keywords: 'impuestos iva iibb comprobantes liquidacion taxes' },
  { key: 'plan', title: 'Plan de cuentas', keywords: 'plan cuentas contabilidad' },
  { key: 'cash', title: 'Caja', keywords: 'caja cajas tesoreria efectivo arqueo cobranzas' },
  { key: 'expenses', title: 'Gastos', keywords: 'gastos egresos proveedores tesoreria' },
  { key: 'suppliers', title: 'Proveedores', keywords: 'proveedores gastos' },
  { key: 'retenciones', title: 'Retenciones', keywords: 'retenciones impuestos' },
  { key: 'other_incomes', title: 'Otros ingresos', keywords: 'ingresos otros' },
  { key: 'interest_generators', title: 'Intereses', keywords: 'intereses recargos' },
  { key: 'unidentified', title: 'Sin identificar', keywords: 'cobranzas sin identificar' },
  { key: 'galicia', title: 'Galicia', keywords: 'galicia banco debitos' },
  { key: 'prisma', title: 'Prisma', keywords: 'prisma debito automatico visa mastercard debliq' },
  { key: 'debit_moves', title: 'Listados de débitos', keywords: 'altas bajas debito automatico cuota mes adhesion prisma argencard visa planilla' },
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
    const permittedKey = section.key === 'pool_gate'
      ? 'pool'
      : section.key === 'members_app'
        ? 'members'
        : section.key;
    if (!allowed.has(permittedKey)) return;
    const path = section.key === 'pool'
      ? '/pileta'
      : section.key === 'pool_gate'
        ? '/entrada-pileta'
        : `/panel/${section.key}`;
    pushRanked(items, {
      id: `section-${section.key}`,
      kind: 'section',
      title: section.title,
      keywords: section.keywords,
      subtitle: section.key === 'pool_gate'
        ? 'Pileta'
        : section.key === 'members_app'
          ? 'Socios'
          : 'Sección',
      path,
    }, tokens);
  });

  if (allowed.has('accounting') || allowed.has('books') || allowed.has('informes') || allowed.has('caja') || allowed.has('operation')) {
    const accountingAllowed = new Set(accountingTabs);
    const bookKeys = new Set(['diary', 'mayor', 'create']);
    const reportKeys = new Set([
      'balance', 'balance_monthly', 'balance_summary', 'balance_liquidation', 'balance_patrimonial',
      'results', 'charts', 'acct_reports',
    ]);
    const treasuryKeys = new Set([
      'cash', 'expenses', 'suppliers', 'retenciones', 'other_incomes', 'interest_generators',
      'unidentified', 'galicia', 'prisma', 'debit_moves', 'fixed_expenses', 'balances', 'payment_orders',
      'credit_purchases',
    ]);
    ACCOUNTING_TOOLS.forEach((tool) => {
      if (!accountingAllowed.has(tool.key)) return;
      const isBook = bookKeys.has(tool.key);
      const isReport = reportKeys.has(tool.key);
      const isTreasury = treasuryKeys.has(tool.key);
      if (isBook && !allowed.has('books') && !allowed.has('accounting')) return;
      if (isReport && !allowed.has('informes') && !allowed.has('accounting')) return;
      if (isTreasury && !allowed.has('operation') && !allowed.has('caja') && !allowed.has('accounting')) return;
      if (!isBook && !isReport && !isTreasury && !allowed.has('accounting')) return;
      const path = isBook && allowed.has('books')
        ? `/panel/books?sub=${tool.key}`
        : isReport && allowed.has('informes')
          ? `/panel/informes?sub=${tool.key}`
          : (tool.key === 'cash' || tool.key === 'other_incomes') && allowed.has('caja')
            ? `/panel/caja?sub=${tool.key}`
            : isTreasury && allowed.has('operation')
              ? `/panel/operation?sub=${tool.key}`
              : `/panel/accounting?sub=${tool.key}`;
      pushRanked(items, {
        id: `tool-${tool.key}`,
        kind: 'tool',
        title: tool.title,
        keywords: tool.keywords,
        subtitle: isBook
          ? 'Libros'
          : isReport
            ? 'Informes'
            : (tool.key === 'cash' || tool.key === 'other_incomes')
              ? 'Caja'
              : isTreasury
                ? 'Operación'
                : 'Contabilidad',
        path,
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
