/** Concesiones del club: contratos, canon, vencimientos y alertas. */

import { buildPostedEntry } from '../accounting/journal';

export const CONCESSION_TYPES = {
  gastronomia: 'Gastronomía / Cantina',
  tienda: 'Tienda / Proshop',
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

const REQUIRED_DOC_TYPES = ['contrato', 'seguro', 'habilitacion'];

const SPACE_PORTAL_PREFIX = {
  'space-pavilion': 'PAV',
  'space-proshop': 'PRO',
  'space-parking-n': 'PKN',
  'space-equitacion': 'EQU',
  'space-cantina-pileta': 'CPL',
  'space-eventos': 'EVT',
};

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
  return d.toISOString().slice(0, 10);
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

function seedDocuments(docs) {
  return docs.map((doc, index) => ({
    id: doc.id || `doc-seed-${index + 1}`,
    type: doc.type,
    name: doc.name,
    uploadedAt: doc.uploadedAt || '2025-01-01T12:00:00.000Z',
    note: doc.note || '',
  }));
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

export const DEFAULT_CONCESSIONS = [
  {
    id: 'conc-1',
    name: 'Restaurante The Pavilion',
    type: 'gastronomia',
    concessionaire: 'Bodega & Catering Rivadavia',
    cuit: '30-55443322-9',
    contactName: 'Laura Mendoza',
    contactPhone: '+54 264 415-7788',
    contactEmail: 'eventos@cateringrivadavia.ar',
    location: 'Pabellón social · Sede Rivadavia',
    spaceId: 'space-pavilion',
    portalCode: 'PAV-8842',
    startDate: '2025-01-01',
    endDate: '2026-08-15',
    noticeDays: 45,
    monthlyFee: 850000,
    revenueSharePct: 8,
    deposit: 1500000,
    incomeAccountId: 'coa-4.1.04',
    statusManual: 'active',
    autoRenew: false,
    notes: 'Incluye cantina de pileta en temporada.',
    checklist: {
      contrato: true,
      seguro: true,
      habilitacion: true,
      deposito: true,
      llaves: true,
      inventario: false,
      baja_llaves: false,
      baja_deposito: false,
    },
    documents: seedDocuments([
      { id: 'doc-c1-contrato', type: 'contrato', name: 'Contrato Pavilion 2025-2026.pdf' },
      { id: 'doc-c1-seguro', type: 'seguro', name: 'Póliza RC Rivadavia.pdf' },
      { id: 'doc-c1-hab', type: 'habilitacion', name: 'Habilitación municipal 2025.pdf' },
    ]),
    renewalHistory: [],
    createdAt: '2025-01-01T12:00:00.000Z',
  },
  {
    id: 'conc-2',
    name: 'Proshop Tenis & Pádel',
    type: 'tienda',
    concessionaire: 'Sport Cuyo SA',
    cuit: '30-70112233-4',
    contactName: 'Martín Ríos',
    contactPhone: '+54 264 422-0099',
    contactEmail: 'proshop@sportcuyo.ar',
    location: 'Canchas de tenis · local anexo',
    spaceId: 'space-proshop',
    portalCode: 'PRO-3310',
    startDate: '2024-06-01',
    endDate: '2026-07-31',
    noticeDays: 30,
    monthlyFee: 220000,
    revenueSharePct: 5,
    deposit: 400000,
    incomeAccountId: 'coa-4.1.02',
    statusManual: 'active',
    autoRenew: true,
    notes: 'Venta de raquetas, pelotas y alquiler de material.',
    checklist: defaultChecklist(),
    documents: seedDocuments([
      { id: 'doc-c2-contrato', type: 'contrato', name: 'Contrato Proshop.pdf' },
      { id: 'doc-c2-seguro', type: 'seguro', name: 'Seguro Sport Cuyo.pdf' },
      { id: 'doc-c2-hab', type: 'habilitacion', name: 'Habilitación comercial.pdf' },
    ]),
    renewalHistory: [],
    createdAt: '2024-06-01T12:00:00.000Z',
  },
  {
    id: 'conc-3',
    name: 'Estacionamiento Norte',
    type: 'estacionamiento',
    concessionaire: 'Parking Rivadavia SRL',
    cuit: '30-60998877-2',
    contactName: 'Carlos Vega',
    contactPhone: '+54 264 430-5500',
    contactEmail: 'ops@parkingrivadavia.ar',
    location: 'Acceso norte · República del Líbano',
    spaceId: 'space-parking-n',
    portalCode: 'PKN-5521',
    startDate: '2023-03-01',
    endDate: '2026-06-30',
    noticeDays: 60,
    monthlyFee: 180000,
    revenueSharePct: 0,
    deposit: 300000,
    incomeAccountId: 'coa-4.1.04',
    statusManual: 'active',
    autoRenew: false,
    notes: 'Canon fijo mensual. Renovación en trámite.',
    checklist: defaultChecklist(),
    documents: seedDocuments([
      { id: 'doc-c3-contrato', type: 'contrato', name: 'Contrato estacionamiento.pdf' },
      { id: 'doc-c3-hab', type: 'habilitacion', name: 'Habilitación tránsito.pdf' },
    ]),
    renewalHistory: [],
    createdAt: '2023-03-01T12:00:00.000Z',
  },
  {
    id: 'conc-4',
    name: 'Clínica de Equitación externa',
    type: 'deportes',
    concessionaire: 'Escuela Cordillerana',
    cuit: '27-28445912-3',
    contactName: 'Ana Lucero',
    contactPhone: '+54 264 455-1212',
    contactEmail: 'info@escuelacordillerana.ar',
    location: 'Pistas de adiestramiento',
    spaceId: 'space-equitacion',
    portalCode: 'EQU-1198',
    startDate: '2025-09-01',
    endDate: '2026-12-31',
    noticeDays: 30,
    monthlyFee: 95000,
    revenueSharePct: 10,
    deposit: 150000,
    incomeAccountId: 'coa-4.1.02',
    statusManual: 'active',
    autoRenew: true,
    notes: 'Clases particulares fuera de horario de club.',
    checklist: defaultChecklist(),
    documents: [],
    renewalHistory: [],
    createdAt: '2025-09-01T12:00:00.000Z',
  },
];

export const DEFAULT_CANON_PAYMENTS = [
  {
    id: 'cp-1',
    concessionId: 'conc-1',
    amount: 850000,
    period: '2026-05',
    method: 'transfer',
    date: '2026-05-05',
    note: 'Canon mayo',
  },
  {
    id: 'cp-2',
    concessionId: 'conc-1',
    amount: 850000,
    period: '2026-06',
    method: 'transfer',
    date: '2026-06-05',
    note: 'Canon junio',
  },
  {
    id: 'cp-3',
    concessionId: 'conc-2',
    amount: 220000,
    period: '2026-06',
    method: 'cash',
    date: '2026-06-10',
    note: '',
  },
  {
    id: 'cp-4',
    concessionId: 'conc-2',
    amount: 220000,
    period: '2026-07',
    method: 'transfer',
    date: '2026-07-08',
    note: 'Julio',
  },
];

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

export function createCanonPayment({ concessionId, amount, period, method, date, note }) {
  if (!concessionId) throw new Error('Indicá la concesión.');
  if (!period) throw new Error('Indicá el período (YYYY-MM).');

  return {
    id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    concessionId,
    amount: Number(amount) || 0,
    period: String(period),
    method: method || 'transfer',
    date: date || toISODate(new Date()),
    note: String(note || '').trim(),
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
