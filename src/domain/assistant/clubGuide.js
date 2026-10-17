/** Mapa del panel y dictámenes de Jev (cómo usar la app y qué dice el libro). */

import { duesDueMoment } from '../members/dues';
import { lessonInsight, matchManualLessons, manualForPrompt, manualOverview } from './appManual';

export const CLUB_GUIDE = [
  {
    id: 'inicio',
    tab: 'dashboard',
    title: 'Inicio',
    keywords: 'inicio tablero panel agenda semana',
    teach: 'En Inicio ves el vencimiento del mes, lo recaudado, la caja, la agenda de la semana y las alertas. El número grande de cuotas está arriba, una sola vez.',
  },
  {
    id: 'ia',
    tab: 'jev',
    title: 'IA · Jev',
    keywords: 'ia jev chat analisis preguntar consulta revision',
    teach: 'IA tiene tres salas. Consulta es la mesa. Revisión es el padrón. Predicciones proyecta el 10, la puerta y el padrón. Gemini no es un menú: es el motor de la consulta.',
  },
  {
    id: 'socios',
    tab: 'members',
    title: 'Socios',
    keywords: 'socio padron ficha adherente grupo familiar titular',
    teach: 'En Socios (Operación) está el padrón. Abrí una ficha para editar, cobrar, ver el grupo familiar o el resumen de cuenta. El número de socio es la llave.',
  },
  {
    id: 'cuotas',
    tab: 'dues',
    title: 'Cuotas',
    keywords: 'cuota liquidar periodo vencimiento mora saldos',
    teach: 'En Cuotas se arma el borrador el mes anterior y se liquida el mes en curso. Hasta octubre de 2026 el corte es el de LILA. Desde noviembre liquida esta app. Solo liquidan superadmin y contador. El resto ve Saldos.',
  },
  {
    id: 'reservas',
    tab: 'bookings',
    title: 'Reservas',
    keywords: 'reserva cancha turno salon tenis paddle',
    teach: 'En Reservas se toman canchas, salones y pileta. El socio reserva desde su portal, en Reservar Canchas.',
  },
  {
    id: 'ingresos',
    tab: 'access',
    title: 'Ingresos',
    keywords: 'ingresos porteria lecturas denegados credencial',
    teach: 'En Ingresos está el libro de portería: lecturas de credencial, denegados y el día de hoy.',
  },
  {
    id: 'acceso-qr',
    tab: 'qr_gate',
    title: 'Acceso QR',
    keywords: 'acceso qr molinete escaner control sede',
    teach: 'Acceso QR abre /acceso: el molinete de la sede. Escaneá la credencial o buscá el socio a mano. Lo usan portería, caja, personal, admin y superadmin.',
  },
  {
    id: 'entrada-pileta',
    tab: 'pool_gate',
    title: 'Entrada pileta',
    keywords: 'entrada pileta ticket invitado pase',
    teach: 'Entrada pileta abre /entrada-pileta: el control de ingreso a pileta, distinto de la caja del día. En temporada, desde el 10, sin la cuota del mes no entra.',
  },
  {
    id: 'pileta',
    tab: 'pool',
    title: 'Pileta',
    keywords: 'pileta canon natacion caja dia',
    teach: 'Pileta abre /pileta: caja del día y canon. El ingreso se lee con QR en Entrada pileta.',
  },
  {
    id: 'disciplinas',
    tab: 'disciplines',
    title: 'Disciplinas',
    keywords: 'disciplina deporte cancha instalacion catalogo',
    teach: 'En Disciplinas (Club) está el catálogo de deportes e instalaciones. El profesor toma asistencia en /asistencia, no acá.',
  },
  {
    id: 'fiestas',
    tab: 'events',
    title: 'Fiestas',
    keywords: 'fiesta evento inscripcion catering salon',
    teach: 'En Fiestas se cargan eventos del club, inscripciones y la imputación a cuenta. No es la agenda de reservas.',
  },
  {
    id: 'concesiones',
    tab: 'concessions',
    title: 'Concesiones',
    keywords: 'concesion canon local gastronomia espacio',
    teach: 'Concesiones abre /concesiones. Entran admin, superadmin y contador. Ahí están locales, contratos y el canon.',
  },
  {
    id: 'contabilidad',
    tab: 'accounting',
    title: 'Contabilidad',
    keywords: 'contabilidad tesoreria libros asiento',
    teach: 'Contabilidad (Gestión) tiene libros, tesorería, proveedores y órdenes. Cajero y portería solo ven caja. Administrador no entra.',
  },
  {
    id: 'personal',
    tab: 'staff',
    title: 'Personal',
    keywords: 'personal empleado rrhh legajo sueldo',
    teach: 'Personal está en Administración, con Profesores y Usuarios. Ahí están los legajos y RR.HH. No es el padrón de socios.',
  },
  {
    id: 'reportes',
    tab: 'reports',
    title: 'Reportes',
    keywords: 'reporte informe excel pdf backup respaldo',
    teach: 'En Reportes exportás padrones, diarios y el respaldo del club. El Excel y el PDF de cuotas también salen desde Cuotas.',
  },
  {
    id: 'novedades',
    tab: 'news',
    title: 'Novedades',
    keywords: 'novedades revista nota portada cms',
    teach: 'Revista es el CMS del panel. En el portal del socio la misma sección se llama Novedades. Publicá con foto de portada.',
  },
  {
    id: 'encuestas',
    tab: 'surveys',
    title: 'Encuestas',
    keywords: 'encuesta votacion opinion formulario',
    teach: 'En Encuestas armás consultas al padrón y ves las respuestas.',
  },
  {
    id: 'alertas',
    tab: 'alerts',
    title: 'Alertas',
    keywords: 'alerta aviso zonda vencimiento concesion',
    teach: 'En Alertas están los avisos operativos (Zonda, vencimientos, concesiones). En Inicio se acusa el que está vivo.',
  },
  {
    id: 'reclamos',
    tab: 'claims',
    title: 'Reclamos',
    keywords: 'reclamo queja ticket atencion',
    teach: 'En Reclamos se atienden quejas y pedidos del socio. Abiertos y pendientes quedan en el tablero.',
  },
  {
    id: 'mensajeria',
    tab: 'messaging',
    title: 'Mensajería',
    keywords: 'mensajeria mensaje correo interno mail md whatsapp comunicado masivo ia',
    teach: 'En Mensajería hay tres salas: Mail (bandeja y envío de correo), MD (mensaje interno) y WhatsApp (cobranza). La IA escribe el texto.',
  },
  {
    id: 'profesores',
    tab: 'teachers',
    title: 'Profesores',
    keywords: 'profesor docente clase alumno',
    teach: 'En Profesores se dan de alta docentes, disciplinas y claves. El profesor entra a /asistencia, no al panel.',
  },
  {
    id: 'usuarios',
    tab: 'system',
    title: 'Usuarios y altas',
    keywords: 'usuario permiso rol invitar perfil portal',
    teach: 'En Usuarios y altas se crea el acceso al portal. El socio entra con el correo de su ficha. Solo el superadmin crea y edita perfiles.',
  },
  {
    id: 'configuracion',
    tab: 'settings',
    title: 'Configuración',
    keywords: 'configuracion sistema sede pileta zonda vencimiento cuit mercado pago avisos mora',
    teach: 'Configuración está en Sistema, al lado de Migración. Ahí se guarda la sede, el día de las cuotas, los avisos del 5, el 10 y el 11, el canon de pileta, Mercado Pago y el Zonda. Vive en el libro.',
  },
  {
    id: 'migracion',
    tab: 'migration',
    title: 'Migración',
    keywords: 'migracion lila datita societas empalme snapshot',
    teach: 'Migración guarda los cortes de LILA y Societas. El empalme es el 1 de octubre de 2026. No se reimporta lo que ya está en el libro.',
  },
  {
    id: 'portal-socio',
    tab: 'members',
    title: 'Portal del socio',
    keywords: 'portal socio reservar canchas mi cuenta perfil registro',
    teach: 'El socio no usa el rail. Entra a Inicio, Reservar Canchas, Mi Cuenta y Novedades. El alta pública está en /registro.',
  },
  {
    id: 'asistencia',
    tab: 'teachers',
    title: 'Asistencia',
    keywords: 'asistencia profesor lista alumnos cuota',
    teach: 'Asistencia es /asistencia: el profesor marca presentes y ve si el alumno tiene la cuota al día.',
  },
];

export const CLUB_TOOLS = [
  { id: 'diario', tab: 'accounting', focus: 'diary', title: 'Libro Diario', keywords: 'diario asientos legal', teach: 'El Libro Diario está en Contabilidad → Libros. Ahí se ven los asientos. Crear asiento es otra herramienta.' },
  { id: 'mayor', tab: 'accounting', focus: 'mayor', title: 'Libro Mayor', keywords: 'mayor cuentas haberes', teach: 'El Libro Mayor está en Contabilidad → Libros. Muestra el movimiento por cuenta.' },
  { id: 'asiento', tab: 'accounting', focus: 'create', title: 'Crear asiento', keywords: 'crear asiento legal nuevo', teach: 'Crear asiento legal está en Contabilidad → Libros. Lo usan cajero, portería, contador y superadmin.' },
  { id: 'balance', tab: 'accounting', focus: 'balance', title: 'Balance', keywords: 'balance mensual resumido patrimonial', teach: 'Balance está en Contabilidad → Informes: mensual, resumido, cta. cte. y patrimonial. El corte de LILA vive ahí.' },
  { id: 'resultados', tab: 'accounting', focus: 'results', title: 'Estado de resultados', keywords: 'estado resultados ganancia', teach: 'Estado de resultados está en Contabilidad → Informes.' },
  { id: 'caja', tab: 'accounting', focus: 'cash', title: 'Cajas', keywords: 'caja cajas tesoreria efectivo arqueo', teach: 'Cajas / Tesorería está en Contabilidad → Operación. Cajero y portería entran directo a caja.' },
  { id: 'gastos', tab: 'accounting', focus: 'expenses', title: 'Gastos', keywords: 'gasto egreso factura', teach: 'Gastos está en Contabilidad → Operación. No es la caja del día de pileta.' },
  { id: 'proveedores', tab: 'accounting', focus: 'suppliers', title: 'Proveedores', keywords: 'proveedor factura orden', teach: 'Proveedores está en Contabilidad → Operación. Las órdenes de pago son otra herramienta.' },
  { id: 'ordenes', tab: 'accounting', focus: 'payment_orders', title: 'Órdenes de pago', keywords: 'orden pago tesoreria', teach: 'Órdenes de pago está en Contabilidad → Operación.' },
  { id: 'libre-deuda', tab: 'accounting', focus: 'libre_deuda', title: 'Libre deuda', keywords: 'libre deuda certificado', teach: 'Libre deuda está en Contabilidad → Informes. Emite el certificado del socio.' },
  { id: 'familia', tab: 'accounting', focus: 'family_balances', title: 'Grupo familiar', keywords: 'grupo familiar saldos familia', teach: 'Grupo familiar (saldos) está en Contabilidad → Informes. La ficha familiar se edita en Socios.' },
  { id: 'descuentos', tab: 'accounting', focus: 'member_discounts', title: 'Descuentos extras', keywords: 'descuento extra categoria', teach: 'Descuentos extras está en Contabilidad → Informes. Las bonificaciones de LILA son otra lista.' },
  { id: 'bonificaciones', tab: 'accounting', focus: 'bonificaciones', title: 'Bonificaciones', keywords: 'bonificacion descuento lila', teach: 'Bonificaciones está en Contabilidad → Informes. Es el listado que vino de LILA.' },
  { id: 'siap', tab: 'accounting', focus: 'siap', title: 'SIAP', keywords: 'siap impuestos afip', teach: 'SIAP está en Contabilidad → Informes.' },
  { id: 'impuestos', tab: 'accounting', focus: 'impuestos', title: 'Impuestos', keywords: 'impuestos iva iibb liquidacion comprobante', teach: 'Impuestos está en Contabilidad → Informes. Ahí se cargan comprobantes y se liquida IVA o IIBB. Las retenciones de Operación entran en esa liquidación.' },
  { id: 'plan', tab: 'accounting', focus: 'plan', title: 'Plan de cuentas', keywords: 'plan cuentas catalogo', teach: 'El plan de cuentas está en Contabilidad → Catálogo.' },
  { id: 'retenciones', tab: 'accounting', focus: 'retenciones', title: 'Retenciones', keywords: 'retencion impuesto', teach: 'Retenciones está en Contabilidad → Operación.' },
  { id: 'otros-ingresos', tab: 'accounting', focus: 'other_incomes', title: 'Otros ingresos', keywords: 'otros ingresos extra', teach: 'Otros ingresos está en Contabilidad → Operación. Cajero también lo ve.' },
  { id: 'intereses', tab: 'accounting', focus: 'interest_generators', title: 'Intereses', keywords: 'interes recargo mora generador', teach: 'Intereses está en Contabilidad → Operación. No se corre solo: se genera y se imputa.' },
  { id: 'sin-identificar', tab: 'accounting', focus: 'unidentified', title: 'Sin identificar', keywords: 'sin identificar cobranza desconocida', teach: 'Cobranzas sin identificar está en Contabilidad → Operación. Ahí se imputa lo que no tiene socio.' },
  { id: 'galicia', tab: 'accounting', focus: 'galicia', title: 'Galicia', keywords: 'galicia banco debito automatico', teach: 'Galicia está en Contabilidad → Operación: débitos automáticos.' },
  { id: 'gastos-fijos', tab: 'accounting', focus: 'fixed_expenses', title: 'Gastos fijos', keywords: 'gastos fijos recurrente', teach: 'Gastos fijos está en Contabilidad → Operación.' },
  { id: 'saldos-cta', tab: 'accounting', focus: 'balances', title: 'Saldos', keywords: 'saldos cuentas corrientes', teach: 'Saldos de cuenta está en Contabilidad → Operación. El saldo del socio también se ve en Cuotas y en la ficha.' },
  { id: 'creditos', tab: 'accounting', focus: 'credit_purchases', title: 'Créditos socios', keywords: 'credito socio compra', teach: 'Créditos socios está en Contabilidad → Operación.' },
];

export const ALL_GUIDE_TOPICS = [...CLUB_GUIDE, ...CLUB_TOOLS];

export const JEV_TABS = 'dashboard|jev|members|dues|bookings|disciplines|pool|pool_gate|access|qr_gate|accounting|staff|teachers|events|alerts|claims|messaging|news|reports|surveys|system|settings|migration|concessions';

export const APP_ROLES = 'Socio (portal), Profesor (/asistencia), Personal, RR.HH., Empleado de administración, Operador de portería, Operario de pileta (puerta y cobro del canon), Cajero, Contador, Administrador (sin contabilidad), Superadministrador (todo, únicos que crean perfiles).';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function formatGuideMoney(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

export function formatGuideCount(value) {
  return Number(value || 0).toLocaleString('es-AR');
}

function prettyLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function prettyDay(iso) {
  if (!iso) return '';
  return prettyLabel(new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
  }));
}

function topicWords(topic) {
  return fold(`${topic.title} ${topic.keywords}`).split(/\s+/).filter(Boolean);
}

export function matchGuideTopics(query = '') {
  const tokens = fold(query).split(/\s+/).filter((token) => token.length >= 3);
  if (!tokens.length) return [];
  return ALL_GUIDE_TOPICS
    .map((topic) => {
      const words = topicWords(topic);
      const hits = tokens.filter((token) => (
        words.some((word) => word === token || word.startsWith(token) || token.startsWith(word))
      )).length;
      return { ...topic, hits };
    })
    .filter((topic) => topic.hits > 0)
    .toSorted((a, b) => b.hits - a.hits || (a.focus ? 1 : 0) - (b.focus ? 1 : 0));
}

export function teachFromQuery(query = '') {
  const topics = matchGuideTopics(query);
  if (!topics.length) return null;
  const top = topics[0];
  return `${top.teach} Entrá a ${top.title} desde el menú de la izquierda.`;
}

export function monthReading(brief = {}) {
  const collected = Number(brief.collected) || 0;
  const liquidated = Number(brief.liquidated) || 0;
  const rest = Math.max(0, Math.round(liquidated - collected));
  const ratio = liquidated > 0 ? collected / liquidated : 0;
  const pct = Math.round(ratio * 100);
  const due = duesDueMoment(brief.today);
  const month = prettyLabel(brief.monthLabel) || 'este mes';
  let verdict = `${month} lleva el ${pct}% cobrado.`;
  if (liquidated <= 0) {
    verdict = `Todavía no hay liquidación de ${month} en el libro.`;
  } else if (due.phase === 'before' && pct >= 50) {
    verdict = `Vas a tiempo: más de la mitad cobrada y faltan ${due.daysUntil} días para el ${due.dueLabel}.`;
  } else if (due.phase === 'before' && pct < 40) {
    verdict = `El mes está corto: ${pct}% cobrado y el ${due.dueLabel} queda a ${due.daysUntil} días.`;
  } else if (due.phase === 'today' && pct < 80) {
    verdict = `Hoy vence. Falta cobrar ${formatGuideMoney(rest)} de ${formatGuideMoney(liquidated)}.`;
  } else if (due.phase === 'after' && pct < 80) {
    verdict = `El ${due.dueLabel} ya pasó. Sigue abierto ${formatGuideMoney(rest)}.`;
  } else if (pct >= 80) {
    verdict = `${month} está casi cerrado: ${pct}% cobrado.`;
  }
  return {
    collected,
    liquidated,
    rest,
    ratio,
    pct,
    due,
    month,
    verdict,
  };
}

function monthInsight(brief) {
  const reading = monthReading(brief);
  const text = [
    `${reading.month} liquidó ${formatGuideMoney(reading.liquidated)} y lleva recaudados ${formatGuideMoney(reading.collected)}.`,
    reading.rest > 0 ? `Falta ${formatGuideMoney(reading.rest)} (${100 - reading.pct}%).` : 'No queda saldo de liquidación.',
    reading.due.phase === 'before'
      ? `El vencimiento es el ${reading.due.dueLabel}.`
      : reading.due.phase === 'today'
        ? `Hoy es el vencimiento.`
        : `El vencimiento fue el ${reading.due.dueLabel}.`,
  ].join(' ');
  return {
    verdict: reading.verdict,
    text,
    figures: [
      { label: 'Recaudado', value: formatGuideMoney(reading.collected) },
      { label: 'Liquidado', value: formatGuideMoney(reading.liquidated) },
      { label: 'Falta', value: formatGuideMoney(reading.rest) },
      { label: 'Avance', value: `${reading.pct}%` },
    ],
    next: reading.rest > 0 ? 'En Cuotas está la lista para cobrar. El número grande no se repite: está arriba, una sola vez.' : 'El mes está cubierto. Revisá caja si hace falta el arqueo.',
    go: 'dues',
  };
}

function padronInsight(brief) {
  const activos = Number(brief.activos) || 0;
  const bien = Number(brief.bien) || 0;
  const fichas = Number(brief.fichas) || Math.max(0, activos - bien);
  const deudores = Number(brief.deudores) || 0;
  const pct = activos > 0 ? Math.round((bien / activos) * 100) : 0;
  return {
    verdict: activos
      ? `${pct} de cada 100 fichas activas están en orden.`
      : 'El padrón todavía se está leyendo.',
    text: [
      `Activos ${formatGuideCount(activos)}.`,
      `En orden ${formatGuideCount(bien)}.`,
      fichas ? `${formatGuideCount(fichas)} fichas piden corrección.` : 'No hay fichas marcadas para corregir.',
      deudores ? `${formatGuideCount(deudores)} titulares tienen saldo.` : '',
    ].filter(Boolean).join(' '),
    figures: [
      { label: 'Activos', value: formatGuideCount(activos) },
      { label: 'En orden', value: formatGuideCount(bien) },
      { label: 'A corregir', value: formatGuideCount(fichas) },
    ],
    next: fichas > 0 ? 'Abajo de esta mesa está la revisión. Abrí la lista y dejá una sola ficha por persona.' : 'El padrón está limpio. Si buscás a alguien, preguntame el número.',
    go: 'members',
  };
}

function doorInsight(brief) {
  const puerta = brief.porteriaHoy;
  const reservas = brief.reservasHoy;
  const pileta = brief.piletaHoy;
  const known = puerta != null || reservas != null || pileta != null;
  return {
    verdict: known
      ? `Hoy: ${formatGuideCount(puerta)} lecturas, ${formatGuideCount(reservas)} reservas y ${formatGuideCount(pileta)} pileta.`
      : 'La puerta se lee en Ingresos. El QR de sede es Acceso QR. La pileta, en su caja.',
    text: known
      ? `Portería anotó ${formatGuideCount(puerta)} ingresos. Hay ${formatGuideCount(reservas)} reservas. Pileta registró ${formatGuideCount(pileta)} pases. El molinete de sede es Acceso QR; la caja de pileta es otra pantalla.`
      : 'Preguntame de nuevo en un momento: Jev cruza portería, reservas y pileta del día cuando la sesión está viva.',
    figures: known
      ? [
        { label: 'Portería', value: formatGuideCount(puerta) },
        { label: 'Reservas', value: formatGuideCount(reservas) },
        { label: 'Pileta', value: formatGuideCount(pileta) },
      ]
      : [],
    next: 'Ingresos es el libro. Acceso QR es el molinete. Pileta abre la caja. Entrada pileta controla el ingreso.',
    go: 'access',
  };
}

function moraInsight(brief) {
  const reading = monthReading(brief);
  const deudores = Number(brief.deudores) || 0;
  return {
    verdict: deudores
      ? `${formatGuideCount(deudores)} socios con saldo. El mes todavía debe ${formatGuideMoney(reading.rest)}.`
      : `El mes todavía debe ${formatGuideMoney(reading.rest)}.`,
    text: `No invento una lista si no me pedís un número. El hueco de ${reading.month} es ${formatGuideMoney(reading.rest)} sobre ${formatGuideMoney(reading.liquidated)}. Conviene cobrar antes del ${reading.due.dueLabel}, no re-liquidar.`,
    figures: [
      { label: 'Con saldo', value: deudores ? formatGuideCount(deudores) : '—' },
      { label: 'Hueco del mes', value: formatGuideMoney(reading.rest) },
    ],
    next: 'En Cuotas exportás mora y abrís la ficha. WhatsApp sale desde el vencimiento, no desde acá.',
    go: 'dues',
  };
}

function priorityInsight(brief) {
  const reading = monthReading(brief);
  const fichas = Number(brief.fichas) || 0;
  const deudores = Number(brief.deudores) || 0;
  const picks = [];
  if (reading.liquidated > 0 && reading.pct < 70) {
    picks.push({
      score: reading.due.phase === 'after' ? 5 : 4,
      line: `Cobrar el hueco de ${reading.month}: ${formatGuideMoney(reading.rest)}.`,
      go: 'dues',
    });
  }
  if (fichas >= 200) {
    picks.push({
      score: 3,
      line: `Limpiar ${formatGuideCount(fichas)} fichas. El padrón sucio tuerce el número de socios.`,
      go: 'jev',
    });
  }
  if (deudores >= 100) {
    picks.push({
      score: 2,
      line: `${formatGuideCount(deudores)} titulares con saldo. Empezá por mora, no por el padrón entero.`,
      go: 'dues',
    });
  }
  if (!picks.length) {
    picks.push({
      score: 1,
      line: 'El mes y el padrón están ordenados. Revisá caja o la agenda de la semana.',
      go: 'dashboard',
    });
  }
  const ranked = picks.toSorted((a, b) => b.score - a.score);
  const top = ranked[0];
  return {
    verdict: top.line,
    text: ranked.map((item, index) => `${index + 1}. ${item.line}`).join(' '),
    figures: [
      { label: 'Avance', value: `${reading.pct}%` },
      { label: 'Fichas', value: formatGuideCount(fichas) },
      { label: 'Con saldo', value: deudores ? formatGuideCount(deudores) : '—' },
    ],
    next: 'Hago una cosa por vez. Decime si seguimos por plata, ficha, puerta o una sección.',
    go: top.go,
  };
}

function countInsight(brief, kind) {
  const map = {
    claims: {
      verdict: brief.reclamosAbiertos != null
        ? `${formatGuideCount(brief.reclamosAbiertos)} reclamos abiertos.`
        : 'Los reclamos viven en Comunicación.',
      text: 'En Reclamos se atienden quejas y pedidos. Lo abierto queda en el tablero de Inicio.',
      go: 'claims',
      label: 'Abiertos',
      value: brief.reclamosAbiertos,
    },
    messages: {
      verdict: brief.mensajes != null ? `${formatGuideCount(brief.mensajes)} mensajes en el libro.` : 'Mensajería es el correo del club.',
      text: 'En Mensajería hay Mail, MD y WhatsApp. Cada uno en su botón. La IA redacta el comunicado.',
      go: 'messaging',
      label: 'Mensajes',
      value: brief.mensajes,
    },
    events: {
      verdict: brief.fiestas != null ? `${formatGuideCount(brief.fiestas)} fiestas cargadas.` : 'Las fiestas se cargan en Club.',
      text: 'Fiestas no es la agenda de canchas. Las reservas del día están en Reservas.',
      go: 'events',
      label: 'Fiestas',
      value: brief.fiestas,
    },
    staff: {
      verdict: brief.personal != null ? `${formatGuideCount(brief.personal)} personas en el legajo.` : 'Personal es RR.HH., no el padrón.',
      text: 'Los socios están en Socios. Los docentes, en Profesores. Los usuarios del portal, en Usuarios y altas.',
      go: 'staff',
      label: 'Personal',
      value: brief.personal,
    },
    news: {
      verdict: brief.novedades != null ? `${formatGuideCount(brief.novedades)} notas en Revista.` : 'Revista es el CMS.',
      text: 'En el portal del socio se llama Novedades. Publicá con portada.',
      go: 'news',
      label: 'Notas',
      value: brief.novedades,
    },
    surveys: {
      verdict: brief.encuestas != null ? `${formatGuideCount(brief.encuestas)} encuestas.` : 'Las encuestas están en Comunicación.',
      text: 'Ahí se arman consultas al padrón y se leen las respuestas.',
      go: 'surveys',
      label: 'Encuestas',
      value: brief.encuestas,
    },
    alerts: {
      verdict: brief.alertas != null ? `${formatGuideCount(brief.alertas)} alertas vivas.` : 'Las alertas se acusan en Inicio.',
      text: 'Zonda, vencimientos y concesiones viven en Alertas.',
      go: 'alerts',
      label: 'Alertas',
      value: brief.alertas,
    },
    applications: {
      verdict: brief.altasPendientes != null
        ? `${formatGuideCount(brief.altasPendientes)} altas de padrón en espera.`
        : 'El alta pública está en /registro.',
      text: 'Las solicitudes de ingreso al padrón se ven en Inicio y en Usuarios y altas. El pedido de clave del portal es otra lista.',
      go: 'system',
      label: 'Altas',
      value: brief.altasPendientes,
    },
  };
  const row = map[kind];
  if (!row) return teachInsight(kind);
  return {
    verdict: row.verdict,
    text: row.text,
    figures: row.value != null ? [{ label: row.label, value: formatGuideCount(row.value) }] : [],
    next: `Entrá a ${row.go === 'system' ? 'Usuarios y altas' : row.go}.`,
    go: row.go,
  };
}

function teachInsight(query) {
  const folded = fold(query);
  if (/manual( de (la )?app)?$/.test(folded) || folded === 'manual' || /como se usa (la )?app/.test(folded)) {
    return manualOverview();
  }
  if (matchManualLessons(query).length) {
    return lessonInsight(query);
  }
  const topics = matchGuideTopics(query);
  const picked = topics.length ? topics.slice(0, 3) : ALL_GUIDE_TOPICS.filter((topic) => (
    ['inicio', 'cuotas', 'socios', 'reservas', 'ingresos', 'contabilidad'].includes(topic.id)
  ));
  const top = picked[0];
  return {
    verdict: top ? `Empezá por ${top.title}.` : 'El menú de la izquierda es el mapa.',
    text: picked.map((topic) => topic.teach).join(' '),
    figures: picked.map((topic) => ({ label: 'Sección', value: topic.title })),
    next: top ? `Entrá a ${top.title}. Si te trabás, preguntame el paso, no el menú entero.` : 'Preguntame una sección.',
    go: top?.tab || 'dashboard',
    focus: top?.focus || null,
  };
}

export function openingBriefing(brief = {}) {
  const reading = monthReading(brief);
  const bien = brief.bien;
  const activos = brief.activos;
  const hasMoney = brief.liquidated != null || brief.collected != null;
  if (!hasMoney && bien == null) {
    return {
      verdict: 'Estoy leyendo el libro.',
      text: 'Preguntame por un socio, el mes o cómo se hace algo. No invento un número que no esté en el club.',
      figures: [],
      next: null,
      go: null,
    };
  }
  return {
    verdict: reading.verdict,
    text: [
      prettyDay(brief.today) ? `Hoy ${prettyDay(brief.today)}.` : '',
      hasMoney ? `${reading.month} lleva ${formatGuideMoney(reading.collected)} de ${formatGuideMoney(reading.liquidated)}.` : '',
      bien != null ? `Padrón: ${formatGuideCount(bien)} fichas en orden de ${formatGuideCount(activos)} activos.` : '',
      'Preguntame un número de socio, qué conviene mirar, o abrí el Manual.',
    ].filter(Boolean).join(' '),
    figures: [
      hasMoney ? { label: 'Avance', value: `${reading.pct}%` } : null,
      hasMoney ? { label: 'Falta', value: formatGuideMoney(reading.rest) } : null,
      bien != null ? { label: 'En orden', value: formatGuideCount(bien) } : null,
    ].filter(Boolean),
    next: 'No escribo en el libro. El Manual de al lado tiene el oficio paso a paso.',
    go: null,
  };
}

/** Dictamen estructurado: veredicto, cifras y el paso siguiente. */
export function composeInsight(query = '', brief = {}) {
  const text = fold(query);
  if (!text) return openingBriefing(brief);
  if (/conviene|prioridad|mirar ahora|que hago|qué hago|urgente/.test(text)) {
    return priorityInsight(brief);
  }
  const askingHow = /manual|como se usa|ense[nñ]|donde esta|dónde está|como |cómo |abrir /.test(text);
  if (askingHow) return teachInsight(query);
  if (/puerta|porter|pileta|reserva/.test(text)) return doorInsight(brief);
  if (/reclamo|queja/.test(text)) return countInsight(brief, 'claims');
  if (/mensaje|mensaj/.test(text)) return countInsight(brief, 'messages');
  if (/fiesta|evento/.test(text)) return countInsight(brief, 'events');
  if (/personal|empleado|rrhh|legajo/.test(text)) return countInsight(brief, 'staff');
  if (/novedad|revista|nota/.test(text)) return countInsight(brief, 'news');
  if (/encuesta/.test(text)) return countInsight(brief, 'surveys');
  if (/alerta|zonda/.test(text)) return countInsight(brief, 'alerts');
  if (/alta de socio|solicitud|registro/.test(text)) return countInsight(brief, 'applications');
  if (/mora|debe|deud|saldo(?!s de liquid)/.test(text) && !/socio\s+\d/.test(text)) {
    return moraInsight(brief);
  }
  if (/recaud|cobra|liquid|este mes|octubre|noviembre|diciembre/.test(text)) {
    return monthInsight(brief);
  }
  if (/activo|padron|ficha/.test(text)) return padronInsight(brief);
  if (/socio|numero|número/.test(text)) {
    const topic = matchGuideTopics(query)[0];
    return {
      verdict: 'Para un socio necesito el número.',
      text: 'Escribí el número de socio. Te digo estado, saldo y vencimiento de esa ficha, no una lista inventada.',
      figures: [],
      next: 'El padrón se abre en Socios. El número es la llave.',
      go: topic?.tab || 'members',
    };
  }
  const teach = teachFromQuery(query);
  if (teach) {
    const insight = teachInsight(query);
    return { ...insight, text: teach };
  }
  return priorityInsight(brief);
}

/** Respuesta inmediata si no hace falta Gemini: cómo usar o un dato del brief. */
export function answerFromBrief(query = '', brief = {}) {
  const insight = composeInsight(query, brief);
  if (!insight) return null;
  return [insight.verdict, insight.text].filter(Boolean).join(' ');
}

export function parseJevReply(payload) {
  if (!payload) return null;
  if (payload.verdict || Array.isArray(payload.figures)) return payload;
  const raw = String(payload.text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const json = JSON.parse(raw.slice(start, end + 1));
      if (json && (json.text || json.verdict)) {
        return { ...json, source: payload.source };
      }
    } catch {
      /* prosa suelta */
    }
  }
  return { text: raw, source: payload.source, tab: payload.tab || null };
}

export function mergeJevReply(local, remote) {
  const parsed = parseJevReply(remote);
  const geminiText = String(parsed?.text || '').trim();
  const geminiLooksBroken = !geminiText || geminiText.startsWith('{') || geminiText.startsWith('```');
  const localTeach = Boolean(local?.text && /\b1\.\s/.test(local.text));
  const fromGemini = remote?.source === 'gemini' && geminiText && !geminiLooksBroken && !localTeach;
  return {
    verdict: parsed?.verdict && !String(parsed.verdict).startsWith('{')
      ? parsed.verdict
      : (local?.verdict || null),
    text: fromGemini ? geminiText : (local?.text || geminiText || ''),
    figures: local?.figures || parsed?.figures || [],
    next: parsed?.next || local?.next || null,
    go: parsed?.tab || parsed?.go || local?.go || null,
    focus: parsed?.focus || local?.focus || null,
    source: remote?.source || 'libro',
  };
}

export function guideForPrompt() {
  return `MANUAL DE USO (pasos concretos):
${manualForPrompt()}
Roles: ${APP_ROLES}
Empalme LILA: 1 de octubre de 2026. Octubre liquidó $ 63.233.000. Desde noviembre de 2026 las cuotas las liquida esta app.
Portal socio: / /reservas /cuenta /revista /perfil /registro
Profesor: /asistencia
Portería QR: /acceso · Pileta: /pileta · Entrada pileta: /entrada-pileta · Concesiones: /concesiones`;
}

function dayOf(value) {
  return String(value || '').slice(0, 10);
}

function isOpenClaim(claim) {
  return /open|pending|abierto|pendiente/i.test(String(claim?.status || ''));
}

function isLiveAlert(alert) {
  return alert?.isActive !== false;
}

function notCancelled(row) {
  return !/cancel/i.test(String(row?.status || ''));
}

export function buildJevBrief({
  today,
  monthLabel,
  collected,
  liquidated,
  counts = {},
  members = [],
  reservations = [],
  entryLogs = [],
  poolAccesses = [],
  claims = [],
  messages = [],
  surveys = [],
  staffMembers = [],
  events = [],
  alerts = [],
  applications = [],
  portalRequests = [],
  concessions = [],
} = {}) {
  const day = dayOf(today);
  const deudores = members.filter((member) => Number(member.outstandingBalance) > 0).length;
  return {
    today: day,
    monthLabel,
    collected,
    liquidated,
    activos: counts.activos,
    bien: counts.bien,
    fichas: counts.fichas,
    titulares: counts.titulares,
    grupos: counts.grupos,
    deudores,
    reservasHoy: reservations.filter((row) => dayOf(row.date || row.reservation_date) === day && notCancelled(row)).length,
    porteriaHoy: entryLogs.filter((row) => dayOf(row.date || row.logged_on || row.loggedOn) === day).length,
    piletaHoy: poolAccesses.filter((row) => dayOf(row.date || row.access_date || row.accessDate) === day).length,
    reclamosAbiertos: claims.filter(isOpenClaim).length,
    mensajes: messages.length,
    encuestas: surveys.length,
    personal: staffMembers.length,
    fiestas: events.length,
    alertas: alerts.filter(isLiveAlert).length,
    altasPendientes: applications.filter((row) => !/aprob|reject|rechaz|cerr/i.test(String(row.status || ''))).length,
    pedidosPortal: portalRequests.length,
    concesiones: concessions.length,
  };
}
