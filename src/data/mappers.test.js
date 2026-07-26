import { describe, expect, it } from 'vitest';
import {
  memberFromRow,
  memberToRow,
  reservationFromRow,
  reservationToRow,
  messageFromRow,
  accountFromRow,
  journalFromRow,
} from './mappers';

describe('mappers', () => {
  it('member round-trip keeps memberId and balance', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      member_number: '2026887744320988',
      full_name: 'Alejandro Chávez',
      phone: '+5492645551234',
      tier: 'royal',
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
          tier: 'royal',
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
});
