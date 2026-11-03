/**
 * Listados mensuales de débitos (planilla Argencard / Visa / Visa Débito).
 * Columnas alineadas a docs/Debitos/Listados de Debitos 2026.xlsx
 */

export const DEBIT_LISTING_SHEETS = Object.freeze({
  credito: { id: 'credito', label: 'Crédito' },
  debito: { id: 'debito', label: 'Débito' },
});

export const DEBIT_LISTING_SECTIONS = Object.freeze({
  padron: { id: 'padron', label: 'Padrón' },
  altas: { id: 'altas', label: 'Altas de tarjetas' },
  bajas: { id: 'bajas', label: 'Bajas de tarjetas' },
  cambios: { id: 'cambios', label: 'Cambios de tarjetas' },
  debitos_aplicacion: { id: 'debitos_aplicacion', label: 'Débitos para aplicación' },
});

/** Marcas de planilla: Argencard / Visa / Visa Débito. */
export const DEBIT_LISTING_BRANDS = Object.freeze([
  { id: 'ARGENCARD', label: 'Argencard', sheetKind: 'credito' },
  { id: 'VISA', label: 'Visa', sheetKind: 'credito' },
  { id: 'VISA DEBITO', label: 'Visa Débito', sheetKind: 'debito' },
]);

const BRAND_HEADERS = new Set([
  'ARGENCARD',
  'VISA',
  'VISA DEBITO',
  'VISA DÉBITO',
]);

export function normalizeDebitBrand(value) {
  const folded = fold(value).replace('DÉBITO', 'DEBITO');
  if (folded === 'VISA DEBITO') return 'VISA DEBITO';
  if (folded === 'VISA') return 'VISA';
  if (folded === 'ARGENCARD') return 'ARGENCARD';
  return '';
}

export function sheetKindForBrand(brand) {
  return normalizeDebitBrand(brand) === 'VISA DEBITO' ? 'debito' : 'credito';
}

export function defaultBrandForSheetKind(sheetKind) {
  return sheetKind === 'debito' ? 'VISA DEBITO' : 'ARGENCARD';
}

/** Catálogo de marcas: las de la planilla + las que ya hay en filas cargadas. */
export function collectDebitBrands(rows = []) {
  const byId = new Map(DEBIT_LISTING_BRANDS.map((b) => [b.id, b]));
  for (const row of rows || []) {
    const id = normalizeDebitBrand(row?.brand);
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, label: id, sheetKind: sheetKindForBrand(id) });
  }
  return [...byId.values()];
}

const SECTION_HEADERS = Object.freeze({
  'ALTAS DE TARJETAS': 'altas',
  'BAJAS DE TARJETAS': 'bajas',
  'CAMBIOS DE TARJETAS': 'cambios',
  'DEBITOS PARA APLICACIÓN': 'debitos_aplicacion',
  'DEBITOS PARA APLICACION': 'debitos_aplicacion',
  'DÉBITOS PARA APLICACIÓN': 'debitos_aplicacion',
});

const MONTH_NAMES = Object.freeze({
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
});

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function money(value) {
  if (value === '' || value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Excel serial → ISO date (UTC noon). */
export function excelSerialToISODate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const utc = new Date(ms);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function maskDebitCard(card) {
  const digits = String(card || '').replace(/\D/g, '');
  if (digits.length < 4) return digits || '—';
  return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/** Solo dígitos; vacío → null. */
export function normalizeDebitCard(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

export function isValidDebitCard(value) {
  const digits = normalizeDebitCard(value);
  if (!digits) return false;
  return digits.length >= 13 && digits.length <= 19;
}

/**
 * Aplica un cambio de tarjeta sobre la fila (puro).
 * Devuelve null si no hay cambio real.
 */
export function applyDebitCardEdit(row, nextCard, { at = new Date().toISOString(), by = '' } = {}) {
  if (!row) throw new Error('Falta la fila del listado.');
  const previous = normalizeDebitCard(row.cardNumber);
  const next = normalizeDebitCard(nextCard);
  if (!next) throw new Error('Ingresá el N° de tarjeta (solo dígitos).');
  if (!isValidDebitCard(next)) throw new Error('La tarjeta debe tener entre 13 y 19 dígitos.');
  if (previous === next) return null;

  const edit = {
    at: String(at).slice(0, 19),
    by: String(by || '').trim() || null,
    from: previous,
    to: next,
  };
  const edits = [...(Array.isArray(row.cardEdits) ? row.cardEdits : []), edit];
  const stamp = `CAMBIO TARJETA ${maskDebitCard(previous)} → ${maskDebitCard(next)}`;
  const prevNote = String(row.note || '').trim();
  const note = prevNote && !prevNote.includes(stamp)
    ? `${prevNote} · ${stamp}`
    : (prevNote || stamp);

  return {
    ...row,
    cardNumber: next,
    cardEdits: edits,
    note,
  };
}

export function parseDebitListingSheetName(name = '') {
  const raw = String(name || '').trim();
  const folded = fold(raw);
  const sheetKind = /\bDEBITO\b/.test(folded) ? 'debito' : 'credito';
  let year = null;
  let month = null;
  const yearMatch = folded.match(/\b(20\d{2})\b/);
  if (yearMatch) year = Number(yearMatch[1]);
  for (const [label, num] of Object.entries(MONTH_NAMES)) {
    if (folded.includes(fold(label))) {
      month = num;
      break;
    }
  }
  return { sheetKind, year, month, sourceSheet: raw };
}

function isHeaderRow(cell) {
  return /^N[°º]?\s*TARJETA$/i.test(String(cell || '').trim());
}

function isBrandHeader(cell) {
  return BRAND_HEADERS.has(fold(cell));
}

function sectionFromHeader(cell) {
  return SECTION_HEADERS[fold(cell)] || null;
}

/**
 * Parsea una hoja de la planilla a filas normalizadas.
 * @param {unknown[][]} matrix filas crudas (sheet_to_json header:1)
 * @param {{ year?: number, month?: number, sheetKind?: string, sourceSheet?: string }} meta
 */
export function parseDebitListingMatrix(matrix = [], meta = {}) {
  const sheetKind = meta.sheetKind || 'credito';
  const year = Number(meta.year) || 0;
  const month = Number(meta.month) || 0;
  const sourceSheet = meta.sourceSheet || '';
  let brand = sheetKind === 'debito' ? 'VISA DEBITO' : 'ARGENCARD';
  let section = 'padron';
  let sortOrder = 0;
  const rows = [];

  for (const raw of matrix || []) {
    const cells = Array.isArray(raw) ? raw : [];
    const c1 = String(cells[1] ?? '').trim();
    const c2 = cells[2];
    const socio = cells[7];
    const cardRaw = String(cells[1] ?? '').replace(/\D/g, '');

    if (!c1 && (c2 === '' || c2 == null) && (socio === '' || socio == null)) {
      // Subtotal u hoja vacía
      continue;
    }
    if (/^MES:/i.test(c1)) continue;
    if (isHeaderRow(c1)) continue;

    if (isBrandHeader(c1) && !cardRaw && (socio === '' || socio == null)) {
      brand = fold(c1).replace('DÉBITO', 'DEBITO');
      if (brand === 'VISA DEBITO') brand = 'VISA DEBITO';
      section = 'padron';
      continue;
    }

    const sectionId = sectionFromHeader(c1);
    if (sectionId && !cardRaw && (socio === '' || socio == null)) {
      section = sectionId;
      continue;
    }

    if (cardRaw.length < 14 && (socio === '' || socio == null || Number(socio) === 0)) {
      continue;
    }

    sortOrder += 1;
    const memberId = socio === '' || socio == null ? '' : String(socio).replace(/\D/g, '');
    const dueDate = excelSerialToISODate(cells[3]);
    const dues = money(cells[4]);
    const abono = money(cells[5]);
    const total = money(cells[6]) || (dues + abono);
    const statusCode = String(cells[8] ?? '').trim().toUpperCase() || null;
    const holderName = String(cells[9] ?? '').replace(/\s+/g, ' ').trim();
    const note = String(cells[10] ?? '').replace(/\s+/g, ' ').trim();
    const receipt = cells[2] === '' || cells[2] == null ? '' : String(cells[2]).trim();

    rows.push({
      id: `dl-${year}${String(month).padStart(2, '0')}-${sheetKind}-${sortOrder}`,
      year,
      month,
      sheetKind,
      brand,
      section,
      sortOrder,
      cardNumber: cardRaw || null,
      receipt: receipt || null,
      dueDate,
      duesAmount: dues,
      abonoAmount: abono,
      totalAmount: total,
      memberId: memberId || null,
      statusCode,
      holderName,
      note,
      sourceSheet,
    });
  }

  return rows;
}

export function summarizeDebitListings(rows = []) {
  const list = rows || [];
  const sum = (pred) => list.filter(pred).reduce((acc, row) => acc + (Number(row.totalAmount) || 0), 0);
  return {
    total: list.length,
    amount: list.reduce((acc, row) => acc + (Number(row.totalAmount) || 0), 0),
    altas: list.filter((row) => row.section === 'altas').length,
    bajas: list.filter((row) => row.section === 'bajas').length,
    cambios: list.filter((row) => row.section === 'cambios').length,
    padron: list.filter((row) => row.section === 'padron').length,
    amountAltas: sum((row) => row.section === 'altas'),
    amountBajas: sum((row) => row.section === 'bajas'),
  };
}

export function groupDebitListings(rows = []) {
  const groups = [];
  let current = null;
  for (const row of rows || []) {
    const key = `${row.brand}::${row.section}`;
    if (!current || current.key !== key) {
      current = {
        key,
        brand: row.brand,
        section: row.section,
        sectionLabel: DEBIT_LISTING_SECTIONS[row.section]?.label || row.section,
        rows: [],
      };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

export function filterDebitListings(rows = [], { query = '', section = 'all', brand = 'all' } = {}) {
  const q = fold(query).toLowerCase();
  return (rows || []).filter((row) => {
    if (section && section !== 'all' && row.section !== section) return false;
    if (brand && brand !== 'all' && fold(row.brand) !== fold(brand)) return false;
    if (!q) return true;
    const hay = fold([
      row.holderName,
      row.memberId,
      row.cardNumber,
      row.note,
      row.brand,
      row.receipt,
    ].join(' ')).toLowerCase();
    return hay.includes(q);
  });
}

function shiftYearMonth(year, month, deltaMonths) {
  const idx = Number(year) * 12 + (Number(month) - 1) + Number(deltaMonths);
  return {
    year: Math.floor(idx / 12),
    month: (idx % 12) + 1,
  };
}

export function previousDebitListingPeriod(year, month) {
  const prev = shiftYearMonth(year, month, -1);
  return {
    ...prev,
    key: `${prev.year}-${String(prev.month).padStart(2, '0')}`,
  };
}

/**
 * Copia filas de un mes hacia otro (misma planilla, nuevo período).
 * Altas/cambios del mes anterior pasan a padrón; las bajas no se copian.
 */
export function remapDebitListingsToPeriod(rows = [], { year, month } = {}) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new Error('Falta el período destino.');
  const receipt = `${m}${y}`;
  const dueDate = `${y}-${String(m).padStart(2, '0')}-10`;
  const carried = (rows || []).filter((row) => {
    const section = String(row?.section || 'padron');
    return section !== 'bajas';
  });
  return carried.map((row, index) => {
    const sheetKind = row.sheetKind === 'debito' ? 'debito' : 'credito';
    const sortOrder = Number(row.sortOrder) || index + 1;
    const prevSection = String(row.section || 'padron');
    // Altas y cambios del mes anterior ya forman parte del padrón vigente.
    const section = (prevSection === 'altas' || prevSection === 'cambios')
      ? 'padron'
      : (prevSection === 'debitos_aplicacion' ? 'debitos_aplicacion' : 'padron');
    return {
      ...row,
      id: `dl-${y}${String(m).padStart(2, '0')}-${sheetKind}-${sortOrder}`,
      year: y,
      month: m,
      sheetKind,
      section,
      sortOrder,
      receipt,
      dueDate,
      sourceSheet: debitListingSheetName(y, m, sheetKind),
      note: section === 'padron' && (prevSection === 'altas' || prevSection === 'cambios')
        ? ''
        : (row.note || ''),
      cardEdits: [],
    };
  });
}

/** No mostrar meses anteriores a octubre 2026 en el selector operativo. */
export const DEBIT_LISTING_MIN_PERIOD = Object.freeze({
  year: 2026,
  month: 10,
  key: '2026-10',
});

export function isDebitListingPeriodAllowed(year, month, min = DEBIT_LISTING_MIN_PERIOD) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return false;
  return y > min.year || (y === min.year && m >= min.month);
}

/**
 * Meses operativos: anterior / actual / siguiente, desde oct-2026.
 * Enero del año nuevo recién aparece cuando termina diciembre (no se adelanta).
 */
export function debitListingHorizonPeriods(now = new Date()) {
  const currentY = now.getFullYear();
  const currentM = now.getMonth() + 1;

  let start = shiftYearMonth(currentY, currentM, -1);
  let end = shiftYearMonth(currentY, currentM, 1);

  // No mostrar enero (ni el año siguiente) hasta que diciembre haya terminado.
  if (end.year > currentY) {
    end = { year: currentY, month: 12 };
  }

  if (!isDebitListingPeriodAllowed(start.year, start.month)) {
    start = { ...DEBIT_LISTING_MIN_PERIOD };
  }
  if (!isDebitListingPeriodAllowed(end.year, end.month)) {
    end = { ...DEBIT_LISTING_MIN_PERIOD };
  }
  // Semilla operativa oct–dic 2026 si el reloj aún está antes de octubre.
  if (!isDebitListingPeriodAllowed(currentY, currentM)) {
    start = { ...DEBIT_LISTING_MIN_PERIOD };
    end = { year: 2026, month: 12 };
  }

  const out = [];
  let y = start.year;
  let m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    if (isDebitListingPeriodAllowed(y, m)) {
      out.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
    }
    ({ year: y, month: m } = shiftYearMonth(y, m, 1));
  }
  if (!out.length) out.push({ ...DEBIT_LISTING_MIN_PERIOD });
  return out;
}

/** Meses del selector: horizonte corto; jamás meses previos a octubre 2026. */
export function debitListingPeriodOptions(rows = [], now = new Date()) {
  const horizon = debitListingHorizonPeriods(now);
  const map = new Map(horizon.map((period) => [period.key, period]));
  const allowed = new Set(map.keys());
  for (const row of rows || []) {
    const year = Number(row.year);
    const month = Number(row.month);
    if (!isDebitListingPeriodAllowed(year, month)) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!allowed.has(key)) continue;
    if (!map.has(key)) map.set(key, { year, month, key });
  }
  return [...map.values()].toSorted((a, b) => (a.year - b.year) || (a.month - b.month));
}

export function periodLabelES(year, month) {
  const names = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return `${names[(Number(month) || 1) - 1] || month} ${year}`;
}

export function monthNameES(month) {
  const names = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return names[(Number(month) || 1) - 1] || String(month);
}

/** ISO date → serial Excel (compatible con excelSerialToISODate). */
export function isoDateToExcelSerial(iso) {
  const raw = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((ms - epoch) / 86400000);
}

const SECTION_EXPORT_LABELS = Object.freeze({
  altas: 'ALTAS DE TARJETAS',
  bajas: 'BAJAS DE TARJETAS',
  cambios: 'CAMBIOS DE TARJETAS',
  debitos_aplicacion: 'DEBITOS PARA APLICACIÓN',
});

const COLUMN_HEADERS = Object.freeze([
  null,
  'N° TARJETA',
  'COMPROBANTE',
  'VENCIMIENTO',
  'CUOTA ',
  'ABONO ',
  'TOTAL',
  'N°SOCIO',
  'ESTADO',
  'TITULAR',
  'DEBITO',
]);

function emptyRow() {
  return [null, null, null, null, null, null, null, null, null, null, null];
}

function moneyOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.round(n * 100) / 100;
}

function receiptValue(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : raw;
  }
  return raw;
}

/**
 * Nombre de hoja como en la planilla original.
 * Crédito: "Noviembre 2026" · Débito: "Noviembre debito 2026"
 */
export function debitListingSheetName(year, month, sheetKind = 'credito') {
  const monthLabel = monthNameES(month);
  if (sheetKind === 'debito') return `${monthLabel} debito ${year}`;
  return `${monthLabel} ${year}`;
}

/**
 * Arma la matriz AOA tal cual la planilla (col A = #, B…K = datos).
 * Incluye cabeceras de marca, MES, columnas, subtotales de padrón y secciones.
 */
export function buildDebitListingMatrix(rows = [], { year, month, sheetKind = 'credito' } = {}) {
  const y = Number(year) || 0;
  const m = Number(month) || 0;
  const list = [...(rows || [])].toSorted((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  const matrix = [];
  let prevBrand = null;
  let prevSection = null;
  let padronAcc = { dues: 0, abono: 0, total: 0 };
  let hasPadronAcc = false;

  const flushPadronSubtotal = () => {
    if (!hasPadronAcc) return;
    matrix.push(emptyRow());
    matrix.push([
      null, null, null, null,
      moneyOrNull(padronAcc.dues) ?? 0,
      moneyOrNull(padronAcc.abono) ?? 0,
      moneyOrNull(padronAcc.total) ?? 0,
      null, null, null, null,
    ]);
    matrix.push(emptyRow());
    padronAcc = { dues: 0, abono: 0, total: 0 };
    hasPadronAcc = false;
  };

  const openBrand = (brand) => {
    const label = String(brand || (sheetKind === 'debito' ? 'VISA DEBITO' : 'ARGENCARD')).toUpperCase();
    matrix.push([null, label, null, null, null, null, null, null, null, null, null]);
    matrix.push([
      null,
      `MES: ${monthNameES(m).toUpperCase()} ${y}`,
      null, null, null, null, null, null, null, null, null,
    ]);
    matrix.push(emptyRow());
    const headers = [...COLUMN_HEADERS];
    if (sheetKind === 'debito') headers[10] = null;
    matrix.push(headers);
  };

  for (const row of list) {
    const brand = String(row.brand || '').toUpperCase() || (sheetKind === 'debito' ? 'VISA DEBITO' : 'ARGENCARD');
    const section = row.section || 'padron';

    if (brand !== prevBrand) {
      if (prevBrand) flushPadronSubtotal();
      if (prevBrand) matrix.push(emptyRow());
      openBrand(brand);
      prevBrand = brand;
      prevSection = 'padron';
    }

    if (section !== prevSection) {
      if (prevSection === 'padron') flushPadronSubtotal();
      else if (prevSection) matrix.push(emptyRow());
      const sectionLabel = SECTION_EXPORT_LABELS[section];
      if (sectionLabel) {
        matrix.push([null, sectionLabel, null, null, null, null, null, null, null, null, null]);
      }
      prevSection = section;
    }

    if (section === 'padron') {
      padronAcc.dues += Number(row.duesAmount) || 0;
      padronAcc.abono += Number(row.abonoAmount) || 0;
      padronAcc.total += Number(row.totalAmount) || 0;
      hasPadronAcc = true;
    }

    const dues = moneyOrNull(row.duesAmount);
    const abono = moneyOrNull(row.abonoAmount);
    const total = moneyOrNull(row.totalAmount) ?? ((Number(row.duesAmount) || 0) + (Number(row.abonoAmount) || 0));
    matrix.push([
      Number(row.sortOrder) || null,
      row.cardNumber ? String(row.cardNumber) : null,
      receiptValue(row.receipt),
      isoDateToExcelSerial(row.dueDate),
      dues,
      abono,
      total || 0,
      row.memberId ? (Number.isSafeInteger(Number(row.memberId)) ? Number(row.memberId) : String(row.memberId)) : null,
      row.statusCode || null,
      row.holderName || null,
      row.note || null,
    ]);
  }

  flushPadronSubtotal();
  return matrix;
}
