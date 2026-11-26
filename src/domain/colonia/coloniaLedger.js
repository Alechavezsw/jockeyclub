/**
 * Submayor Colonia — independiente de members.outstanding_balance y dues.
 */

import { COLONIA_CHARGE_CONCEPTS, coloniaMethodLabel } from './coloniaConstants';
import { coloniaPaymentCapital } from './coloniaLate';
import { inscriptionAmount, planAmountFor } from './coloniaTariffs';

export function moneyArs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isLiveColoniaCharge(charge) {
  return String(charge?.status || 'posted') !== 'void';
}

function isConfirmedColoniaPayment(payment) {
  const status = String(payment?.status || '');
  return status === 'confirmed' || status === 'confirmado';
}

function isInscriptionConcept(concept) {
  return String(concept || '') === 'colonia_inscripcion';
}

/**
 * Imputa cobros confirmados a los cargos: primero inscripción, después mes/plan.
 * Permite cobrar inscripción y mes por separado sin partir la lógica de saldo.
 */
export function allocateColoniaPayments({ charges = [], payments = [] } = {}) {
  const live = (charges || [])
    .filter(isLiveColoniaCharge)
    .map((charge) => ({
      id: charge.id || null,
      concept: String(charge.concept || ''),
      label: COLONIA_CHARGE_CONCEPTS[charge.concept] || charge.concept || 'Cargo',
      amount: moneyArs(charge.amount),
      paid: 0,
      open: moneyArs(charge.amount),
      createdAt: charge.created_at || charge.createdAt || '',
    }))
    .toSorted((a, b) => {
      const aIns = isInscriptionConcept(a.concept) ? 0 : 1;
      const bIns = isInscriptionConcept(b.concept) ? 0 : 1;
      if (aIns !== bIns) return aIns - bIns;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });

  let remaining = moneyArs(
    (payments || [])
      .filter(isConfirmedColoniaPayment)
      .reduce((sum, payment) => sum + moneyArs(payment.amount), 0),
  );

  for (const row of live) {
    const applied = Math.min(row.amount, remaining);
    row.paid = moneyArs(applied);
    row.open = moneyArs(row.amount - applied);
    remaining = moneyArs(remaining - applied);
  }

  return live;
}

/** Saldos abiertos separables: inscripción vs mes/plan vs total. */
export function coloniaCollectableScopes({ charges = [], payments = [] } = {}) {
  const rows = allocateColoniaPayments({ charges, payments });
  const inscriptionCharged = moneyArs(
    rows.filter((row) => isInscriptionConcept(row.concept)).reduce((sum, row) => sum + row.amount, 0),
  );
  const planCharged = moneyArs(
    rows.filter((row) => !isInscriptionConcept(row.concept)).reduce((sum, row) => sum + row.amount, 0),
  );
  const inscriptionOpen = moneyArs(
    rows.filter((row) => isInscriptionConcept(row.concept)).reduce((sum, row) => sum + row.open, 0),
  );
  const planOpen = moneyArs(
    rows.filter((row) => !isInscriptionConcept(row.concept)).reduce((sum, row) => sum + row.open, 0),
  );
  const totalOpen = moneyArs(inscriptionOpen + planOpen);
  return {
    rows,
    inscriptionCharged,
    planCharged,
    inscriptionOpen,
    planOpen,
    totalOpen,
    canPayInscription: inscriptionOpen > 0.009,
    canPayPlan: planOpen > 0.009,
    canPayAll: totalOpen > 0.009,
  };
}

/** Importe a cobrar según alcance elegido en mostrador. */
export function coloniaAmountForPayScope(scope, { inscriptionAmount = 0, planAmount = 0 } = {}) {
  const inscription = moneyArs(inscriptionAmount);
  const plan = moneyArs(planAmount);
  const key = String(scope || 'todo');
  if (key === 'inscripcion') return inscription;
  if (key === 'plan') return plan;
  return moneyArs(inscription + plan);
}

export function summarizeColoniaAccount({ charges = [], payments = [] } = {}) {
  const charged = moneyArs(
    (charges || [])
      .filter((c) => String(c.status || 'posted') !== 'void')
      .reduce((sum, c) => sum + moneyArs(c.amount), 0),
  );
  const confirmed = moneyArs(
    (payments || [])
      .filter((p) => {
        const status = String(p.status || '');
        return status === 'confirmed' || status === 'confirmado';
      })
      .reduce((sum, p) => sum + moneyArs(p.amount), 0),
  );
  const pending = moneyArs(
    (payments || [])
      .filter((p) => String(p.status || '') === 'pending')
      .reduce((sum, p) => sum + moneyArs(p.amount), 0),
  );
  const balance = moneyArs(charged - confirmed);
  const scopes = coloniaCollectableScopes({ charges, payments });
  return {
    totalContracted: charged,
    totalCollected: confirmed,
    pendingConfirmation: pending,
    balanceDue: balance,
    isSettled: balance <= 0 && pending === 0,
    inscriptionOpen: scopes.inscriptionOpen,
    planOpen: scopes.planOpen,
    inscriptionCharged: scopes.inscriptionCharged,
    planCharged: scopes.planCharged,
  };
}

export function buildColoniaCharge({
  enrollmentId,
  seasonId,
  concept,
  planKey = null,
  amount,
  studentId = null,
  siblingGroupId = null,
  note = '',
} = {}) {
  const conceptKey = String(concept || '');
  if (!COLONIA_CHARGE_CONCEPTS[conceptKey]) {
    throw new Error('Concepto de Colonia inválido.');
  }
  const value = moneyArs(amount);
  if (value < 0) throw new Error('El cargo no puede ser negativo.');
  return {
    enrollmentId,
    seasonId,
    studentId,
    siblingGroupId,
    concept: conceptKey,
    planKey,
    amount: value,
    currency: 'ARS',
    status: 'posted',
    note: String(note || '').trim(),
    affectsSocialDues: false,
    affectsMemberOutstandingBalance: false,
  };
}

export function buildColoniaReceipt({
  payment,
  student,
  guardian,
  season,
  chargeConcepts = [],
} = {}) {
  const status = String(payment?.status || '');
  if (status !== 'confirmed') {
    return null;
  }
  return {
    club: 'Jockey Club San Juan',
    conceptLabel: 'Colonia de Verano',
    fiscalClaim: false,
    fiscalNote: 'Recibo interno de Colonia. No constituye factura fiscal.',
    studentName: student?.fullName || student?.full_name || '—',
    guardianName: guardian?.fullName || guardian?.full_name || '—',
    seasonName: season?.name || season?.code || '—',
    seasonCode: season?.code || null,
    amount: moneyArs(payment?.amount),
    currency: 'ARS',
    paidAt: payment?.confirmed_at || payment?.confirmedAt || payment?.paidAt || payment?.created_at || payment?.createdAt || null,
    method: coloniaMethodLabel(payment?.method),
    methodKey: payment?.method || null,
    reference: payment?.external_reference || payment?.externalReference || payment?.id || null,
    operationId: payment?.id || null,
    status,
    chargeConcepts: chargeConcepts || [],
  };
}

function monthStart(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

function monthKeyFromDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  const match = /^(\d{4})-(\d{2})/.exec(String(value));
  if (match) return `${match[1]}-${match[2]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  const label = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Meses de la temporada. Sin fecha de fin, la colonia de verano llega hasta febrero. */
export function coloniaAccountMonths(season, today = new Date()) {
  const start = monthStart(season?.activities_start_on || season?.activitiesStartOn
    || season?.enrollment_opens_on || season?.enrollmentOpensOn)
    || new Date(today.getFullYear(), today.getMonth(), 1);
  let end = monthStart(season?.activities_end_on || season?.activitiesEndOn);
  if (!end) {
    end = start.getMonth() >= 9
      ? new Date(start.getFullYear() + 1, 1, 1)
      : new Date(start.getFullYear(), start.getMonth() + 2, 1);
  }
  if (end < start) end = new Date(start.getFullYear(), start.getMonth(), 1);
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end && months.length < 6) {
    months.push({ key: monthKeyFromDate(cursor), label: monthLabel(cursor) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export function coloniaNextMonthLabel(today = new Date()) {
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return next.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function rowsByEnrollment(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const id = row?.enrollment_id || row?.enrollmentId;
    if (!id) continue;
    const list = map.get(id) || [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

/**
 * Cuenta de Colonia por inscripción: cobrado, falta y, si el plan es mensual, el mes que viene.
 * No mezcla la cuota social.
 */
export function buildColoniaAccountRows({
  enrollments = [],
  charges = [],
  payments = [],
  tariffs,
  periodicity = null,
  today = new Date(),
} = {}) {
  const chargeMap = rowsByEnrollment(charges);
  const paymentMap = rowsByEnrollment(payments);
  const nextLabel = coloniaNextMonthLabel(today);
  return (enrollments || [])
    .filter((row) => row?.status !== 'cancelada')
    .map((enrollment) => {
      const summary = summarizeColoniaAccount({
        charges: chargeMap.get(enrollment.id) || [],
        payments: paymentMap.get(enrollment.id) || [],
      });
      const plan = String(enrollment.plan_key || enrollment.planKey || '');
      const kind = enrollment.student?.member_kind || enrollment.student?.memberKind || 'socio';
      const monthly = plan === 'cuota'
        || (periodicity === 'monthly' && (plan === 'promo_2' || plan === 'promo_3'));
      const monthAmount = monthly ? (Number(planAmountFor(tariffs, kind, plan)) || 0) : 0;
      const owed = summary.balanceDue;
      let status = 'pago';
      if (owed > 0) status = 'falta';
      else if (summary.pendingConfirmation > 0) status = 'pendiente';
      else if (monthAmount > 0) status = 'proximo';
      return {
        enrollment,
        summary,
        plan,
        status,
        owed,
        nextAmount: status === 'proximo' ? monthAmount : 0,
        nextLabel,
        noticeAmount: owed > 0 ? owed : (status === 'proximo' ? monthAmount : 0),
      };
    });
}

function paymentPool(payments = [], status) {
  return (payments || [])
    .filter((payment) => String(payment.status || '') === status)
    .reduce((sum, payment) => sum + coloniaPaymentCapital(payment), 0);
}

function confirmedPool(payments = []) {
  return paymentPool(payments, 'confirmed') + paymentPool(payments, 'confirmado');
}

function pendingPool(payments = []) {
  return paymentPool(payments, 'pending');
}

function liveCharges(charges = []) {
  return (charges || []).filter((charge) => String(charge.status || 'posted') !== 'void');
}

/** Si ya hay cargos, el mes sigue lo publicado. Si no, usa la tarifa. */
function monthDueParts(charges, { tariff, inscription }) {
  if (!charges.length) return { firstExtra: inscription, monthTariff: tariff };
  const live = liveCharges(charges);
  const firstExtra = live
    .filter((charge) => String(charge.concept || '') === 'colonia_inscripcion')
    .reduce((sum, charge) => sum + moneyArs(charge.amount), 0);
  const monthTariff = live
    .filter((charge) => {
      const concept = String(charge.concept || '');
      return concept !== 'colonia_inscripcion' && concept !== 'colonia_interes';
    })
    .reduce((sum, charge) => sum + moneyArs(charge.amount), 0);
  return { firstExtra, monthTariff };
}

/**
 * Una fila por inscripción en un mes de la temporada.
 * La cuota mensual se imputa de mes en mes. Temporada y cuarto hermano quedan en el mes del cargo.
 */
export function buildColoniaMonthRows({
  enrollments = [],
  charges = [],
  payments = [],
  tariffs,
  periodicity = null,
  monthKey,
  season,
  today = new Date(),
} = {}) {
  const months = coloniaAccountMonths(season, today);
  const keys = months.map((month) => month.key);
  const currentKey = monthKeyFromDate(today);
  const chargeMap = rowsByEnrollment(charges);
  const paymentMap = rowsByEnrollment(payments);
  const nextLabel = months.find((month) => month.key === monthKey)?.label || coloniaNextMonthLabel(today);
  return (enrollments || [])
    .filter((row) => row?.status !== 'cancelada')
    .flatMap((enrollment) => {
      const plan = String(enrollment.plan_key || enrollment.planKey || '');
      const kind = enrollment.student?.member_kind || enrollment.student?.memberKind || 'socio';
      const monthly = plan === 'cuota'
        || (periodicity === 'monthly' && (plan === 'promo_2' || plan === 'promo_3'));
      const tariff = Number(planAmountFor(tariffs, kind, plan)) || 0;
      const inscription = plan === 'hermano_4' ? 0 : inscriptionAmount(tariffs);
      const ownCharges = chargeMap.get(enrollment.id) || [];
      const ownPayments = paymentMap.get(enrollment.id);
      const pool = confirmedPool(ownPayments);
      const waiting = pendingPool(ownPayments);
      const dueParts = monthDueParts(ownCharges, { tariff, inscription });
      let collected = 0;
      let owed = 0;
      let status = 'pago';
      let nextAmount = 0;
      if (!monthly) {
        const anchor = monthKeyFromDate(ownCharges[0]?.created_at || ownCharges[0]?.createdAt) || keys[0];
        if (anchor !== monthKey) return [];
        const contracted = ownCharges.length
          ? liveCharges(ownCharges).reduce((sum, charge) => sum + moneyArs(charge.amount), 0)
          : tariff + inscription;
        collected = Math.min(pool, contracted);
        owed = moneyArs(Math.max(0, contracted - pool));
        status = owed > 0 ? 'falta' : (waiting > 0 ? 'pendiente' : 'pago');
      } else if (!keys.includes(monthKey)) {
        return [];
      } else if (currentKey && monthKey > currentKey) {
        if (dueParts.monthTariff > 0) {
          status = 'proximo';
          nextAmount = dueParts.monthTariff;
        }
      } else {
        let left = pool;
        let pendingLeft = waiting;
        const slices = [];
        for (const key of keys) {
          if (currentKey && key > currentKey) break;
          const due = (key === keys[0] ? dueParts.firstExtra : 0) + dueParts.monthTariff;
          const take = Math.min(left, due);
          left = moneyArs(left - take);
          const gap = moneyArs(Math.max(0, due - take));
          const pendHere = Math.min(pendingLeft, gap);
          pendingLeft = moneyArs(pendingLeft - pendHere);
          slices.push({ key, collected: take, owed: gap, pendHere });
        }
        const slice = slices.find((item) => item.key === monthKey);
        if (!slice) return [];
        const laterOwes = slices.some((item) => item.key > monthKey && item.owed > 0);
        collected = slice.collected;
        owed = slice.owed;
        const lastStarted = slices[slices.length - 1]?.key;
        status = owed > 0
          ? 'falta'
          : ((slice.pendHere > 0 || (pendingLeft > 0 && !laterOwes && monthKey === lastStarted)) ? 'pendiente' : 'pago');
      }
      return [{
        enrollment,
        summary: {
          totalContracted: moneyArs(collected + owed),
          totalCollected: collected,
          pendingConfirmation: 0,
          balanceDue: owed,
          isSettled: owed <= 0,
        },
        plan,
        status,
        owed,
        nextAmount,
        nextLabel,
        noticeAmount: owed > 0 ? owed : nextAmount,
        monthKey,
      }];
    });
}

/** CSV simple de inscripciones (reportes administrativos). */
export function buildColoniaEnrollmentsCsv(rows = []) {
  const header = ['alumno', 'dni', 'condicion', 'plan', 'estado', 'responsable', 'telefono'];
  const lines = [header.join(';')];
  for (const row of rows || []) {
    const student = row.student || row;
    const guardian = row.guardian || {};
    lines.push([
      student.full_name || student.fullName || '',
      student.document_number || student.documentNumber || '',
      student.member_kind || student.memberKind || '',
      row.plan_key || row.planKey || '',
      row.status || '',
      guardian.full_name || guardian.fullName || '',
      guardian.phone || '',
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'));
  }
  return `${lines.join('\n')}\n`;
}

/** Garantiza que un payload de Colonia no toque deuda social. */
export function assertColoniaFinanceIsolation(payload = {}) {
  if (payload.affectsSocialDues === true) {
    throw new Error('Un movimiento de Colonia no puede afectar la cuota social.');
  }
  if (payload.affectsMemberOutstandingBalance === true) {
    throw new Error('Un movimiento de Colonia no puede modificar members.outstanding_balance.');
  }
  if (payload.imputeTo === 'dues' || payload.chargeScope === 'social' || payload.chargeScope === 'cuota') {
    throw new Error('No se puede imputar un pago de Colonia a cuota social.');
  }
  return true;
}
