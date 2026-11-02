import { describe, expect, it } from 'vitest';
import {
  applyDebitAlta,
  applyDebitBaja,
  buildDebitListingDraft,
  buildDebitRoster,
  classifyDebitMember,
  listDebitMoves,
  isDebitListingDraftReady,
  looksLikeCardNumber,
  validateDebitListingDraft,
  wantsAutomaticDebit,
} from './debitMoves';

const base = {
  memberId: '100',
  name: 'Ana Debito',
  documentNumber: '30111222',
  status: 'active',
  tier: 'socio_individual',
  outstandingBalance: 32000,
};

describe('debitMoves', () => {
  it('detecta medio de pago de débito Galicia', () => {
    expect(wantsAutomaticDebit({ paymentMethod: 'debito' })).toBe(true);
    expect(wantsAutomaticDebit({ paymentMethod: 'galicia' })).toBe(true);
    expect(wantsAutomaticDebit({ paymentMethod: 'transferencia' })).toBe(false);
  });

  it('clasifica vigente, pendiente y rechazado', () => {
    expect(classifyDebitMember({
      ...base,
      paymentMethod: 'debito',
      mpAdhesion: 'authorized',
    }).kind).toBe('vigente');

    expect(classifyDebitMember({
      ...base,
      paymentMethod: 'debito',
    }).kind).toBe('pendiente');

    expect(classifyDebitMember({
      ...base,
      paymentMethod: 'debito',
      mpAdhesion: 'rejected',
    }).kind).toBe('rechazado');
  });

  it('arma el padrón de quienes debitan cuota', () => {
    const { rows, summary } = buildDebitRoster([
      { ...base, paymentMethod: 'debito', mpAdhesion: 'authorized' },
      { ...base, memberId: '101', name: 'Luis', paymentMethod: 'transferencia' },
      { ...base, memberId: '102', name: 'Nora', paymentMethod: 'debito' },
    ], { today: '2026-11-01' });

    expect(rows.map((row) => row.memberId).sort()).toEqual(['100', '102']);
    expect(summary.vigentes).toBe(1);
    expect(summary.pendientes).toBe(1);
    expect(summary.chargeable).toBe(1);
  });

  it('registra alta y baja en el historial del mes', () => {
    const alta = applyDebitAlta(base, { today: '2026-11-01', note: 'Pedido por mail', cardKind: 'credito' });
    expect(alta.paymentMethod).toBe('debito');
    expect(alta.automaticDebitKind).toBe('credito');
    expect(alta.meta.automaticDebitKind).toBe('credito');
    expect(alta.debitMoves[0]).toMatchObject({ type: 'alta', at: '2026-11-01', cardKind: 'credito' });

    const altaDebito = applyDebitAlta(base, { today: '2026-11-01', cardKind: 'debito' });
    expect(altaDebito.automaticDebitKind).toBe('debito');
    expect(altaDebito.prismaTipoDebito).toMatch(/d[eé]bito/i);

    const baja = applyDebitBaja(alta, { today: '2026-11-02', note: 'Renuncia' });
    expect(baja.paymentMethod).toBe('transferencia');
    expect(baja.debitMoves).toHaveLength(2);

    const { rows } = listDebitMoves([baja], {
      today: '2026-11-02',
      view: 'bajas',
      monthKey: '2026-11',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('baja');
  });

  it('no da de alta a un exento de cuota', () => {
    expect(() => applyDebitAlta({
      ...base,
      tier: 'socio_vitalicio',
    })).toThrow(/no abonan cuota/i);
  });

  it('asigna N° socio automático y exige tarjeta real (Luhn)', () => {
    expect(looksLikeCardNumber('4240955017912629')).toBe(true);
    const draft = buildDebitListingDraft({
      ...base,
      memberId: '12001',
      name: 'manuel alejandro Chávez',
      outstandingBalance: 40000,
      cardNumber: '',
    }, { year: 2026, month: 11, cardKind: 'debito', moveType: 'baja' });
    expect(draft.memberId).toBe('12001');
    expect(draft.statusCode).toBe('N');
    expect(isDebitListingDraftReady(draft)).toBe(false);
    expect(() => validateDebitListingDraft(draft)).toThrow(/tarjeta/i);
    const ok = validateDebitListingDraft({
      ...draft,
      cardNumber: '4111111111111111',
      cardExpiry: '12/30',
      cardCvv: '123',
      brand: 'VISA DEBITO',
    });
    expect(ok.cardNumber).toBe('4111111111111111');
    expect(ok.cardExpiry).toBe('12/30');
    expect(ok.cardCvv).toBe('');
    expect(ok.brand).toBe('VISA DEBITO');
    expect(ok.statusCode).toBe('N');
    expect(isDebitListingDraftReady(ok)).toBe(true);
  });

  it('si la ficha trae un ID tipo tarjeta, usa correlativo de club', () => {
    const draft = buildDebitListingDraft({
      ...base,
      memberId: '4240955017912629',
      name: 'manuel alejandro Chávez',
    }, {
      year: 2026,
      month: 11,
      members: [{ memberId: '111590' }, { memberId: '4240955017912629' }],
      nextMemberId: '111591',
    });
    expect(draft.memberId).toBe('111591');
    expect(draft.remumber).toBe(true);
    expect(draft.previousMemberId).toBe('4240955017912629');
  });
});
