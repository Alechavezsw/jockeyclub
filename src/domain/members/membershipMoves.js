/** Altas y bajas Societas: clasifica motivos y les da color. */

import { readSnapshot } from '../../data/snapshots';

const EMPTY_MEMBERSHIP_MOVES_SEED = Object.freeze({
  SOCIETAS_MEMBERSHIP_MOVES_AS_OF: '',
  SOCIETAS_MEMBERSHIP_MOVES_SNAPSHOT: {},
  SOCIETAS_MEMBERSHIP_ALTAS: [],
  SOCIETAS_MEMBERSHIP_BAJAS: [],
});

/** Snapshot `societasMembershipMoves` (nombre y DNI); vacío hasta que carga (ver data/snapshots). */
export function membershipMovesSeed() {
  return readSnapshot('societasMembershipMoves', EMPTY_MEMBERSHIP_MOVES_SEED);
}

export const MEMBERSHIP_MOVE_AS_OF = '2026-09-12';
export const MEMBERSHIP_MOVE_PERIOD = { from: '2026-08-01', to: '2026-09-11' };

export const BAJA_KINDS = {
  licencia: { id: 'licencia', label: 'Licencia', color: '#c9a227' },
  mora: { id: 'mora', label: 'Mora / falta de pago', color: '#c23b3b' },
  duplicado: { id: 'duplicado', label: 'Duplicado', color: '#6b7280' },
  renuncia: { id: 'renuncia', label: 'Baja con nota', color: '#2563eb' },
  mayoria: { id: 'mayoria', label: 'Mayoridad', color: '#0d9488' },
  grupo: { id: 'grupo', label: 'Grupo familiar', color: '#7c3aed' },
  liga: { id: 'liga', label: 'Liga / no socio', color: '#ea580c' },
  reempadron: { id: 'reempadron', label: 'Reempadronado', color: '#0369a1' },
  otro: { id: 'otro', label: 'Otro', color: '#4b5563' },
};

const KIND_ORDER = [
  'mora', 'licencia', 'renuncia', 'duplicado', 'mayoria', 'grupo', 'liga', 'reempadron', 'otro',
];

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyBajaMotivo(motivo) {
  const t = fold(motivo);
  if (!t) return BAJA_KINDS.otro;
  if (/licencia/.test(t)) return BAJA_KINDS.licencia;
  if (/duplic/.test(t)) return BAJA_KINDS.duplicado;
  if (/mayor(i|ia)|26 a/.test(t)) return BAJA_KINDS.mayoria;
  if (/liga|no socio/.test(t)) return BAJA_KINDS.liga;
  if (/afiliarse nuevamente|creado nuevamente/.test(t)) return BAJA_KINDS.reempadron;
  if (/mora|no pagar|morosidad|falta de pago|deuda/.test(t)) return BAJA_KINDS.mora;
  if (/titularidad|pertenecer al g-f|desvincul|grupo familiar|baja familiar/.test(t)) return BAJA_KINDS.grupo;
  if (/nota|renuncia|solicit/.test(t)) return BAJA_KINDS.renuncia;
  return BAJA_KINDS.otro;
}

export function parseArDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return '';
  const dd = String(m[1]).padStart(2, '0');
  const mm = String(m[2]).padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

export function memberMoveKey(value) {
  const n = Number.parseInt(String(value || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : '';
}

export function decorateBaja(row) {
  const kind = classifyBajaMotivo(row.motivo);
  return {
    ...row,
    memberId: memberMoveKey(row.memberId),
    kind: kind.id,
    kindLabel: kind.label,
    color: kind.color,
  };
}

export function summarizeBajas(rows = []) {
  const counts = Object.fromEntries(KIND_ORDER.map((id) => [id, 0]));
  for (const row of rows) {
    const id = row.kind || classifyBajaMotivo(row.motivo).id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return KIND_ORDER
    .map((id) => ({ ...BAJA_KINDS[id], count: counts[id] || 0 }))
    .filter((k) => k.count > 0);
}

export function uniqueBajas(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${memberMoveKey(row.memberId)}|${row.date || ''}|${fold(row.motivo)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(decorateBaja(row));
  }
  return out.toSorted((a, b) => String(b.date).localeCompare(String(a.date))
    || String(a.name).localeCompare(String(b.name), 'es'));
}
