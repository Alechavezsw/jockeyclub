import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_CIRCUITS,
  canReceiveAutomaticNotice,
  canStartOperationalWrite,
  filterOperationalMembers,
  filterReactivateMembers,
  isOperationalMember,
  isReactivateCandidate,
  memberCircuitAccess,
  reactivateMemberRecord,
} from './operationalVisibility.js';

const TODAY = '2026-11-23';

const active = {
  id: 'uuid-active',
  memberId: '10009',
  name: 'Ana Activa',
  documentNumber: '30111222',
  status: 'active',
  outstandingBalance: 70000,
  familyPrincipalNumber: 10009,
  paymentHistory: [{ id: 'pay-1', amount: 70000 }],
};

const inactive = {
  id: 'uuid-baja',
  memberId: '3368',
  name: 'Daniela Rojas',
  firstName: 'Daniela',
  lastName: 'Rojas',
  documentNumber: '29507901',
  status: 'inactive',
  outstandingBalance: 140000,
  familyPrincipalNumber: 3368,
  bajaFecha: '2026-10-01',
  bajaMotivo: 'Renuncia',
  bajaActorName: 'Secretaría',
  paymentHistory: [{ id: 'pay-old', amount: 70000 }],
  meta: {
    bajaFecha: '2026-10-01',
    bajaMotivo: 'Renuncia',
    bajaActorName: 'Secretaría',
    bajaRegistradaAt: '2026-09-02T12:00:00.000Z',
  },
};

describe('visibilidad operativa de socios', () => {
  it('un inactivo no entra al padrón ni a caja, débitos, reservas o portería', () => {
    const access = memberCircuitAccess(inactive, TODAY);
    expect(access.operational).toBe(false);
    for (const circuit of ['padron', 'caja', 'debitos', 'reservas', 'porteria', 'pileta', 'tenis', 'credenciales', 'campanas', 'avisos', 'exportacion']) {
      expect(access.circuits[circuit]).toBe(false);
    }
    expect(filterOperationalMembers([active, inactive], TODAY).map((m) => m.memberId)).toEqual(['10009']);
    expect(canStartOperationalWrite(inactive, TODAY)).toBe(false);
    expect(canReceiveAutomaticNotice(inactive, TODAY)).toBe(false);
  });

  it('el activo sigue en todos los circuitos', () => {
    const access = memberCircuitAccess(active, TODAY);
    expect(access.operational).toBe(true);
    expect(OPERATIONAL_CIRCUITS.every((circuit) => access.circuits[circuit])).toBe(true);
  });

  it('Reactivar encuentra al inactivo por la ficha que ya no está en el padrón', () => {
    expect(isReactivateCandidate(inactive, TODAY)).toBe(true);
    expect(isReactivateCandidate(active, TODAY)).toBe(false);
    expect(filterReactivateMembers([active, inactive], TODAY)).toEqual([inactive]);
  });

  it('la baja programada no saca al socio antes de la fecha efectiva', () => {
    const scheduled = {
      status: 'inactive',
      memberId: '10800',
      bajaFecha: '2026-12-01',
      meta: { bajaFecha: '2026-12-01', bajaMotivo: 'Renuncia' },
    };
    expect(isOperationalMember(scheduled, '2026-11-23')).toBe(true);
    expect(isReactivateCandidate(scheduled, '2026-11-23')).toBe(false);
    expect(isOperationalMember(scheduled, '2026-12-01')).toBe(false);
    expect(isReactivateCandidate(scheduled, '2026-12-01')).toBe(true);

    const stillActive = { status: 'active', bajaFecha: '2026-12-01', meta: { bajaFecha: '2026-12-01' } };
    expect(isOperationalMember(stillActive, TODAY)).toBe(true);
    const due = { ...stillActive, pendingBaja: true };
    expect(isOperationalMember(due, '2026-12-01')).toBe(false);
  });

  it('reactivar conserva número, hogar, pagos y deuda y no borra la baja', () => {
    const restored = reactivateMemberRecord(inactive, {
      reactivateMotivo: 'Regularizó situación',
      reactivateActorName: 'Secretaría',
      lifecycleHistory: [{ action: 'activate' }],
    });
    expect(restored.id).toBe(inactive.id);
    expect(restored.memberId).toBe('3368');
    expect(restored.familyPrincipalNumber).toBe(3368);
    expect(restored.outstandingBalance).toBe(140000);
    expect(restored.paymentHistory).toEqual(inactive.paymentHistory);
    expect(restored.status).toBe('active');
    expect(restored.meta.bajaMotivo).toBe('Renuncia');
    expect(restored.meta.bajaActorName).toBe('Secretaría');
    expect(restored.meta.bajaRegistradaAt).toBe('2026-09-02T12:00:00.000Z');
    expect(restored.meta.reactivateMotivo).toBe('Regularizó situación');
    expect(isOperationalMember(restored, TODAY)).toBe(true);
    expect(memberCircuitAccess(inactive, TODAY).historicalAccounting).toBe(true);
    expect(inactive.outstandingBalance).toBe(140000);
    expect(inactive.paymentHistory).toHaveLength(1);
  });
});
