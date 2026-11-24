import { describe, expect, it, vi } from 'vitest';
import {
  buildColoniaMpIntentDraft,
  validateColoniaMpWebhookPayload,
  isColoniaMpLive,
  coloniaMpEdgePatchSpec,
} from './coloniaMp';
import {
  assertExternalGuardianDraft,
  canExternalGuardianOperate,
  validateExternalEnrollmentDraft,
} from './coloniaExternal';
import {
  buildColoniaReceiptDeliveryPayload,
  deliverColoniaPaymentReceipt,
  shouldDeliverColoniaReceipt,
} from './coloniaReceipts';
import {
  buildColoniaNotificationJob,
  coloniaNotificationRetryPlan,
  COLONIA_NOTIFICATION_KINDS,
} from './coloniaCommunications';
import { validateColoniaPaymentInput, COLONIA_MP_KIND } from './coloniaPayments';
import { deliverPaymentReceipt } from '../payments/deliverPaymentReceipt';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';

describe('colonia completar — MP simulado', () => {
  it('rechaza intent MP Colonia si live=false', () => {
    const r = buildColoniaMpIntentDraft({
      enrollmentId: 'enr-1',
      amount: 150000,
      live: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'mp_colonia_disabled')).toBe(true);
    expect(r.draft.affectsMemberOutstandingBalance).toBe(false);
    expect(r.draft.kind).toBe(COLONIA_MP_KIND);
  });

  it('arma intent válido solo con live', () => {
    const r = buildColoniaMpIntentDraft({
      enrollmentId: 'enr-1',
      amount: 150000,
      currency: 'ARS',
      live: true,
      chargeIds: ['c1'],
    });
    expect(r.ok).toBe(true);
    expect(r.draft.imputeTo).toBe('colonia');
  });

  it('rechaza moneda no ARS', () => {
    const r = buildColoniaMpIntentDraft({
      enrollmentId: 'enr-1',
      amount: 10,
      currency: 'USD',
      live: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'currency_invalid')).toBe(true);
  });

  it('webhook: firma inválida / timestamp / importe / moneda / estado', () => {
    const intent = {
      id: 'i1',
      kind: 'colonia',
      amount: 100,
      meta: { enrollment_id: 'enr-1' },
    };
    expect(validateColoniaMpWebhookPayload({
      intent,
      providerPaymentId: 'mp-1',
      amount: 100,
      currency: 'ARS',
      status: 'approved',
      signatureValid: false,
      timestampFresh: true,
    }).ok).toBe(false);

    expect(validateColoniaMpWebhookPayload({
      intent,
      providerPaymentId: 'mp-1',
      amount: 100,
      currency: 'ARS',
      status: 'approved',
      signatureValid: true,
      timestampFresh: false,
    }).errors.some((e) => e.code === 'timestamp_stale')).toBe(true);

    expect(validateColoniaMpWebhookPayload({
      intent,
      providerPaymentId: 'mp-1',
      amount: 50,
      currency: 'ARS',
      status: 'approved',
      signatureValid: true,
      timestampFresh: true,
    }).errors.some((e) => e.code === 'amount_mismatch')).toBe(true);

    expect(validateColoniaMpWebhookPayload({
      intent,
      providerPaymentId: 'mp-1',
      amount: 100,
      currency: 'USD',
      status: 'approved',
      signatureValid: true,
      timestampFresh: true,
    }).errors.some((e) => e.code === 'currency_invalid')).toBe(true);

    expect(validateColoniaMpWebhookPayload({
      intent,
      providerPaymentId: 'mp-1',
      amount: 100,
      currency: 'ARS',
      status: 'rejected',
      signatureValid: true,
      timestampFresh: true,
    }).errors.some((e) => e.code === 'status_not_approved')).toBe(true);
  });

  it('webhook approved válido no toca cuota social', () => {
    const credit = validateColoniaMpWebhookPayload({
      intent: { id: 'i1', kind: 'colonia', amount: 200, meta: { enrollment_id: 'e1' } },
      providerPaymentId: 'mp-9',
      amount: 200,
      currency: 'ARS',
      status: 'approved',
      signatureValid: true,
      timestampFresh: true,
    });
    expect(credit.ok).toBe(true);
    expect(credit.credit.affectsSocialDues).toBe(false);
  });

  it('flag live y edge spec', () => {
    expect(isColoniaMpLive({ enabled: false })).toBe(false);
    expect(isColoniaMpLive({ enabled: true })).toBe(true);
    expect(coloniaMpEdgePatchSpec().liveDefault).toBe(false);
    expect(coloniaMpEdgePatchSpec().mpWebhook.neverCall).toContain('registrar_cobro');
  });

  it('validateColoniaPaymentInput bloquea mercadopago sin live', () => {
    const r = validateColoniaPaymentInput({
      method: 'mercadopago',
      amount: 1000,
      enrollmentId: 'e1',
      coloniaMpLive: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('mp_adapter_pending');
  });
});

describe('colonia completar — externo', () => {
  it('valida responsable externo sin crear member', () => {
    const r = assertExternalGuardianDraft({
      fullName: 'Ana Externa',
      email: 'ana@example.com',
      phone: '2644000000',
    });
    expect(r.ok).toBe(true);
    expect(r.draft.createsMember).toBe(false);
    expect(r.draft.memberId).toBeNull();
  });

  it('exige correo verificado para operar', () => {
    expect(canExternalGuardianOperate({ guardian: { id: 'g1', status: 'pending_verification' } })).toBe(false);
    expect(canExternalGuardianOperate({
      guardian: { id: 'g1', status: 'pending_verification', email_verified_at: '2026-11-01' },
    })).toBe(true);
  });

  it('rechaza alumno duplicado, edad fuera de rango y kind socio', () => {
    const base = {
      student: {
        fullName: 'Juan',
        birthDate: '2014-06-01',
        documentNumber: '50111222',
        memberKind: 'no_socio',
      },
      guardian: { id: 'g1', status: 'active' },
      planKey: 'cuota',
      season: COLONIA_SEASON_2026_2027,
      todayIso: '2026-11-25',
      emailVerified: true,
    };
    expect(validateExternalEnrollmentDraft(base).ok).toBe(true);

    expect(validateExternalEnrollmentDraft({
      ...base,
      existingKeys: ['dni:50111222'],
    }).errors.some((e) => e.code === 'duplicate')).toBe(true);

    expect(validateExternalEnrollmentDraft({
      ...base,
      student: { ...base.student, birthDate: '2024-01-01' },
    }).ok).toBe(false);

    expect(validateExternalEnrollmentDraft({
      ...base,
      student: { ...base.student, memberKind: 'socio' },
    }).errors.some((e) => e.code === 'member_kind')).toBe(true);

    expect(validateExternalEnrollmentDraft({
      ...base,
      todayIso: '2025-01-01',
    }).errors.some((e) => e.code === 'window')).toBe(true);
  });
});

describe('colonia completar — comprobantes y comunicaciones', () => {
  it('no reenvía comprobante ya entregado', () => {
    expect(shouldDeliverColoniaReceipt({ status: 'confirmed', receipt_delivered_at: '2026-01-01' })).toBe(false);
    expect(shouldDeliverColoniaReceipt({ status: 'pending' })).toBe(false);
    expect(shouldDeliverColoniaReceipt({ status: 'confirmed' })).toBe(true);
  });

  it('build delivery dry-run sin datos de salud', async () => {
    const jobs = [];
    const result = await deliverColoniaPaymentReceipt({
      payment: { id: 'p1', status: 'confirmed', amount: 50000, enrollment_id: 'e1' },
      student: { fullName: 'Alumno' },
      guardian: { email: 'a@example.com', memberNumber: '1200' },
      season: COLONIA_SEASON_2026_2027,
      dryRun: true,
      enqueueNotification: async (j) => { jobs.push(j); },
    });
    expect(result.dryRun).toBe(true);
    expect(result.emailed).toBe(false);
    expect(jobs.length).toBe(2);
    expect(buildColoniaReceiptDeliveryPayload({
      payment: { id: 'p1', status: 'confirmed', amount: 1 },
      guardian: { email: 'x@y.com' },
    }).fiscalClaim).toBe(false);
  });

  it('cola de notificaciones con idempotencia y sin salud', () => {
    expect(COLONIA_NOTIFICATION_KINDS).toContain('pago_confirmado');
    const job = buildColoniaNotificationJob({
      kind: 'solicitud_recibida',
      enrollmentId: 'e1',
      recipientEmail: 'a@b.com',
      payload: { health: 'secreto', allergies: 'x', note: 'ok' },
      dryRun: true,
    });
    expect(job.status).toBe('dry_run');
    expect(job.sendRealEmail).toBe(false);
    expect(job.payload.health).toBeUndefined();
    expect(job.payload.allergies).toBeUndefined();
    expect(coloniaNotificationRetryPlan({ attempts: 0 }).retry).toBe(true);
    expect(coloniaNotificationRetryPlan({ attempts: 5 }).retry).toBe(false);
  });

  it('deliverPaymentReceipt kind=colonia no usa cuota social', async () => {
    const result = await deliverPaymentReceipt({
      kind: 'colonia',
      payment: { id: 'p2', status: 'confirmed', amount: 10 },
      colonia: {
        student: { fullName: 'A' },
        guardian: { email: 'ok@example.com' },
        dryRun: true,
        enqueueNotification: vi.fn(),
      },
    });
    expect(result.dryRun).toBe(true);
    expect(result.reason).toBe('dry_run');
  });
});
