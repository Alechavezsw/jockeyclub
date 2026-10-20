import { describe, expect, it } from 'vitest';
import {
  findMemberInQuery,
  memberFacts,
  memberFactsForPrompt,
  memberInsight,
} from './memberFacts';

const titular = {
  memberId: '1001',
  name: 'Ana Pérez',
  documentNumber: '20111222',
  status: 'active',
  tier: 'socio_familiar',
  outstandingBalance: 70000,
  nextDueDate: '2026-10-10',
  lastPaymentDate: '2026-08-12',
};
const adherente = {
  memberId: '1002',
  name: 'Luis Pérez',
  documentNumber: '40111222',
  status: 'active',
  tier: 'socio_familiar',
  familyPrincipalNumber: '1001',
  outstandingBalance: 0,
};
const vitalicio = {
  memberId: '1003',
  name: 'Rosa Gómez',
  documentNumber: '5111222',
  status: 'active',
  tier: 'socio_vitalicio',
  outstandingBalance: 0,
};
const amet = {
  memberId: '1004',
  name: 'Julia Rivas',
  documentNumber: '30111222',
  status: 'active',
  tier: 'socio_individual_amet',
  outstandingBalance: 0,
  nextDueDate: '2026-10-18',
  lastPaymentDate: '2026-09-18',
};
const all = [titular, adherente, vitalicio, amet];

describe('findMemberInQuery', () => {
  it('encuentra al socio por número con una pista de que habla de un socio', () => {
    expect(findMemberInQuery('¿por qué el socio 1001 no puede pagar pileta?', all)).toBe(titular);
    expect(findMemberInQuery('ficha n° 1003', all)).toBe(vitalicio);
    expect(findMemberInQuery('dni 30111222', all)).toBe(amet);
    expect(findMemberInQuery('1002', all)).toBe(adherente);
  });

  it('un año o un monto suelto no es un socio', () => {
    expect(findMemberInQuery('cuánto liquidamos en 2026', [{ ...titular, memberId: '2026' }])).toBeNull();
    expect(findMemberInQuery('el monto de 70000 pesos', all)).toBeNull();
  });

  it('por nombre y apellido, solo si es uno solo', () => {
    expect(findMemberInQuery('¿qué le pasa a Ana Pérez con la cuota?', all)).toBe(titular);
    expect(findMemberInQuery('¿qué pasa con Pérez?', all)).toBeNull();
    expect(findMemberInQuery('Pérez Ana Luis', [titular, { ...titular, memberId: '9' }])).toBeNull();
  });
});

describe('memberFacts', () => {
  const opts = { today: '2026-10-20', members: all };

  it('titular en mora: debe, recargo y por qué no paga pileta', () => {
    const facts = memberFacts(titular, opts);
    expect(facts.inMora).toBe(true);
    expect(facts.dependent).toBe(false);
    expect(facts.dueDay).toBe(10);
    expect(facts.charge.surcharge).toBeGreaterThan(0);
    expect(facts.canPayPool).toBe(false);
    expect(facts.poolReason).toMatch(/mora/i);
    // octubre no es temporada: la deuda no cierra la puerta
    expect(facts.canEnterToday).toBe(true);
  });

  it('en temporada la mora cierra la puerta', () => {
    const facts = memberFacts({ ...titular, nextDueDate: '2026-12-10' }, { today: '2026-12-15', members: all });
    expect(facts.inPoolSeason).toBe(true);
    expect(facts.canEnterToday).toBe(false);
    expect(facts.entryReason).toMatch(/mora/i);
  });

  it('el adherente no tiene cuenta: paga el titular', () => {
    const facts = memberFacts(adherente, opts);
    expect(facts.dependent).toBe(true);
    expect(facts.titularNumber).toBe('1001');
    expect(facts.titularName).toBe('Ana Pérez');
    expect(facts.inMora).toBe(false);
    expect(facts.charge).toBeNull();
  });

  it('el exento nunca está en mora ni paga cuota', () => {
    const facts = memberFacts({ ...vitalicio, outstandingBalance: 5000 }, opts);
    expect(facts.exempt).toBe(true);
    expect(facts.inMora).toBe(false);
    expect(facts.charge).toBeNull();
    expect(memberFactsForPrompt(facts)).toMatch(/EXENTO/);
  });

  it('AMET vence el 18 y no lleva recargo', () => {
    const facts = memberFacts(amet, opts);
    expect(facts.amet).toBe(true);
    expect(facts.dueDay).toBe(18);
    expect(facts.charge?.surcharge || 0).toBe(0);
  });

  it('un suspendido no ingresa', () => {
    const facts = memberFacts({ ...titular, status: 'suspended' }, opts);
    expect(facts.canEnterToday).toBe(false);
    expect(facts.entryReason).toMatch(/suspendida/);
  });

  it('al prompt no van DNI, teléfono ni domicilio', () => {
    const text = memberFactsForPrompt(memberFacts({ ...titular, phone: '2644123456', address: 'Calle 1' }, opts));
    expect(text).not.toMatch(/20111222|2644123456|Calle 1/);
    expect(text).toMatch(/Nº 1001/);
  });
});

describe('memberInsight', () => {
  it('dice el estado en corto, con el paso siguiente si está en mora', () => {
    const insight = memberInsight(memberFacts(titular, { today: '2026-10-20', members: all }));
    expect(insight.verdict).toMatch(/1001.*mora/);
    expect(insight.text).toMatch(/recargo/i);
    expect(insight.next).toMatch(/cobrando/i);
    expect(insight.go).toBe('members');
  });

  it('explica al adherente sin inventarle una deuda', () => {
    const insight = memberInsight(memberFacts(adherente, { today: '2026-10-20', members: all }));
    expect(insight.verdict).toMatch(/adherente/);
    expect(insight.text).toMatch(/titular/);
  });
});
