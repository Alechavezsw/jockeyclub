/** Reporte composición de recargos (Accessin / LILA). */

import { ACCESSIN_COBRANZAS } from '../../data/seed/accessinCobranzas';
import { ACCESSIN_MONTHLY_DEBTS_BY_NUMBER } from '../../data/seed/accessinMonthlyDebts';

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

function inRange(iso, from, to) {
  const d = String(iso || '').slice(0, 10);
  if (!d) return !from && !to;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function classifySurcharge(type, concept) {
  const text = `${type || ''} ${concept || ''}`;
  const pct = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (/fijo/i.test(text)) return { kind: 'fijo', kindLabel: 'Recargo de Cuota (FIJO)', rate: null };
  if (pct) {
    const rate = Number(String(pct[1]).replace(',', '.'));
    return { kind: 'porcentaje', kindLabel: `Recargo de Cuota (${rate.toFixed(2)} %)`, rate };
  }
  return { kind: 'otro', kindLabel: 'Recargo', rate: null };
}

/** Recargos cobrados (caja) + recargos aún adeudados (morosos). */
export function buildSurchargeComposition({
  memberNumber = '',
  from = '',
  to = '',
  cobranzas = ACCESSIN_COBRANZAS,
  debtsByNumber = ACCESSIN_MONTHLY_DEBTS_BY_NUMBER,
} = {}) {
  const nro = padMember(memberNumber);
  const rows = [];

  (cobranzas || []).forEach((row) => {
    if (String(row.type || '') !== 'Recargos') return;
    if (nro && padMember(row.memberNumber) !== nro) return;
    if (!inRange(row.date, from, to)) return;
    const cls = classifySurcharge(row.type, row.concept);
    rows.push({
      id: row.id,
      source: 'cobranza',
      memberNumber: padMember(row.memberNumber),
      memberName: row.memberName || '',
      date: row.date,
      type: cls.kindLabel,
      description: String(row.concept || '').replace(/^Recargo:\s*/i, ''),
      amount: Number(row.amount) || 0,
      status: 'cobrado',
      kind: cls.kind,
    });
  });

  Object.values(debtsByNumber || {}).forEach((debtor) => {
    if (nro && padMember(debtor.memberNumber) !== nro) return;
    (debtor.lines || []).forEach((line) => {
      if (!/recargo/i.test(line.type || '')) return;
      if (!inRange(line.date, from, to)) return;
      const cls = classifySurcharge(line.type, line.description);
      rows.push({
        id: `debt-${line.id || line.date}-${debtor.memberNumber}`,
        source: 'deuda',
        memberNumber: padMember(debtor.memberNumber),
        memberName: debtor.memberName || '',
        date: line.date,
        type: cls.kindLabel,
        description: line.description || '',
        amount: Number(line.owed) || Number(line.amount) || 0,
        status: 'adeudado',
        kind: cls.kind,
      });
    });
  });

  const sorted = rows.toSorted((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  const byKind = {};
  let total = 0;
  let collected = 0;
  let owed = 0;
  sorted.forEach((row) => {
    const amt = Number(row.amount) || 0;
    total += amt;
    if (row.status === 'cobrado') collected += amt;
    else owed += amt;
    if (!byKind[row.kind]) byKind[row.kind] = { kind: row.kind, label: row.type, amount: 0, count: 0 };
    byKind[row.kind].amount += amt;
    byKind[row.kind].count += 1;
  });

  return {
    memberNumber: nro,
    from,
    to,
    rows: sorted,
    byKind: Object.values(byKind),
    total: Math.round(total * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    owed: Math.round(owed * 100) / 100,
  };
}
