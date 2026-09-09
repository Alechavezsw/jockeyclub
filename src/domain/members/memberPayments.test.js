import { describe, expect, it } from 'vitest';
import { payMemberDues, persistDuesCollection, recordDuesCollection } from './memberPayments';

describe('payMemberDues', () => {
  it('clears debt and appends payment history', () => {
    const member = {
      memberId: '2026887744320988',
      name: 'Test',
      tier: 'gold',
      outstandingBalance: 32000,
      nextDueDate: '2026-06-01',
      paymentHistory: [],
    };
    const { member: next, payment, fullyPaid, ledgerEntry } = payMemberDues(member, {
      method: 'mercadopago',
      today: new Date('2026-07-24T12:00:00'),
    });
    expect(fullyPaid).toBe(true);
    expect(next.outstandingBalance).toBe(0);
    expect(next.paymentHistory[0].id).toBe(payment.id);
    expect(payment.amount).toBe(32000);
    expect(next.lastPaymentDate).toBe('2026-07-24');
    expect(next.nextDueDate > '2026-06-01').toBe(true);
    expect(ledgerEntry.type).toBe('pago');
    expect(ledgerEntry.value).toBe(-32000);
  });

  it('recordDuesCollection acredita efectivo y deja asiento + diario', () => {
    const member = {
      memberId: '1004',
      name: 'Cristina Mugas',
      outstandingBalance: 56000,
      nextDueDate: '2026-08-01',
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.member.outstandingBalance).toBe(0);
    expect(result.payment.method).toBe('efectivo');
    expect(result.journalEntry.lines[0].account).toBe('Caja General');
    expect(result.ledgerEntry.value).toBe(-56000);
    expect(result.payment.receiptNumber).toMatch(/^RC-/);
  });

  it('recordDuesCollection exige comprobante en transferencia', () => {
    const member = { memberId: '11017', name: 'Socio', outstandingBalance: 1000, paymentHistory: [] };
    expect(() => recordDuesCollection(member, { method: 'transferencia' }))
      .toThrow(/comprobante/i);
  });

  it('recordDuesCollection registra transferencia con banco y comprobante', () => {
    const member = {
      memberId: '11017',
      name: 'Socio',
      outstandingBalance: 1000,
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'transferencia',
      bankId: 'nacion',
      bankName: 'Banco Nación',
      receiptName: 'comprobante.pdf',
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.payment.receiptName).toBe('comprobante.pdf');
    expect(result.journalEntry.lines[0].account).toBe('Banco Nación');
    expect(result.journalEntry.description).toMatch(/Comp: comprobante.pdf/);
  });

  it('persistDuesCollection actualiza padrón, ledger y diario', () => {
    const member = {
      memberId: '9',
      name: 'Ana',
      outstandingBalance: 2000,
      paymentHistory: [],
    };
    const members = [member];
    const result = recordDuesCollection(member, {
      method: 'mercadopago',
      today: new Date('2026-09-05T12:00:00'),
    });
    const ledger = [];
    const journal = [];
    persistDuesCollection(result, {
      setMembers: (fn) => { members.splice(0, members.length, ...fn(members)); },
      onAccountEntry: (entry) => ledger.push(entry),
      addJournalEntry: (entry) => journal.push(entry),
    });
    expect(members[0].outstandingBalance).toBe(0);
    expect(ledger[0].type).toBe('pago');
    expect(journal[0].sourceModule).toBe('cuotas');
  });
});
