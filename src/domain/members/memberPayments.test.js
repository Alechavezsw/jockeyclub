import { describe, expect, it } from 'vitest';
import {
  applyImportedMemberPayment,
  collectionPreview,
  isDuesCollectionJournal,
  journalEntryBelongsToMember,
  normalizePaymentSplits,
  payMemberDues,
  persistDuesCollection,
  recordDuesCollection,
  removeDuesSurcharge,
  validatePaymentSplits,
  voidMemberDuesPayment,
} from './memberPayments';

describe('journal de cuota en la ficha', () => {
  const cobro = {
    description: 'Cobro cuota social (Caja) - Socio: Nahuel Maresca (Cred. 244346)',
    sourceModule: 'cuotas',
    memberId: '244346',
  };

  it('no muestra el asiento de caja en la ficha del socio', () => {
    expect(isDuesCollectionJournal(cobro)).toBe(true);
    expect(journalEntryBelongsToMember(cobro, { memberId: '244346' })).toBe(true);
  });

  it('un número más corto no hereda el cobro de otra credencial', () => {
    expect(journalEntryBelongsToMember(cobro, { memberId: '244', name: 'Otro' })).toBe(false);
    expect(journalEntryBelongsToMember(cobro, { memberId: '346', name: 'Caja' })).toBe(false);
  });
});

describe('payMemberDues', () => {
  it('cobra con importe explícito aunque el saldo guardado sea 0', () => {
    const member = {
      memberId: '2026887744320988',
      name: 'Test',
      outstandingBalance: 0,
      paymentHistory: [],
    };
    const { payment, fullyPaid } = payMemberDues(member, {
      method: 'caja',
      amount: 32000,
      today: new Date('2026-09-21T12:00:00'),
    });
    expect(fullyPaid).toBe(true);
    expect(payment.amount).toBe(32000);
  });

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
    expect(payment.time).toMatch(/^\d{2}:\d{2}$/);
    expect(payment.paidAt).toBeTruthy();
    expect(next.nextDueDate > '2026-06-01').toBe(true);
    expect(ledgerEntry.type).toBe('pago');
    expect(ledgerEntry.value).toBe(-32000);
  });

  it('cobra solo los meses marcados y deja el resto pendiente', () => {
    const member = {
      memberId: '8801',
      name: 'Con mora',
      tier: 'socio_familiar',
      outstandingBalance: 210000,
      nextDueDate: '2026-08-10',
      lastPaymentDate: '2026-07-08',
      paymentHistory: [],
    };
    const today = new Date('2026-10-22T12:00:00');
    const preview = collectionPreview(member, today);
    expect(preview.choices.length).toBeGreaterThan(1);
    const first = preview.choices[0];
    const rest = preview.choices.slice(1);
    const marked = collectionPreview(member, today, { periodDueOns: [first.dueOn] });
    expect(marked.cash).toBe(first.payable);
    expect(marked.periods).toHaveLength(1);

    const { member: next, payment, fullyPaid } = payMemberDues(member, {
      method: 'efectivo',
      today,
      periodDueOns: [first.dueOn],
    });
    expect(fullyPaid).toBe(false);
    expect(payment.amount).toBe(first.payable);
    expect(payment.periodDueOns).toEqual([first.dueOn]);
    expect(next.outstandingBalance).toBe(
      rest.reduce((sum, row) => sum + row.capital, 0),
    );
    expect(next.nextDueDate).toBe(rest[0].dueOn);
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

  it('no cobra cuota a vitalicio', () => {
    expect(() => recordDuesCollection({
      memberId: '1622',
      name: 'Vitalicia',
      tier: 'socio_vitalicio',
      outstandingBalance: 32000,
      paymentHistory: [],
    }, { method: 'efectivo' })).toThrow(/no abona cuota social/i);
  });

  it('no cobra cuota a fundador ni a comisión', () => {
    expect(() => recordDuesCollection({
      memberId: '9001',
      name: 'Fundador',
      tier: 'fundador',
      outstandingBalance: 1000,
      paymentHistory: [],
    }, { method: 'efectivo' })).toThrow(/no abona cuota social/i);
    expect(() => recordDuesCollection({
      memberId: '8377',
      name: 'Presidente',
      tier: 'comision',
      outstandingBalance: 1000,
      paymentHistory: [],
    }, { method: 'efectivo' })).toThrow(/no abona cuota social/i);
  });

  it('validatePaymentSplits exige dos medios, suma y comprobantes', () => {
    expect(() => validatePaymentSplits(
      [{ method: 'efectivo', amount: 1000 }],
      1000,
    )).toThrow(/al menos dos medios/i);

    expect(() => validatePaymentSplits([
      { method: 'efectivo', amount: 400 },
      { method: 'efectivo', amount: 400 },
    ], 1000)).toThrow(/suman/i);

    expect(() => validatePaymentSplits([
      { method: 'efectivo', amount: 500 },
      { method: 'transferencia', amount: 500, bankId: 'nacion', bankName: 'Banco Nación' },
    ], 1000)).toThrow(/comprobante de la transferencia/i);

    const ok = validatePaymentSplits([
      { method: 'efectivo', amount: 500 },
      {
        method: 'transferencia',
        amount: 500,
        bankId: 'nacion',
        bankName: 'Banco Nación',
        receiptName: 'tr.pdf',
        receiptAttachment: { path: '1/tr.pdf', bucket: 'dues-receipts', name: 'tr.pdf' },
      },
    ], 1000);
    expect(ok.splits).toHaveLength(2);
    expect(ok.total).toBe(1000);

    const treasury = validatePaymentSplits([
      { method: 'efectivo', amount: 400 },
      {
        method: 'tarjeta',
        amount: 600,
        receiptName: 'voucher.jpg',
      },
    ], 1000, { treasuryMatch: true });
    expect(treasury.total).toBe(1000);
  });

  it('normalizePaymentSplits descarta medios inválidos e importe 0', () => {
    const splits = normalizePaymentSplits([
      { method: 'efectivo', amount: 100 },
      { method: 'mercado_pago', amount: 50 },
      { method: 'transferencia', amount: 0 },
      { method: 'tarjeta', amount: 200, receiptName: 'v.jpg', receiptAttachment: { path: 'x', name: 'v.jpg' } },
    ]);
    expect(splits.map((s) => s.method)).toEqual(['efectivo', 'tarjeta']);
  });

  it('recordDuesCollection exige comprobante en transferencia', () => {
    const member = { memberId: '11017', name: 'Socio', outstandingBalance: 1000, paymentHistory: [] };
    expect(() => recordDuesCollection(member, { method: 'transferencia' }))
      .toThrow(/comprobante/i);
  });

  it('recordDuesCollection registra pago mixto con dos asientos de débito', () => {
    const member = {
      memberId: '11017',
      name: 'Socio',
      outstandingBalance: 39600,
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'mixto',
      amount: 39600,
      paymentSplits: [
        { method: 'efectivo', amount: 20000 },
        {
          method: 'transferencia',
          amount: 19600,
          bankId: 'nacion',
          bankName: 'Banco Nación',
          receiptName: 'tr.pdf',
          receiptAttachment: {
            path: '11017/tr.pdf',
            bucket: 'dues-receipts',
            name: 'tr.pdf',
            mimeType: 'application/pdf',
            size: 400,
          },
        },
      ],
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.payment.method).toBe('mixto');
    expect(result.payment.paymentSplits).toHaveLength(2);
    expect(result.journalEntry.lines.filter((l) => l.type === 'debit')).toEqual([
      { account: 'Caja General', type: 'debit', amount: 20000 },
      { account: 'Banco Nación', type: 'debit', amount: 19600 },
    ]);
    expect(result.journalEntry.lines.find((l) => l.type === 'credit')?.amount).toBe(39600);
  });

  it('pago mixto rechaza suma distinta al cobro', () => {
    const member = { memberId: '11017', name: 'Socio', outstandingBalance: 1000, paymentHistory: [] };
    expect(() => recordDuesCollection(member, {
      method: 'mixto',
      amount: 1000,
      paymentSplits: [
        { method: 'efectivo', amount: 400 },
        { method: 'efectivo', amount: 400 },
      ],
    })).toThrow(/suman/i);
  });

  it('recordDuesCollection exige comprobante en tarjeta y asienta en Caja General', () => {
    const member = { memberId: '11017', name: 'Socio', outstandingBalance: 1000, paymentHistory: [] };
    expect(() => recordDuesCollection(member, { method: 'tarjeta' }))
      .toThrow(/comprobante/i);
    const result = recordDuesCollection(member, {
      method: 'tarjeta',
      receiptName: 'voucher.jpg',
      receiptAttachment: {
        path: '11017/voucher.jpg',
        bucket: 'dues-receipts',
        name: 'voucher.jpg',
        mimeType: 'image/jpeg',
        size: 1200,
      },
      paymentPlanId: 'visa-3',
      paymentPlanLabel: 'Visa 3 cuotas',
      receiptParse: { amount: 1000, bankOrCard: 'Visa', reference: 'OP-1' },
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.payment.method).toBe('tarjeta');
    expect(result.payment.paymentPlanId).toBe('visa-3');
    expect(result.payment.paymentPlanLabel).toBe('Visa 3 cuotas');
    expect(result.payment.receiptParse?.reference).toBe('OP-1');
    expect(result.journalEntry.lines[0].account).toBe('Caja General');
    expect(result.payment.concept).toMatch(/Plan: Visa 3 cuotas/);
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
      receiptAttachment: {
        path: '11017/abc.pdf',
        bucket: 'dues-receipts',
        name: 'comprobante.pdf',
        mimeType: 'application/pdf',
        size: 900,
      },
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.payment.receiptName).toBe('comprobante.pdf');
    expect(result.payment.receiptPath).toBe('11017/abc.pdf');
    expect(result.journalEntry.lines[0].account).toBe('Banco Nación');
    expect(result.journalEntry.description).toMatch(/Comp: comprobante.pdf/);
  });

  it('transferencia sin archivo en Supabase no registra el cobro', () => {
    const member = { memberId: '11017', name: 'Socio', outstandingBalance: 1000, paymentHistory: [] };
    expect(() => recordDuesCollection(member, {
      method: 'transferencia',
      receiptName: 'solo-nombre.pdf',
    })).toThrow(/supabase/i);
  });

  it('transferencia desde Sin identificar entra directo como cuota', () => {
    const member = {
      memberId: '11017',
      name: 'Socio',
      outstandingBalance: 32000,
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'transferencia',
      bankId: 'nacion',
      bankName: 'Banco Nación',
      receiptName: 'REF-BANCO',
      treasuryMatch: true,
      amount: 32000,
      today: new Date('2026-09-05T12:00:00'),
    });
    expect(result.member.outstandingBalance).toBe(0);
    expect(result.payment.method).toBe('transferencia');
    expect(result.journalEntry.lines[0].account).toBe('Banco Nación');
    expect(result.journalEntry.lines[1].account).toBe('Cuotas Sociales');
  });

  it('el recargo se cobra siempre', () => {
    const member = {
      memberId: '1004',
      name: 'Paula',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 70000,
      nextDueDate: '2026-10-10',
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-10-20T12:00:00'),
    });
    expect(result.payment.quota).toBe(70000);
    expect(result.payment.surcharge).toBe(7000);
    expect(result.payment.amount).toBe(77000);
    expect(result.member.outstandingBalance).toBe(0);
  });

  it('un administrador borra el recargo cobrado y queda a favor', () => {
    const member = {
      memberId: '1004',
      name: 'Paula',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: 70000,
      nextDueDate: '2026-10-10',
      paymentHistory: [],
    };
    const charged = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-10-20T12:00:00'),
    });
    const removed = removeDuesSurcharge(charged.member, charged.payment.id, {
      removedBy: 'Administración',
    });
    expect(removed.payment.amount).toBe(77000);
    expect(removed.payment.surcharge).toBe(0);
    expect(removed.payment.removedSurcharge).toBe(7000);
    expect(removed.payment.surchargeRemovedBy).toBe('Administración');
    expect(removed.member.outstandingBalance).toBe(-7000);
  });

  it('el saldo a favor se imputa al próximo pago', () => {
    const member = {
      memberId: '1005',
      name: 'Nora',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: -7000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-13',
      paymentHistory: [],
    };
    const preview = collectionPreview(member, new Date('2026-10-22T12:00:00'));
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-10-22T12:00:00'),
    });
    expect(preview.creditApplied).toBe(7000);
    expect(result.payment.creditApplied).toBe(7000);
    expect(result.payment.amount).toBe(preview.cash);
    expect(result.payment.amount).toBe(preview.gross - 7000);
    expect(result.member.outstandingBalance).toBe(0);
    expect(result.journalEntry.lines[0].amount).toBe(result.payment.amount);
  });

  it('si el saldo a favor cubre la cuota, el resto queda', () => {
    const member = {
      memberId: '1006',
      name: 'Luis',
      tier: 'socio_familiar',
      cuotaCategories: ['SOCIO FAMILIAR'],
      outstandingBalance: -100000,
      nextDueDate: '2026-11-10',
      lastPaymentDate: '2026-10-13',
      paymentHistory: [],
    };
    const result = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-10-22T12:00:00'),
    });
    expect(result.payment.amount).toBe(0);
    expect(result.payment.creditApplied).toBeGreaterThan(0);
    expect(result.member.outstandingBalance).toBe(-(100000 - result.payment.creditApplied));
    expect(result.journalEntry).toBeNull();
  });

  it('si cobra un adherente, baja el saldo del titular', () => {
    const titular = {
      memberId: '10009',
      name: 'Titular',
      tier: 'socio_familiar',
      outstandingBalance: 70000,
      paymentHistory: [],
    };
    const hijo = {
      memberId: '3501',
      name: 'Hijo',
      familyPrincipalNumber: '10009',
      tier: 'grupo_familiar_familiar',
      outstandingBalance: 0,
      paymentHistory: [],
    };
    const result = recordDuesCollection(hijo, {
      method: 'efectivo',
      members: [titular, hijo],
      today: new Date('2026-10-20T12:00:00'),
    });
    expect(result.member.memberId).toBe('10009');
    expect(result.member.outstandingBalance).toBe(0);
    expect(result.payment.collectedFromMemberId).toBe('3501');
    expect(result.payment.quota).toBe(70000);
    expect(result.payment.amount).toBe(77000);
  });

  it('anula un cobro y deja el rastro', () => {
    const member = {
      memberId: '11017',
      name: 'Socio',
      outstandingBalance: 40000,
      nextDueDate: '2026-10-10',
      paymentHistory: [],
    };
    const charged = recordDuesCollection(member, {
      method: 'efectivo',
      today: new Date('2026-10-20T12:00:00'),
    });
    const voided = voidMemberDuesPayment(charged.member, charged.payment.id, {
      voidedBy: 'Paula',
      reason: 'Carga duplicada',
      today: new Date('2026-10-20T15:00:00'),
    });
    expect(voided.payment.status).toBe('void');
    expect(voided.payment.voidedBy).toBe('Paula');
    expect(voided.member.outstandingBalance).toBe(40000);
    expect(voided.member.paymentHistory[0].status).toBe('void');
    expect(voided.journalEntry.description).toMatch(/Anulación/);
  });

  it('anula un pago mixto revirtiendo cada medio a su cuenta', () => {
    const member = {
      memberId: '11017',
      name: 'Socio',
      outstandingBalance: 39600,
      paymentHistory: [],
    };
    const charged = recordDuesCollection(member, {
      method: 'mixto',
      amount: 39600,
      paymentSplits: [
        { method: 'efectivo', amount: 20000 },
        {
          method: 'transferencia',
          amount: 19600,
          bankId: 'nacion',
          bankName: 'Banco Nación',
          receiptName: 'tr.pdf',
          receiptAttachment: {
            path: '11017/tr.pdf',
            bucket: 'dues-receipts',
            name: 'tr.pdf',
            mimeType: 'application/pdf',
            size: 400,
          },
        },
      ],
      today: new Date('2026-09-05T12:00:00'),
    });
    const voided = voidMemberDuesPayment(charged.member, charged.payment.id, {
      voidedBy: 'Paula',
      today: new Date('2026-09-05T15:00:00'),
    });
    expect(voided.member.outstandingBalance).toBe(39600);
    expect(voided.journalEntry.lines.filter((l) => l.type === 'credit')).toEqual([
      { account: 'Caja General', type: 'credit', amount: 20000 },
      { account: 'Banco Nación', type: 'credit', amount: 19600 },
    ]);
    expect(voided.journalEntry.lines.find((l) => l.type === 'debit')?.amount).toBe(39600);
  });

  it('persistDuesCollection actualiza padrón, ledger y diario', async () => {
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
    await persistDuesCollection(result, {
      setMembers: (fn) => { members.splice(0, members.length, ...fn(members)); },
      onAccountEntry: (entry) => ledger.push(entry),
      addJournalEntry: (entry) => journal.push(entry),
    });
    expect(members[0].outstandingBalance).toBe(0);
    expect(ledger[0].type).toBe('pago');
    expect(journal[0].sourceModule).toBe('cuotas');
  });
});

describe('applyImportedMemberPayment', () => {
  it('anticipa un mes si el socio ya está al día', () => {
    const member = {
      memberId: '3008',
      name: 'Test',
      tier: 'socio_individual',
      outstandingBalance: 0,
      nextDueDate: '2026-11-10',
      paymentHistory: [],
    };
    const { member: next, fullyPaid } = applyImportedMemberPayment(member, {
      amount: 40000,
      date: '2026-10-16',
      id: 'mcp-1',
    });
    expect(fullyPaid).toBe(true);
    expect(next.outstandingBalance).toBe(0);
    expect(next.nextDueDate).toBe('2026-12-10');
    expect(next.paymentHistory[0].id).toBe('mcp-1');
  });
});
