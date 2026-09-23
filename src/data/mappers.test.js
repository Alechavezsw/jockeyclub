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

  it('marca padrón slim si no vinieron domicilio ni fecha de nacimiento', () => {
    const ui = memberFromRow({
      member_number: '100001',
      full_name: 'Lista Slim',
      tier: 'socio_individual',
      status: 'active',
      outstanding_balance: 0,
      credential_token: 'aabbccddeeff00112233445566778899',
    }, []);
    expect(ui.recordScope).toBe('list');
    expect(ui.credentialToken).toBe('aabbccddeeff00112233445566778899');
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
  });
});
