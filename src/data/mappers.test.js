import { describe, expect, it } from 'vitest';
import {
  memberFromRow,
  memberToRow,
  reservationFromRow,
  reservationOccupancyFromRow,
  reservationToRow,
  messageFromRow,
  accountFromRow,
  journalFromRow,
  paymentFromRow,
} from './mappers';

describe('mappers', () => {
  it('member round-trip keeps memberId and balance', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      member_number: '2026887744320988',
      full_name: 'Alejandro Chávez',
      phone: '+5492645551234',
      tier: 'socio_familiar',
      status: 'active',
      outstanding_balance: 32000,
      years_active: 5,
      joined_at: '2021-04-10',
      disciplines: ['Tenis'],
      member_adherents: [
        {
          id: 'a1',
          full_name: 'Sofía',
          relationship: 'Hijo/a',
          tier: 'socio_familiar',
          status: 'active',
          outstanding_balance: 0,
          disciplines: [],
        },
      ],
      meta: {},
    };
    const ui = memberFromRow(row, []);
    expect(ui.memberId).toBe('2026887744320988');
    expect(ui.outstandingBalance).toBe(32000);
    expect(ui.adherents).toHaveLength(1);

    const back = memberToRow(ui);
    expect(back.member_number).toBe('2026887744320988');
    expect(back.outstanding_balance).toBe(32000);
    expect(back.full_name).toBe('Alejandro Chávez');
  });

  it('conserva la adhesión de Mercado Pago al guardar la ficha', () => {
    const ui = memberFromRow({
      member_number: '1001',
      full_name: 'Socio Adherido',
      tier: 'socio_familiar',
      status: 'active',
      outstanding_balance: 0,
      joined_at: '2020-01-01',
      meta: { mpAdhesion: 'authorized' },
    }, []);
    expect(ui.mpAdhesion).toBe('authorized');
    expect(memberToRow(ui).meta.mpAdhesion).toBe('authorized');
  });

  it('reescribe tiers inventados usando cuotaCategories', () => {
    const ui = memberFromRow({
      id: '11111111-1111-1111-1111-111111111112',
      member_number: '100547',
      full_name: 'Abel Test',
      tier: 'socio_individual_abono_tenis',
      status: 'active',
      outstanding_balance: 0,
      years_active: 1,
      joined_at: '2020-01-01',
      meta: { cuotaCategories: ['SOCIO INDIVIDUAL, ABONO TENIS'] },
    }, []);
    expect(ui.tier).toBe('socio_individual');
  });

  it('toma familia y cuota desde extractos de meta', () => {
    const ui = memberFromRow({
      member_number: '3501',
      full_name: 'Milagros Rojo',
      tier: 'grupo_familiar_familiar',
      status: 'active',
      outstanding_balance: 0,
      family_principal: 10009,
      family_group_name: 'GF - Rojo',
      cuota_categories: ['GRUPO FAMILIAR (Familiar)'],
      meta: {
        familyPrincipalNumber: 10009,
        familyGroupName: 'GF - Rojo',
        cuotaCategories: ['GRUPO FAMILIAR (Familiar)'],
      },
    }, []);
    expect(ui.recordScope).toBe('list');
    expect(ui.familyPrincipalNumber).toBe(10009);
    expect(ui.familyGroupName).toBe('GF - Rojo');
  });

  it('toma lastPaymentDate de meta sin pisar nombre ni saldo', () => {
    const ui = memberFromRow({
      member_number: '2026887744320988',
      full_name: 'Alejandro Chávez',
      tier: 'socio_individual',
      status: 'active',
      outstanding_balance: 96000,
      years_active: 5,
      joined_at: '2021-04-10',
      next_due_date: '2026-07-10',
      meta: {
        lastPaymentDate: '2026-06-14',
        name: 'NO SOBREESCRIBIR',
        outstandingBalance: 1,
      },
    }, []);
    expect(ui.name).toBe('Alejandro Chávez');
    expect(ui.outstandingBalance).toBe(96000);
    expect(ui.lastPaymentDate).toBe('2026-06-14');
    expect(ui.joinDate).toBe('2021-04-10');
  });

  it('marca padrón slim si no vino la columna de domicilio', () => {
    const ui = memberFromRow({
      member_number: '100001',
      full_name: 'Lista Slim',
      tier: 'socio_individual',
      status: 'active',
      outstanding_balance: 0,
      birth_date: '1990-04-12',
      credential_token: 'aabbccddeeff00112233445566778899',
    }, []);
    expect(ui.recordScope).toBe('list');
    expect(ui.credentialToken).toBe('aabbccddeeff00112233445566778899');
    expect(ui.address).toBe('');
    expect(ui.birthDate).toBe('1990-04-12');
  });

  it('marca ficha completa si vino domicilio, aunque esté vacío', () => {
    const ui = memberFromRow({
      member_number: '100001',
      full_name: 'Ficha vacía',
      status: 'active',
      address: null,
      birth_date: null,
    }, []);
    expect(ui.recordScope).toBe('full');
    expect(ui.address).toBe('');
  });

  it('mapea ocupación de cancha sin nombre', () => {
    const ui = reservationOccupancyFromRow({
      id: 'occ-1',
      facility_id: 'tenis_trad',
      reservation_date: '2026-09-09',
      time_slot: '17:00',
      status: 'confirmed',
      guests: 1,
      created_at: '2026-09-09T12:00:00Z',
    });
    expect(ui.occupancyOnly).toBe(true);
    expect(ui.memberName).toBeNull();
    expect(ui.memberId).toBeNull();
  });

  it('maps reservation facility and time slot', () => {
    const ui = reservationFromRow({
      id: 'r1',
      facility_id: 'tenis_trad',
      member_number: '123',
      member_name: 'Test',
      reservation_date: '2026-07-01',
      time_slot: '10:00',
      status: 'confirmed',
      guests: 1,
      meta: { facilityName: 'Tenis', guestNames: 'Ana' },
    });
    expect(ui.facilityId).toBe('tenis_trad');
    expect(ui.time).toBe('10:00');
    expect(ui.guestNames).toBe('Ana');

    const row = reservationToRow(ui, 'm-db');
    expect(row.facility_id).toBe('tenis_trad');
    expect(row.time_slot).toBe('10:00');
    expect(row.member_id).toBe('m-db');
  });

  it('round-trip de imputación de salón en meta', () => {
    const ui = reservationFromRow({
      id: 'r-evt',
      facility_id: 'salon_maurin',
      member_number: '13028',
      member_name: 'Test',
      reservation_date: '2026-08-30',
      time_slot: '20:00',
      status: 'confirmed',
      guests: 10,
      meta: {
        facilityName: 'Salón Maurin',
        estimatedPrice: 130000,
        imputed: true,
        chargedPrice: 130000,
        imputationEntryId: 'mae-evt-r-evt',
      },
    });
    expect(ui.imputed).toBe(true);
    expect(ui.chargedPrice).toBe(130000);
    const row = reservationToRow(ui);
    expect(row.meta.imputed).toBe(true);
    expect(row.meta.chargedPrice).toBe(130000);
  });

  it('maps message body/content', () => {
    const ui = messageFromRow({
      id: 'msg1',
      sender_name: 'Admin',
      sender_key: 'ops',
      recipient_key: 'all',
      subject: 'Hola',
      body: 'Contenido',
      is_read: false,
      created_at: '2026-07-01T12:00:00Z',
    });
    expect(ui.content).toBe('Contenido');
    expect(ui.recipientId).toBe('all');
  });

  it('maps chart account and journal lines', () => {
    const acc = accountFromRow({
      id: 'aaaaaaaa-0001-0001-0001-000000000111',
      code: '1.1.01',
      name: 'Caja General',
      account_type: 'asset',
      parent_id: null,
      level: 3,
      is_postable: true,
      is_cash_account: true,
      is_active: true,
    });
    expect(acc.id).toBe('aaaaaaaa-0001-0001-0001-000000000111');
    expect(acc.accountType).toBe('asset');

    const entry = journalFromRow(
      {
        id: 'j1',
        entry_date: '2026-07-01',
        concept: 'Cobro',
        status: 'posted',
        fiscal_period_id: 'fp',
      },
      [
        {
          id: 'l1',
          account_id: acc.id,
          debit: 100,
          credit: 0,
          line_order: 1,
        },
      ]
    );
    expect(entry.lines[0].debit).toBe(100);
    expect(entry.concept).toBe('Cobro');
  });

  it('paymentFromRow conserva importe y comprobante', () => {
    const pay = paymentFromRow({
      id: 'p1',
      member_id: 'm1',
      amount: '32000.00',
      paid_at: '2026-08-13',
      method: 'caja',
      concept: 'Cuota social',
      receipt_number: 'RC-0988-260813',
    });
    expect(pay.amount).toBe(32000);
    expect(pay.receipt).toBe('RC-0988-260813');
    expect(pay.date).toBe('2026-08-13');
    expect(pay.createdAt).toBeNull();
  });

  it('paymentFromRow conserva hora de registro y banco', () => {
    const pay = paymentFromRow({
      id: 'p2',
      member_id: 'm1',
      amount: 66000,
      paid_at: '2026-10-01',
      created_at: '2026-10-01T17:57:51.952Z',
      method: 'transferencia',
      concept: 'Cuota social',
      receipt_number: 'RC-1',
      meta: { bank: 'Banco de San Juan', paidAt: '2026-10-01T17:57:51.952Z', time: '14:57' },
    });
    expect(pay.date).toBe('2026-10-01');
    expect(pay.time).toBe('14:57');
    expect(pay.paidAt).toBe('2026-10-01T17:57:51.952Z');
    expect(pay.createdAt).toBe('2026-10-01T17:57:51.952Z');
    expect(pay.bankName).toBe('Banco de San Juan');
  });

  it('paymentFromRow conserva el comprobante de Storage', () => {
    const pay = paymentFromRow({
      id: 'p3',
      member_id: 'm1',
      amount: 70000,
      paid_at: '2026-10-22',
      method: 'transferencia',
      concept: 'Cuota social',
      receipt_number: 'RC-2',
      period_label: 'Agosto de 2026',
      meta: {
        receiptName: 'transfer.jpg',
        receiptPath: '8801/xyz.jpg',
        receiptBucket: 'dues-receipts',
        receiptMime: 'image/jpeg',
        receiptSize: 2048,
        periodDueOns: ['2026-08-10'],
      },
    });
    expect(pay.receiptName).toBe('transfer.jpg');
    expect(pay.receiptPath).toBe('8801/xyz.jpg');
    expect(pay.receiptAttachment.path).toBe('8801/xyz.jpg');
    expect(pay.periodDueOns).toEqual(['2026-08-10']);
  });

  it('paymentFromRow conserva plan de tarjeta y desglose Gemini', () => {
    const pay = paymentFromRow({
      id: 'p4',
      member_id: 'm1',
      amount: 39600,
      paid_at: '2026-10-22',
      method: 'tarjeta',
      concept: 'Cuota social',
      receipt_number: 'RC-3',
      meta: {
        paymentPlanId: 'visa-3',
        paymentPlanLabel: 'Visa 3 cuotas',
        receiptParse: { amount: 39600, bankOrCard: 'Visa', reference: 'OP-9' },
      },
    });
    expect(pay.paymentPlanId).toBe('visa-3');
    expect(pay.paymentPlanLabel).toBe('Visa 3 cuotas');
    expect(pay.receiptParse.reference).toBe('OP-9');
  });

  it('paymentFromRow conserva líneas de pago mixto', () => {
    const pay = paymentFromRow({
      id: 'p5',
      member_id: 'm1',
      amount: 50000,
      paid_at: '2026-10-22',
      method: 'mixto',
      concept: 'Cuota social',
      meta: {
        paymentSplits: [
          { method: 'efectivo', amount: 20000 },
          { method: 'transferencia', amount: 30000, bankName: 'Banco Nación' },
        ],
      },
    });
    expect(pay.paymentSplits).toHaveLength(2);
    expect(pay.paymentSplits[1].amount).toBe(30000);
  });
});
