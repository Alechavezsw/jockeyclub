import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPERATIONAL_CIRCUITS,
  canReceiveAutomaticNotice,
  canStartOperationalWrite,
  filterOperationalMembers,
  filterReactivateMembers,
  inactiveListFilter,
  isOperationalMember,
  isReactivateCandidate,
  memberCircuitAccess,
  operationalListFilter,
  reactivateListFilter,
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

  it('la baja de mañana sigue operativa y la de hoy no', () => {
    const tomorrow = {
      status: 'inactive',
      memberId: '10800',
      bajaFecha: '2026-11-24',
      meta: { bajaFecha: '2026-11-24' },
    };
    const todayInactive = {
      status: 'inactive',
      memberId: '10801',
      bajaFecha: TODAY,
    };
    const todayPending = {
      status: 'active',
      memberId: '10802',
      pendingBaja: true,
      bajaFecha: TODAY,
    };
    expect(isOperationalMember(tomorrow, TODAY)).toBe(true);
    expect(isReactivateCandidate(tomorrow, TODAY)).toBe(false);
    expect(isOperationalMember(todayInactive, TODAY)).toBe(false);
    expect(isReactivateCandidate(todayInactive, TODAY)).toBe(true);
    expect(isOperationalMember(todayPending, TODAY)).toBe(false);
    expect(isReactivateCandidate(todayPending, TODAY)).toBe(true);
    expect(canStartOperationalWrite(tomorrow, TODAY)).toBe(true);
    expect(canReceiveAutomaticNotice(todayPending, TODAY)).toBe(false);
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

  it('el filtro de padrón y el de avisos usan la fecha efectiva, no solo status active', () => {
    const operational = operationalListFilter(TODAY);
    const inactive = inactiveListFilter(TODAY);
    const reactivate = reactivateListFilter(TODAY);
    expect(operational).toContain('status.eq.inactive,meta->>bajaFecha.gt.2026-11-23');
    expect(operational).toContain('pendingBaja');
    expect(operational).not.toBe('status.eq.active');
    expect(inactive).toContain('bajaFecha.lte.2026-11-23');
    expect(reactivate).toContain('status.eq.suspended');
    expect(reactivate).not.toContain('status.eq.pending');
    const edge = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/functions/_shared/operationalMember.ts'),
      'utf8',
    );
    expect(edge).toContain('status === "inactive"');
    expect(edge).toContain('baja > today');
    expect(edge).toContain('pendingBaja');
    expect(edge).toContain('meta->>bajaFecha.gt.${today}');
  });
});
