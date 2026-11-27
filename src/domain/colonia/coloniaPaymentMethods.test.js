/**
 * Medios de pago de Colonia para un no socio.
 * El importe es la tarifa de no socio. Ningún medio toca la cuota social.
 */
import { describe, expect, it } from 'vitest';
import { CARD_JOURNAL_ACCOUNT, CASH_JOURNAL_ACCOUNT } from '../members/clubBanks';
import { DEFAULT_PAYMENT_PLANS } from '../system/paymentPlans';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import { coloniaMethodLabel } from './coloniaConstants';
import { quoteColoniaEnrollmentDue } from './coloniaLate';
import {
  buildColoniaPaymentDraft,
  coloniaEnrollPayReady,
  coloniaMercadoPagoAdapterSpec,
  coloniaMethodUsesBank,
  coloniaMethodUsesCard,
  coloniaMethodUsesCash,
  coloniaMpPayable,
  coloniaSettlementAccount,
  initialPaymentStatus,
  quoteColoniaPos,
  splitColoniaPosMeta,
  validateColoniaPaymentInput,
} from './coloniaPayments';
import { buildColoniaEnrollmentReceipt } from './coloniaReceipt';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027 } from './coloniaTariffs';

const ENROLLMENT = 'enr-nosocio-1';
const PAID_ON = '2026-11-05';

function due(kind = 'no_socio', plan = 'cuota') {
  return quoteColoniaEnrollmentDue({
    planKey: plan,
    memberKind: kind,
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    paidOn: PAID_ON,
    season: COLONIA_SEASON_2026_2027,
  });
}

const NO_SOCIO = due('no_socio');
const SOCIO = due('socio');

function draft(method, extra = {}) {
  return buildColoniaPaymentDraft({
    enrollmentId: ENROLLMENT,
    method,
    amount: NO_SOCIO.total,
    ...extra,
  });
}

function receipt(method) {
  return buildColoniaEnrollmentReceipt({
    pupils: [{ fullName: 'Sofía Díaz' }],
    planKey: 'cuota',
    memberKind: 'no_socio',
    inscriptionAmount: NO_SOCIO.inscription,
    planAmount: NO_SOCIO.planCapital,
    method,
    paymentStatus: 'confirmed',
    when: new Date('2026-11-05T12:00:00-03:00'),
    socioName: 'Laura Díaz',
    socioNumber: '88002',
  });
}

describe('importe de no socio, aparte de la cuota', () => {
  it('la cuota de no socio no usa el importe del socio', () => {
    expect(NO_SOCIO.planCapital).toBe(180000);
    expect(NO_SOCIO.inscription).toBe(50000);
    expect(NO_SOCIO.interest).toBe(0);
    expect(NO_SOCIO.total).toBe(230000);
    expect(SOCIO.planCapital).toBe(150000);
    expect(SOCIO.total).toBe(200000);
    expect(NO_SOCIO.total).not.toBe(SOCIO.total);
  });

  it('la temporada de no socio tampoco', () => {
    const external = due('no_socio', 'temporada');
    const member = due('socio', 'temporada');
    expect(external.planCapital).toBe(490000);
    expect(member.planCapital).toBe(390000);
    expect(external.inscription).toBe(50000);
    expect(external.total).toBe(540000);
  });
});

describe('efectivo', () => {
  it('entra en Caja General y queda acreditado', () => {
    expect(coloniaMethodUsesCash('efectivo')).toBe(true);
    expect(coloniaMethodUsesBank('efectivo')).toBe(false);
    expect(coloniaMethodUsesCard('efectivo')).toBe(false);
    expect(coloniaSettlementAccount('efectivo')).toBe(CASH_JOURNAL_ACCOUNT);
    expect(initialPaymentStatus('efectivo')).toBe('confirmed');
    expect(coloniaEnrollPayReady({ method: 'efectivo', amount: NO_SOCIO.total })).toEqual({
      ok: true,
      status: 'confirmed',
      message: '',
    });
    const row = draft('efectivo');
    expect(row.amount).toBe(230000);
    expect(row.status).toBe('confirmed');
    expect(row.bankId).toBeNull();
    expect(row.incomeClass).toBe('COLONIA');
    expect(row.affectsSocialDues).toBe(false);
    expect(row.affectsMemberOutstandingBalance).toBe(false);
    expect(row.imputeTo).toBe('colonia');
  });

  it('el recibo dice responsable y no socio, no socio del club', () => {
    const paper = receipt('efectivo');
    expect(paper.method).toBe('Efectivo');
    expect(paper.socioKind).toBe('No socio');
    expect(paper.responsibleLabel).toBe('Responsable');
    expect(paper.socioNumber).toBe('');
    expect(paper.isSocio).toBe(false);
    expect(paper.total).toBe(230000);
    expect(paper.fiscalNote).toMatch(/no es la cuota social/i);
    expect(paper.paymentLabel).toBe('Acreditado');
  });

  it('un importe en cero o negativo no se cobra', () => {
    expect(coloniaEnrollPayReady({ method: 'efectivo', amount: 0 }).ok).toBe(false);
    expect(coloniaEnrollPayReady({ method: 'efectivo', amount: -10 }).ok).toBe(false);
    const zero = validateColoniaPaymentInput({
      method: 'efectivo',
      amount: 0,
      enrollmentId: ENROLLMENT,
    });
    expect(zero.ok).toBe(false);
    expect(zero.errors.some((error) => error.code === 'amount_invalid')).toBe(true);
  });
});

describe('transferencia', () => {
  it('sin referencia no se acredita', () => {
    const ready = coloniaEnrollPayReady({ method: 'transferencia', amount: NO_SOCIO.total });
    expect(ready.ok).toBe(false);
    expect(ready.message).toMatch(/referencia/i);
    const checked = validateColoniaPaymentInput({
      method: 'transferencia',
      amount: NO_SOCIO.total,
      enrollmentId: ENROLLMENT,
    });
    expect(checked.ok).toBe(false);
    expect(checked.errors.some((error) => error.code === 'transfer_reference_required')).toBe(true);
    expect(() => draft('transferencia')).toThrow(/referencia|comprobante/i);
  });

  it('con comprobante acredita en el banco y no en caja', () => {
    expect(coloniaMethodUsesBank('transferencia')).toBe(true);
    expect(coloniaMethodUsesCash('transferencia')).toBe(false);
    expect(coloniaSettlementAccount('transferencia', 'macro')).toBe('Banco Macro');
    const ready = coloniaEnrollPayReady({
      method: 'transferencia',
      amount: NO_SOCIO.total,
      externalReference: 'TR-230',
    });
    expect(ready).toEqual({ ok: true, status: 'confirmed', message: '' });
    const row = draft('transferencia', { externalReference: 'TR-230', bankId: 'macro' });
    expect(row.status).toBe('confirmed');
    expect(row.amount).toBe(230000);
    expect(row.bankId).toBe('macro');
    expect(row.externalReference).toBe('TR-230');
    expect(row.affectsSocialDues).toBe(false);
    expect(receipt('transferencia').method).toBe('Transferencia');
  });
});

describe('débito', () => {
  it('pide comprobante del alias y acredita en el banco', () => {
    expect(coloniaEnrollPayReady({ method: 'debito', amount: NO_SOCIO.total }).ok).toBe(false);
    expect(coloniaMethodUsesBank('debito')).toBe(true);
    expect(coloniaMethodUsesCash('debito')).toBe(false);
    expect(coloniaMethodUsesCard('debito')).toBe(false);
    const ready = coloniaEnrollPayReady({
      method: 'debito',
      amount: 490000,
      externalReference: 'DB-490',
    });
    expect(ready.status).toBe('confirmed');
    const row = draft('debito', { externalReference: 'DB-490', amount: 490000 });
    expect(row.method).toBe('debito');
    expect(row.amount).toBe(490000);
    expect(row.bankId).toBe('macro');
    expect(row.status).toBe('confirmed');
    expect(receipt('debito').method).toBe('Débito');
  });
});

describe('Pago POS', () => {
  it('no acredita hasta confirmar la terminal', () => {
    for (const method of ['tarjeta', 'pos']) {
      expect(coloniaMethodUsesCard(method)).toBe(true);
      expect(coloniaMethodUsesCash(method)).toBe(false);
      expect(coloniaSettlementAccount(method)).toBe(CARD_JOURNAL_ACCOUNT);
      expect(initialPaymentStatus(method)).toBe('pending');
      expect(coloniaEnrollPayReady({ method, amount: NO_SOCIO.total }).ok).toBe(false);
      const checked = validateColoniaPaymentInput({
        method,
        amount: NO_SOCIO.total,
        enrollmentId: ENROLLMENT,
      });
      expect(checked.ok).toBe(false);
      expect(checked.errors.some((error) => error.code === 'card_confirmation_required')).toBe(true);
    }
  });

  it('confirmado acredita el capital de no socio en tarjetas a cobrar', () => {
    for (const method of ['tarjeta', 'pos']) {
      const ready = coloniaEnrollPayReady({
        method,
        amount: NO_SOCIO.total,
        operatorConfirmed: true,
      });
      expect(ready).toEqual({ ok: true, status: 'confirmed', message: '' });
      const row = draft(method, { operatorConfirmed: true });
      expect(row.status).toBe('confirmed');
      expect(row.amount).toBe(230000);
      expect(row.bankId).toBeNull();
      expect(row.affectsSocialDues).toBe(false);
    }
    expect(coloniaMethodLabel('pos')).toBe('Pago POS');
    expect(coloniaMethodLabel('tarjeta')).toBe('Pago POS');
    expect(receipt('tarjeta').method).toBe('Pago POS');
    expect(receipt('pos').method).toBe('Pago POS');
  });

  it('el cupón de contado no inventa financiación sobre la cuota social', () => {
    const quoted = quoteColoniaPos({
      amount: NO_SOCIO.total,
      plans: DEFAULT_PAYMENT_PLANS,
      planId: 'visa-contado',
      confirmed: true,
    });
    expect(quoted.ok).toBe(true);
    expect(quoted.quote.financingBase).toBe(230000);
    expect(quoted.quote.surchargeAmount).toBe(0);
    expect(quoted.quote.financingAmount).toBe(0);
  });

  it('un plan con interés pide confirmar el total del cupón', () => {
    const open = quoteColoniaPos({
      amount: 180000,
      plans: DEFAULT_PAYMENT_PLANS,
      planId: 'visa-3',
      percent: 10,
    });
    expect(open.ok).toBe(false);
    expect(open.message).toMatch(/cupón/i);
    expect(open.quote.financingAmount).toBe(18000);
    const closed = quoteColoniaPos({
      amount: 180000,
      plans: DEFAULT_PAYMENT_PLANS,
      planId: 'visa-3',
      percent: 10,
      confirmed: true,
    });
    expect(closed.ok).toBe(true);
    expect(closed.quote.voucherTotal).toBe(198000);
  });

  it('reparte la financiación de un cupón entre dos alumnos', () => {
    const closed = quoteColoniaPos({
      amount: 360000,
      plans: DEFAULT_PAYMENT_PLANS,
      planId: 'visa-3',
      percent: 10,
      confirmed: true,
    });
    const parts = splitColoniaPosMeta(closed.meta, [180000, 180000]);
    expect(parts).toHaveLength(2);
    expect(parts[0].baseAmount).toBe(180000);
    expect(parts[1].baseAmount).toBe(180000);
    expect(parts[0].financingAmount + parts[1].financingAmount).toBe(36000);
    expect(parts[0].voucherTotal + parts[1].voucherTotal).toBe(396000);
  });

  it('sin plan de tarjeta no arma el cupón', () => {
    const missing = quoteColoniaPos({
      amount: NO_SOCIO.total,
      plans: DEFAULT_PAYMENT_PLANS,
      planId: 'no-existe',
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toMatch(/plan/i);
  });
});

describe('Mercado Pago', () => {
  it('no se carga a mano ni como cuota social', () => {
    expect(coloniaMethodUsesCash('mercadopago')).toBe(false);
    expect(coloniaMethodUsesCard('mercadopago')).toBe(false);
    expect(coloniaSettlementAccount('mercadopago')).toBe('Mercado Pago');
    expect(initialPaymentStatus('mercadopago')).toBe('pending');
    expect(coloniaEnrollPayReady({ method: 'mercadopago', amount: NO_SOCIO.total }).ok).toBe(false);
    const checked = validateColoniaPaymentInput({
      method: 'mercadopago',
      amount: NO_SOCIO.total,
      enrollmentId: ENROLLMENT,
    });
    expect(checked.ok).toBe(false);
    expect(checked.errors.some((error) => error.code === 'mp_adapter_pending')).toBe(true);
    expect(() => draft('mercadopago')).toThrow(/mercado pago/i);
  });

  it('cuando Mercado Pago confirma, el alta queda acreditada', () => {
    const ready = coloniaEnrollPayReady({
      method: 'mercadopago',
      amount: NO_SOCIO.total,
      mpApproved: true,
    });
    expect(ready).toEqual({ ok: true, status: 'confirmed', message: '' });
    expect(receipt('mercadopago').method).toBe('Mercado Pago');
  });

  it('el checkout cobra el saldo abierto y no un pago que ya está pendiente', () => {
    expect(coloniaMpPayable(230000, 0)).toBe(230000);
    expect(coloniaMpPayable(230000, 50000)).toBe(180000);
    expect(coloniaMpPayable(230000, 230000)).toBe(0);
    expect(coloniaMpPayable(100, 250)).toBe(0);
    expect(coloniaMpPayable(Number.NaN, 10)).toBe(0);
  });

  it('el adaptador no usa el cobro de cuota social', () => {
    const spec = coloniaMercadoPagoAdapterSpec();
    expect(spec.kind).toBe('colonia');
    expect(spec.forbidden.join(' ')).toMatch(/dues|registrar_cobro|pending/i);
    expect(spec.requires.join(' ')).toMatch(/outstanding_balance/);
    expect(spec.requires.join(' ')).toMatch(/4\.1\.06/);
  });
});

describe('medios que no corresponden', () => {
  it('rechaza un medio desconocido, el mixto y un pago sin inscripción', () => {
    for (const method of ['mixto', 'crypto', '', 'cuenta']) {
      const checked = validateColoniaPaymentInput({
        method,
        amount: NO_SOCIO.total,
        enrollmentId: ENROLLMENT,
      });
      expect(checked.ok).toBe(false);
      expect(checked.errors.some((error) => error.code === 'method_unknown')).toBe(true);
      expect(coloniaEnrollPayReady({ method, amount: NO_SOCIO.total }).ok).toBe(false);
    }
    const loose = validateColoniaPaymentInput({
      method: 'efectivo',
      amount: NO_SOCIO.total,
    });
    expect(loose.ok).toBe(false);
    expect(loose.errors.some((error) => error.code === 'enrollment_required')).toBe(true);
  });

  it('ningún medio habilitado puede imputar a la cuota social', () => {
    const cases = [
      ['efectivo', {}],
      ['transferencia', { externalReference: 'TR-1' }],
      ['debito', { externalReference: 'DB-1' }],
      ['tarjeta', { operatorConfirmed: true }],
      ['pos', { operatorConfirmed: true }],
    ];
    for (const [method, extra] of cases) {
      const row = draft(method, extra);
      expect(row.affectsSocialDues).toBe(false);
      expect(row.affectsMemberOutstandingBalance).toBe(false);
      expect(row.imputeTo).toBe('colonia');
      expect(row.amount).toBe(NO_SOCIO.total);
      expect(row.amount).not.toBe(SOCIO.total);
    }
  });
});
