/**
 * Anticipos y saldos a favor — una sola imputación válida por peso.
 *
 * Reglas:
 * 1. Un adelanto imputado a un período futuro NO genera crédito libre por ese monto.
 * 2. Solo el excedente real (menor a una cuota entera) queda como saldo a favor.
 * 3. Un descuento administrativo no es dinero ingresado: no puede crear crédito.
 * 4. El abono tenis no entra en la base de anticipo de cuota social.
 */

export function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Tarifa de cuota social vigente (desde oct-2026). */
export function socialTariffForTier(tier = '') {
  const key = String(tier || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (key.includes('individual')) return 40000;
  if (key.includes('familiar') || key.includes('grupo')) return 70000;
  return 0;
}

export function nextDueOnAfter(dueOn) {
  const iso = String(dueOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m] = iso.split('-').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-10`;
}

/** Capital ya imputado (cobro o adelanto) a un dueOn, sin anulados. */
export function imputedCapitalForDue(imputations = [], dueOn) {
  const target = String(dueOn || '').slice(0, 10);
  let sum = 0;
  for (const row of imputations || []) {
    if (row?.voidedAt) continue;
    if (String(row?.dueOn || row?.due_on || '').slice(0, 10) !== target) continue;
    const kind = String(row?.kind || 'cobro').toLowerCase();
    if (kind !== 'cobro' && kind !== 'adelanto') continue;
    sum = money(sum + (Number(row?.capital) || 0));
  }
  return sum;
}

/**
 * Reparte el sobrante de caja tras cubrir deudas abiertas.
 * Devuelve imputaciones de adelanto + crédito libre residual.
 */
export function allocateAdvanceCash({
  cash = 0,
  tariff = 0,
  startDueOn = '',
  existingImputations = [],
  discount = 0,
  paidAmount = null,
  capitalPaid = 0,
  surchargePaid = 0,
} = {}) {
  let left = money(cash);
  const disc = money(Math.max(0, discount));
  if (disc > 0.01 && paidAmount != null) {
    // El descuento no es efectivo: el sobrante no puede superar el dinero real.
    const realLeft = money(Math.max(
      0,
      money(paidAmount) - money(capitalPaid) - money(Math.max(0, money(surchargePaid) - disc)),
    ));
    left = money(Math.min(left, realLeft));
  }

  const advances = [];
  let dueOn = String(startDueOn || '').slice(0, 10);
  const rate = money(tariff);
  let guard = 0;

  while (rate > 0.01 && left + 0.01 >= rate && dueOn && guard < 36) {
    guard += 1;
    const already = imputedCapitalForDue(
      [...(existingImputations || []), ...advances],
      dueOn,
    );
    if (already + 0.01 >= rate) {
      dueOn = nextDueOnAfter(dueOn);
      continue;
    }
    const take = money(Math.min(left, money(rate - already)));
    if (take <= 0.01) break;
    advances.push({
      dueOn,
      capital: take,
      surcharge: 0,
      kind: 'adelanto',
    });
    left = money(left - take);
    dueOn = nextDueOnAfter(dueOn);
  }

  return {
    advances,
    freeCredit: money(Math.max(0, left)),
    lastAdvanceDueOn: advances.length ? advances[advances.length - 1].dueOn : null,
  };
}

/**
 * Crédito libre visible: saldo negativo de ficha, menos capital ya
 * comprometido en adelantos futuros (evita doble lectura en UI).
 */
export function freeCreditFromStanding({
  outstandingBalance = 0,
  explicitCredit = 0,
  imputations = [],
  today = null,
} = {}) {
  const fromNeg = money(Number(outstandingBalance) || 0) < -0.01
    ? money(-(Number(outstandingBalance) || 0))
    : 0;
  const explicit = money(Math.max(0, Number(explicitCredit) || 0));
  let gross = money(fromNeg + explicit);
  if (!(gross > 0.01)) return 0;

  const todayIso = today
    ? String(today).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  let prepaid = 0;
  for (const row of imputations || []) {
    if (row?.voidedAt) continue;
    if (String(row?.kind || '').toLowerCase() !== 'adelanto') continue;
    const due = String(row?.dueOn || row?.due_on || '').slice(0, 10);
    if (due > todayIso) prepaid = money(prepaid + (Number(row?.capital) || 0));
  }
  // Si el libro ya neteó el adelanto, prepaid no debe restar de nuevo.
  // Solo recorta cuando el crédito bruto ≥ prepaid (doble conteo típico).
  if (prepaid > 0.01 && gross + 0.01 >= prepaid) {
    return money(Math.max(0, gross - prepaid));
  }
  return gross;
}

/** Invariantes de un socio reconciliado (fixtures de regresión). */
export function assertAdvanceCreditInvariants(snapshot = {}) {
  const errors = [];
  const tariff = socialTariffForTier(snapshot.tier);
  const imputations = snapshot.imputations || [];
  const entries = snapshot.entries || [];
  const outstanding = money(Number(snapshot.outstandingBalance) || 0);
  const book = money((entries || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0));

  if (Math.abs(outstanding - book) > 0.02) {
    errors.push(`ficha ${outstanding} ≠ libro ${book}`);
  }

  const adelantoImps = imputations.filter((row) => (
    !row?.voidedAt && String(row?.kind || '').toLowerCase() === 'adelanto'
  ));
  const adelantoEntries = entries.filter((row) => (
    String(row?.kind || '').toLowerCase() === 'adelanto'
    && money(Number(row.amount) || 0) < -0.01
  ));

  for (const imp of adelantoImps) {
    const due = String(imp.dueOn || imp.due_on || '').slice(0, 10);
    const paymentId = imp.paymentId || imp.payment_id;
    if (!paymentId) continue;
    const twin = adelantoEntries.find((row) => (
      String(row.source || '').includes(String(paymentId))
    ));
    if (!twin) continue;
    const twinAbs = money(Math.abs(Number(twin.amount) || 0));
    const reversed = (entries || []).some((row) => (
      String(row.kind || '').toLowerCase() === 'ajuste_administrativo'
      && String(row.source || '').includes(String(paymentId))
      && Math.abs(money(Number(row.amount) || 0) - twinAbs) <= 0.02
    ));
    if (!reversed) {
      errors.push(`doble crédito: adelanto ${due} también en libro sin ajuste`);
    }
  }

  if (outstanding < -0.01 && tariff > 0 && money(-outstanding) + 0.01 >= tariff) {
    // Crédito libre ≥ 1 cuota: debería haberse imputado a un período.
    const hasFutureAdvance = adelantoImps.some((row) => money(Number(row.capital) || 0) > 0.01);
    if (!hasFutureAdvance) {
      errors.push(`crédito libre ${-outstanding} ≥ tarifa ${tariff} sin imputación de adelanto`);
    }
  }

  return { ok: errors.length === 0, errors };
}
