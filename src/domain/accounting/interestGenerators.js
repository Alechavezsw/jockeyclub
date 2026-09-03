/**
 * Generador de intereses sobre cuotas / saldos impagos (estilo Accessin/LILA).
 */

export const INTEREST_PERIODS = [
  { id: 'manual', label: 'Generación Manual' },
  { id: 'monthly', label: 'Mensual' },
  { id: 'bimonthly', label: 'Bimestral' },
  { id: 'quarterly', label: 'Trimestral' },
];

export const INTEREST_RUN_STATUS = {
  completed: 'Completado',
  draft: 'Borrador',
  cancelled: 'Anulado',
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseMemberList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function periodLabel(periodId) {
  return INTEREST_PERIODS.find((p) => p.id === periodId)?.label || periodId || '—';
}

export function createInterestGenerator(input = {}) {
  const identifier = String(input.identifier || '').trim();
  if (!identifier) throw new Error('El identificador es obligatorio.');

  const percentage = Number(input.percentage);
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new Error('El porcentaje debe ser un número válido (≥ 0).');
  }

  const tolerance = Number(input.tolerance ?? 0);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('La tolerancia debe ser un número válido (≥ 0).');
  }

  const period = INTEREST_PERIODS.some((p) => p.id === input.period)
    ? input.period
    : 'manual';

  return {
    id: input.id || uid('intgen'),
    identifier,
    duesDescription: String(input.duesDescription || '').trim(),
    period,
    separateEntries: Boolean(input.separateEntries),
    percentage: Math.round(percentage * 1000) / 1000,
    includeMembers: parseMemberList(input.includeMembers),
    excludeMembers: parseMemberList(input.excludeMembers),
    tolerance: Math.round(tolerance * 100) / 100,
    duesFrom: input.duesFrom || '',
    duesTo: input.duesTo || '',
    settlementDate: input.settlementDate || null,
    isActive: input.isActive !== false,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: input.source || 'manual',
  };
}

export function upsertInterestGenerator(list = [], input = {}) {
  const existing = (list || []).find((g) => g.id === input.id) || null;
  const next = createInterestGenerator({
    ...existing,
    ...input,
    id: existing?.id || input.id,
    createdAt: existing?.createdAt,
  });
  if (existing) {
    return (list || []).map((g) => (g.id === existing.id ? next : g));
  }
  return [next, ...(list || [])];
}

export function softDeleteInterestGenerator(list = [], id) {
  return (list || []).map((g) => (
    g.id === id
      ? { ...g, isActive: false, updatedAt: new Date().toISOString() }
      : g
  ));
}

function inDateRange(isoDate, from, to) {
  const d = String(isoDate || '').slice(0, 10);
  if (!d) return true;
  if (from && d < String(from).slice(0, 10)) return false;
  if (to && d > String(to).slice(0, 10)) return false;
  return true;
}

/**
 * Selecciona socios con saldo > tolerancia, aplicando include/exclude.
 */
export function selectMembersForInterest(members = [], generator) {
  const include = new Set((generator.includeMembers || []).map(String));
  const exclude = new Set((generator.excludeMembers || []).map(String));
  const tolerance = Number(generator.tolerance) || 0;

  return (members || []).filter((m) => {
    const mid = String(m.memberId || '').trim();
    if (!mid) return false;
    if (include.size && !include.has(mid)) return false;
    if (exclude.has(mid)) return false;
    const balance = Number(m.outstandingBalance) || 0;
    if (balance <= tolerance) return false;
    // Si hay nextDueDate, respetar rango de cuotas
    if (m.nextDueDate && !inDateRange(m.nextDueDate, generator.duesFrom, generator.duesTo)) {
      return false;
    }
    return true;
  });
}

export function computeInterestAmount(balance, percentage, tolerance = 0) {
  const base = Math.max(0, (Number(balance) || 0) - (Number(tolerance) || 0));
  if (base <= 0) return 0;
  return Math.round(base * ((Number(percentage) || 0) / 100) * 100) / 100;
}

/**
 * Ejecuta un generador: crea entradas de interés sobre saldos y un registro de corrida.
 */
export function runInterestGenerator({
  generator,
  members = [],
  imputationDate = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!generator?.id) throw new Error('Generador inválido.');
  if (!generator.isActive) throw new Error('El generador está inactivo.');

  const targets = selectMembersForInterest(members, generator);
  const entries = [];

  if (generator.separateEntries) {
    targets.forEach((m) => {
      const amount = computeInterestAmount(m.outstandingBalance, generator.percentage, generator.tolerance);
      if (amount <= 0) return;
      entries.push({
        id: uid('intent'),
        memberId: m.memberId,
        memberName: m.name || '',
        amount,
        description:
          generator.duesDescription
          || `Interés ${generator.percentage}% · ${generator.identifier}`,
        balanceBase: Number(m.outstandingBalance) || 0,
      });
    });
  } else {
    targets.forEach((m) => {
      const amount = computeInterestAmount(m.outstandingBalance, generator.percentage, generator.tolerance);
      if (amount <= 0) return;
      entries.push({
        id: uid('intent'),
        memberId: m.memberId,
        memberName: m.name || '',
        amount,
        description:
          generator.duesDescription
          || `Interés ${generator.percentage}% · ${generator.identifier}`,
        balanceBase: Number(m.outstandingBalance) || 0,
      });
    });
  }

  const totalAmount = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;

  const run = {
    id: uid('intrun'),
    generatorId: generator.id,
    generatorLabel: generator.identifier,
    imputationDate: String(imputationDate).slice(0, 10),
    createdAt: new Date().toISOString(),
    status: 'completed',
    entriesCreated: entries.length,
    totalAmount,
    entries,
    percentage: generator.percentage,
    separateEntries: Boolean(generator.separateEntries),
  };

  const memberBalancePatches = entries.map((e) => ({
    memberId: e.memberId,
    delta: e.amount,
  }));

  return { run, entries, memberBalancePatches };
}

export function cancelInterestRun(runs = [], runId) {
  return (runs || []).map((r) => (
    r.id === runId
      ? { ...r, status: 'cancelled', cancelledAt: new Date().toISOString() }
      : r
  ));
}

export function activeInterestGenerators(list = []) {
  return (list || [])
    .filter((g) => g && g.isActive !== false)
    .toSorted((a, b) => String(a.identifier).localeCompare(String(b.identifier), 'es'));
}

export function interestRunsNewestFirst(runs = []) {
  return (runs || [])
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
