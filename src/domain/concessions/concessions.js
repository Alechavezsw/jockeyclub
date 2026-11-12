/** Concesiones del club: contratos, canon, vencimientos y alertas. */

import { buildPostedEntry } from '../accounting/journal';
import { todayAR } from '../../lib/arDate';


export const CONCESSION_TYPES = {
  gastronomia: 'Gastronomía / Cantina',
  tienda: 'Tienda / Proveeduría / Proshop',
  estacionamiento: 'Estacionamiento',
  eventos: 'Eventos / Catering',
  deportes: 'Servicios deportivos',
  mantenimiento: 'Mantenimiento tercerizado',
  otro: 'Otra concesión',
};

export const CONCESSION_STATUS = {
  active: 'Vigente',
  expiring: 'Por vencer',
  expired: 'Vencida',
  suspended: 'Suspendida',
  draft: 'Borrador',
};

export const CONCESSION_SPACES = [
  { id: 'space-kelita', name: 'La Kelita', area: 'Gastronomía' },
  { id: 'space-paddle', name: 'Paddle', area: 'Deportes' },
  { id: 'space-santa-teresita', name: 'Escuela Santa Teresita', area: 'Educación' },
  { id: 'space-fanzolato', name: 'Escuela Fanzolato', area: 'Educación' },
  { id: 'space-pavilion', name: 'Pabellón social / Restaurante', area: 'Social' },
  { id: 'space-proshop', name: 'Local Proshop tenis/pádel', area: 'Deportes' },
  { id: 'space-parking-n', name: 'Estacionamiento Norte', area: 'Accesos' },
  { id: 'space-equitacion', name: 'Pistas de adiestramiento', area: 'Hípica' },
  { id: 'space-cantina-pileta', name: 'Cantina de pileta', area: 'Natación' },
  { id: 'space-eventos', name: 'Salón de eventos', area: 'Social' },
];

export const CHECKLIST_ITEMS = [
  { id: 'contrato', label: 'Contrato firmado' },
  { id: 'seguro', label: 'Seguro de responsabilidad civil' },
  { id: 'habilitacion', label: 'Habilitación municipal' },
  { id: 'deposito', label: 'Depósito / garantía abonado' },
  { id: 'llaves', label: 'Entrega de llaves / accesos' },
  { id: 'inventario', label: 'Inventario de bienes firmado' },
  { id: 'baja_llaves', label: 'Devolución de llaves (baja)', phase: 'exit' },
  { id: 'baja_deposito', label: 'Devolución de depósito (baja)', phase: 'exit' },
];

export const DOC_TYPES = {
  contrato: 'Contrato',
  seguro: 'Seguro',
  habilitacion: 'Habilitación',
  anexo: 'Anexo',
  otro: 'Otro',
};

/** Documentos obligatorios del alta (se suben por pasos). */
export const REQUIRED_DOC_TYPES = ['contrato', 'seguro', 'habilitacion'];

export const ONBOARDING_STEPS = [
  { id: 'datos', label: 'Datos', description: 'Nombre, tipo, espacio y concesionario' },
  { id: 'vigencia', label: 'Vigencia y canon', description: 'Fechas, canon y depósito' },
  { id: 'documentos', label: 'Documentos', description: 'Contrato, seguro y habilitación' },
  { id: 'cierre', label: 'Cierre', description: 'Checklist operativo y portal' },
];

const SPACE_PORTAL_PREFIX = {
  'space-kelita': 'KEL',
  'space-paddle': 'PAD',
  'space-santa-teresita': 'TER',
  'space-fanzolato': 'FAN',
  'space-pavilion': 'PAV',
  'space-proshop': 'PRO',
  'space-parking-n': 'PKN',
  'space-equitacion': 'EQU',
  'space-cantina-pileta': 'CPL',
  'space-eventos': 'EVT',
};

function concessionNameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DAY_MS = 86400000;

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  }
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  return todayAR(d);
}

function generatePortalCode(spaceId) {
  const prefix = SPACE_PORTAL_PREFIX[spaceId] || 'CON';
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

function iterMonths(fromDate, toDate) {
  const start = parseDate(fromDate);
  const end = parseDate(toDate);
  if (!start || !end) return [];

  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cur <= last) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function defaultChecklist() {
  const checklist = {};
  for (const item of CHECKLIST_ITEMS) {
    checklist[item.id] = false;
  }
  return checklist;
}

export function setChecklistItem(concession, itemId, done) {
  return {
    ...concession,
    checklist: {
      ...(concession.checklist || defaultChecklist()),
      [itemId]: Boolean(done),
    },
  };
}

export function checklistProgress(concession) {
  const checklist = concession.checklist || defaultChecklist();
  const entryItems = CHECKLIST_ITEMS.filter((i) => i.phase !== 'exit');
  const exitItems = CHECKLIST_ITEMS.filter((i) => i.phase === 'exit');
  const countDone = (items) => items.filter((i) => checklist[i.id]).length;
  const done = CHECKLIST_ITEMS.filter((i) => checklist[i.id]).length;

  return {
    entry: { total: entryItems.length, done: countDone(entryItems) },
    exit: { total: exitItems.length, done: countDone(exitItems) },
    total: CHECKLIST_ITEMS.length,
    done,
    pct: CHECKLIST_ITEMS.length ? Math.round((done / CHECKLIST_ITEMS.length) * 100) : 0,
  };
}

export function addConcessionDocument(concession, doc) {
  if (!doc?.type || !DOC_TYPES[doc.type]) {
    throw new Error('Tipo de documento inválido.');
  }
  const entry = {
    id: doc.id || `doc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    type: doc.type,
    name: String(doc.name || '').trim(),
    uploadedAt: doc.uploadedAt || new Date().toISOString(),
    note: String(doc.note || '').trim(),
    url: doc.url || '',
    path: doc.path || '',
    mimeType: doc.mimeType || '',
    size: doc.size || 0,
  };
  return {
    ...concession,
    documents: [...(concession.documents || []), entry],
  };
}

export function removeConcessionDocument(concession, docId) {
  return {
    ...concession,
    documents: (concession.documents || []).filter((d) => d.id !== docId),
  };
}

export function missingRequiredDocuments(concession) {
  const types = new Set((concession.documents || []).map((d) => d.type));
  return REQUIRED_DOC_TYPES.filter((t) => !types.has(t));
}

function clubConcessionSeed({
  id,
  name,
  type,
  concessionaire,
  spaceId,
  portalCode,
  location,
}) {
  return {
    id,
    name,
    type,
    concessionaire,
    cuit: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    location,
    spaceId,
    portalCode,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    noticeDays: 30,
    monthlyFee: 0,
    revenueSharePct: 0,
    deposit: 0,
    incomeAccountId: 'coa-4.1.04',
    statusManual: 'active',
    autoRenew: true,
    notes: 'Canon mensual: se carga al cobrar (fecha, hora y quién lo registró quedan en trazabilidad y caja).',
    checklist: defaultChecklist(),
    documents: [],
    renewalHistory: [],
    seedKey: concessionNameKey(name),
    createdAt: '2026-01-01T12:00:00.000Z',
  };
}

/** Locales reales del club: siempre precargados. */
export const DEFAULT_CONCESSIONS = [
  clubConcessionSeed({
    id: 'conc-kelita',
    name: 'La Kelita',
    type: 'gastronomia',
    concessionaire: 'La Kelita',
    spaceId: 'space-kelita',
    portalCode: 'KEL-1001',
    location: 'La Kelita · Sede Rivadavia',
  }),
  clubConcessionSeed({
    id: 'conc-paddle',
    name: 'Paddle',
    type: 'deportes',
    concessionaire: 'Paddle',
    spaceId: 'space-paddle',
    portalCode: 'PAD-1002',
    location: 'Canchas de pádel',
  }),
  clubConcessionSeed({
    id: 'conc-santa-teresita',
    name: 'Escuela Santa Teresita',
    type: 'otro',
    concessionaire: 'Escuela Santa Teresita',
    spaceId: 'space-santa-teresita',
    portalCode: 'TER-1003',
    location: 'Escuela Santa Teresita',
  }),
  clubConcessionSeed({
    id: 'conc-fanzolato',
    name: 'Escuela Fanzolato',
    type: 'otro',
    concessionaire: 'Escuela Fanzolato',
    spaceId: 'space-fanzolato',
    portalCode: 'FAN-1004',
    location: 'Escuela Fanzolato',
  }),
];

export const DEFAULT_CANON_PAYMENTS = [];

/** Completa el padrón de concesiones con los locales del club si faltan. */
export function ensureClubConcessions(list = []) {
  const present = new Set(
    (list || []).map((row) => concessionNameKey(row?.name || row?.concessionaire)),
  );
  const missing = DEFAULT_CONCESSIONS.filter((seed) => !present.has(concessionNameKey(seed.name)));
  if (!missing.length) return Array.isArray(list) ? list : [];
  return [...(list || []), ...missing];
}

/**
 * Estado operativo según fechas (y suspensión manual).
 * @returns {{ status: string, daysLeft: number|null, label: string }}
 */
export function getConcessionExpiryStatus(concession, { today = new Date(), warnWithinDays } = {}) {
  if (!concession) {
    return { status: 'draft', daysLeft: null, label: CONCESSION_STATUS.draft };
  }
  if (concession.statusManual === 'suspended') {
    return { status: 'suspended', daysLeft: null, label: CONCESSION_STATUS.suspended };
  }
  if (concession.statusManual === 'draft') {
    return { status: 'draft', daysLeft: null, label: CONCESSION_STATUS.draft };
  }

  const end = parseDate(concession.endDate);
  if (!end) {
    return { status: 'active', daysLeft: null, label: CONCESSION_STATUS.active };
  }

  const todayStart = new Date(today);
  todayStart.setHours(12, 0, 0, 0);
  const daysLeft = Math.ceil((end - todayStart) / DAY_MS);
  const warn = warnWithinDays != null
    ? warnWithinDays
    : Number(concession.noticeDays) || 30;

  if (daysLeft < 0) {
    return { status: 'expired', daysLeft, label: CONCESSION_STATUS.expired };
  }
  if (daysLeft <= warn) {
    return { status: 'expiring', daysLeft, label: CONCESSION_STATUS.expiring };
  }
  return { status: 'active', daysLeft, label: CONCESSION_STATUS.active };
}

export function summarizeConcessions(concessions = [], today = new Date()) {
  const rows = concessions.map((c) => ({
    ...c,
    expiry: getConcessionExpiryStatus(c, { today }),
  }));
  const monthlyCanon = rows
    .filter((c) => c.expiry.status === 'active' || c.expiry.status === 'expiring')
    .reduce((s, c) => s + (Number(c.monthlyFee) || 0), 0);

  return {
    rows: rows.sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || ''))),
    totals: {
      total: rows.length,
      active: rows.filter((r) => r.expiry.status === 'active').length,
      expiring: rows.filter((r) => r.expiry.status === 'expiring').length,
      expired: rows.filter((r) => r.expiry.status === 'expired').length,
      suspended: rows.filter((r) => r.expiry.status === 'suspended').length,
      monthlyCanon,
    },
  };
}

export function findSpaceOverlap(concessions, { spaceId, startDate, endDate, excludeId }) {
  if (!spaceId) return null;
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;

  for (const conc of concessions || []) {
    if (excludeId && conc.id === excludeId) continue;
    if (conc.spaceId !== spaceId) continue;
    if (conc.statusManual === 'draft') continue;

    const cStart = parseDate(conc.startDate);
    const cEnd = parseDate(conc.endDate);
    if (!cStart || !cEnd) continue;

    if (start <= cEnd && cStart <= end) {
      return conc;
    }
  }
  return null;
}

export function findConcessionByPortalCode(concessions, code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  return (concessions || []).find(
    (c) => String(c.portalCode || '').toUpperCase() === normalized
  ) || null;
}

export function createConcession(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Indicá el nombre de la concesión.');
  if (!input.endDate) throw new Error('Indicá la fecha de vencimiento.');
  if (!input.concessionaire?.trim()) throw new Error('Indicá el concesionario.');

  const spaceId = input.spaceId || null;

  return {
    id: `conc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    type: CONCESSION_TYPES[input.type] ? input.type : 'otro',
    concessionaire: String(input.concessionaire || '').trim(),
    concessionaireNumber: String(input.concessionaireNumber || '').trim(),
    cuit: String(input.cuit || '').trim(),
    contactName: String(input.contactName || '').trim(),
    contactPhone: String(input.contactPhone || '').trim(),
    contactEmail: String(input.contactEmail || '').trim(),
    location: String(input.location || '').trim(),
    spaceId,
    portalCode: input.portalCode || generatePortalCode(spaceId),
    startDate: input.startDate || toISODate(new Date()),
    endDate: input.endDate,
    noticeDays: Number(input.noticeDays) || 30,
    monthlyFee: Number(input.monthlyFee) || 0,
    revenueSharePct: Number(input.revenueSharePct) || 0,
    deposit: Number(input.deposit) || 0,
    incomeAccountId: input.incomeAccountId || 'coa-4.1.04',
    statusManual: input.statusManual || 'active',
    autoRenew: Boolean(input.autoRenew),
    notes: String(input.notes || '').trim(),
    checklist: input.checklist || defaultChecklist(),
    documents: input.documents || [],
    renewalHistory: input.renewalHistory || [],
    createdAt: new Date().toISOString(),
  };
}

export function upsertConcession(list, concession) {
  const next = concession.id
    ? { ...concession }
    : createConcession(concession);
  if (!next.id) next.id = createConcession(next).id;
  const idx = (list || []).findIndex((c) => c.id === next.id);
  if (idx < 0) return [next, ...(list || [])];
  const copy = [...list];
  copy[idx] = { ...copy[idx], ...next, updatedAt: new Date().toISOString() };
  return copy;
}

export function renewConcession(concession, { months = 12, today = new Date(), monthlyFee, renewedBy } = {}) {
  const base = parseDate(concession.endDate) || today;
  const start = base < today ? today : base;
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);

  const previousEndDate = concession.endDate;
  const newEndDate = toISODate(end);
  const previousFee = Number(concession.monthlyFee) || 0;
  const newFee = monthlyFee != null ? Number(monthlyFee) : previousFee;

  const historyEntry = {
    id: `renew-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    previousEndDate,
    newEndDate,
    previousFee,
    newFee,
    months,
    renewedBy: renewedBy || null,
  };

  return {
    ...concession,
    startDate: toISODate(start),
    endDate: newEndDate,
    monthlyFee: newFee,
    statusManual: 'active',
    renewedAt: new Date().toISOString(),
    renewalHistory: [...(concession.renewalHistory || []), historyEntry],
  };
}

export function createCanonPayment({
  concessionId,
  amount,
  period,
  method,
  date,
  note,
  recordedBy = null,
  recordedByName = null,
  recordedAt = null,
} = {}) {
  if (!concessionId) throw new Error('Indicá la concesión.');
  if (!period) throw new Error('Indicá el período (YYYY-MM).');
  const now = new Date();
  const paidOn = date || toISODate(now);
  const when = recordedAt || now.toISOString();

  return {
    id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    concessionId,
    amount: Number(amount) || 0,
    period: String(period),
    method: method || 'transfer',
    date: paidOn,
    note: String(note || '').trim(),
    recordedBy: recordedBy || null,
    recordedByName: String(recordedByName || '').trim() || null,
    recordedAt: when,
    concept: `Canon concesión · ${String(period)}`,
  };
}

export function getCanonDebt(concession, payments = [], { today = new Date() } = {}) {
  const todayDate = parseDate(toISODate(today)) || today;
  const endLimit = parseDate(concession.endDate);
  const effectiveEnd = endLimit && endLimit < todayDate ? endLimit : todayDate;

  const expectedMonths = iterMonths(concession.startDate, effectiveEnd);
  const concessionPayments = (payments || []).filter((p) => p.concessionId === concession.id);
  const paidPeriods = new Set(concessionPayments.map((p) => p.period));

  const paidMonths = expectedMonths.filter((m) => paidPeriods.has(m));
  const unpaidMonths = expectedMonths.filter((m) => !paidPeriods.has(m));
  const monthlyFee = Number(concession.monthlyFee) || 0;

  return {
    expectedMonths,
    paidMonths,
    unpaidMonths,
    totalDebt: unpaidMonths.length * monthlyFee,
    monthlyFee,
  };
}

export function buildCanonJournalEntry(payment, concession, chart) {
  const amount = Number(payment.amount) || 0;
  const incomeAccount = concession.incomeAccountId || 'coa-4.1.04';

  return buildPostedEntry({
    date: payment.date || toISODate(new Date()),
    description: `Canon concesión ${concession.name} · ${payment.period}`,
    lines: [
      { accountId: 'coa-1.1.01', debit: amount, credit: 0, memo: 'Caja General' },
      { accountId: incomeAccount, debit: 0, credit: amount, memo: concession.name },
    ],
    sourceModule: 'concessions',
    sourceId: payment.id,
    chart,
  });
}

export function buildExpiryCalendar(concessions, { year, month }) {
  const events = [];

  for (const conc of concessions || []) {
    const end = parseDate(conc.endDate);
    if (!end) continue;
    if (end.getFullYear() !== year || end.getMonth() !== month) continue;

    events.push({
      id: `cal-${conc.id}`,
      concessionId: conc.id,
      name: conc.name,
      concessionaire: conc.concessionaire,
      date: conc.endDate,
      type: 'expiry',
      spaceId: conc.spaceId || null,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function exportConcessionsCsv(concessions) {
  const headers = [
    'ID',
    'Nombre',
    'Tipo',
    'Concesionario',
    'Espacio',
    'Portal',
    'Inicio',
    'Vencimiento',
    'Canon mensual',
    'Estado',
  ];

  const rows = (concessions || []).map((c) => {
    const space = CONCESSION_SPACES.find((s) => s.id === c.spaceId);
    const expiry = getConcessionExpiryStatus(c);
    return [
      c.id,
      c.name,
      CONCESSION_TYPES[c.type] || c.type,
      c.concessionaire,
      space?.name || c.location || '',
      c.portalCode || '',
      c.startDate,
      c.endDate,
      c.monthlyFee,
      expiry.label,
    ].map(escapeCsv).join(',');
  });

  return `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
}

export function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Sincroniza alertas automáticas de vencimiento y documentación de concesiones.
 */
export function syncConcessionAlerts(alerts = [], concessions = [], today = new Date()) {
  const withoutAuto = alerts.filter(
    (a) => a.source !== 'concession_expiry' && a.source !== 'concession_docs'
  );
  const generated = [];

  for (const conc of concessions || []) {
    const expiry = getConcessionExpiryStatus(conc, { today });
    if (expiry.status === 'expiring' || expiry.status === 'expired') {
      const severity = expiry.status === 'expired' ? 'critical' : 'warning';
      const daysText = expiry.daysLeft == null
        ? ''
        : expiry.daysLeft < 0
          ? `vencida hace ${Math.abs(expiry.daysLeft)} día(s)`
          : `vence en ${expiry.daysLeft} día(s) (${conc.endDate})`;

      generated.push({
        id: `alert-conc-${conc.id}`,
        code: `CONC-${conc.id}`,
        title: expiry.status === 'expired'
          ? `Concesión vencida · ${conc.name}`
          : `Concesión por vencer · ${conc.name}`,
        body: `${conc.concessionaire} · ${daysText}. Canon mensual $${Number(conc.monthlyFee || 0).toLocaleString('es-AR')}. Revisar renovación.`,
        severity,
        audience: 'admin',
        source: 'concession_expiry',
        startsAt: new Date().toISOString(),
        endsAt: null,
        isActive: true,
        requiresAck: expiry.status === 'expired',
        metadata: {
          concessionId: conc.id,
          endDate: conc.endDate,
          daysLeft: expiry.daysLeft,
          status: expiry.status,
        },
        createdBy: 'system',
        createdAt: new Date().toISOString(),
      });
    }

    const missingDocs = missingRequiredDocuments(conc);
    if (missingDocs.length > 0) {
      generated.push({
        id: `alert-conc-docs-${conc.id}`,
        code: `CONC-DOC-${conc.id}`,
        title: `Documentación incompleta · ${conc.name}`,
        body: `${conc.concessionaire} · Faltan: ${missingDocs.map((t) => DOC_TYPES[t] || t).join(', ')}.`,
        severity: 'warning',
        audience: 'admin',
        source: 'concession_docs',
        startsAt: new Date().toISOString(),
        endsAt: null,
        isActive: true,
        requiresAck: false,
        metadata: {
          concessionId: conc.id,
          missingDocs,
        },
        createdBy: 'system',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return [...generated, ...withoutAuto];
}

/**
 * Sincroniza alertas automáticas de vencimiento de concesiones.
 * Fuente: `concession_expiry`. Alias de syncConcessionAlerts (retrocompat).
 */
export function syncConcessionExpiryAlerts(alerts = [], concessions = [], today = new Date()) {
  return syncConcessionAlerts(alerts, concessions, today);
}
