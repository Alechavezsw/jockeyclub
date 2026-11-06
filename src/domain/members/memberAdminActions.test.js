import { describe, it, expect } from 'vitest';
import {
  MEMBER_STATUS_REASONS,
  reasonLabel,
  buildLifecycleMeta,
  canReactivateMember,
  collectMemberMeta,
  memberAppAccess,
  memberHasSocietasApp,
  splitMemberName,
  bajaEffectiveOn,
} from './memberAdminActions.js';

describe('memberAdminActions', () => {
  it('tiene motivos para suspend / activate / delete', () => {
    expect(MEMBER_STATUS_REASONS.suspend.length).toBeGreaterThan(2);
    expect(MEMBER_STATUS_REASONS.delete.some((r) => r.id === 'renuncia')).toBe(true);
    expect(reasonLabel('suspend', 'mora')).toMatch(/Mora/);
  });

  it('buildLifecycleMeta acumula historial y baja', () => {
    const meta = buildLifecycleMeta({}, {
      action: 'delete',
      reasonId: 'renuncia',
      reasonLabel: 'Renuncia / baja voluntaria',
      detail: 'Nota de prueba',
      actorName: 'Admin',
    });
    expect(meta.bajaMotivo).toBe('Renuncia / baja voluntaria');
    expect(meta.bajaDetail).toBe('Nota de prueba');
    expect(meta.lifecycleHistory).toHaveLength(1);
    expect(meta.lastLifecycle.actorName).toBe('Admin');
    expect(meta.bajaFecha).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('la baja guarda la fecha pedida y el monto', () => {
    const meta = buildLifecycleMeta({}, {
      action: 'delete',
      reasonId: 'mora',
      reasonLabel: 'Mora / falta de pago',
      presentedOn: '2026-11-06',
      amount: 70000.5,
      actorName: 'Ana Admin',
      actorId: '11111111-1111-1111-1111-111111111111',
      actorEmail: 'ana@club.test',
    });
    expect(meta.bajaKind).toBe('mora');
    expect(meta.bajaActorName).toBe('Ana Admin');
    expect(meta.bajaActorId).toBe('11111111-1111-1111-1111-111111111111');
    expect(meta.bajaRegistradaAt).toMatch(/T\d{2}:\d{2}/);
    expect(meta.lastLifecycle.actorEmail).toBe('ana@club.test');
    expect(meta.bajaPresentada).toBe('2026-11-06');
    expect(meta.bajaFecha).toBe('2026-12-01');
    expect(meta.bajaMonto).toBe(70000.5);
    expect(meta.lastLifecycle.amount).toBe(70000.5);
  });

  it('la reactivación conserva la baja y anota quién la levantó', () => {
    const baja = buildLifecycleMeta({}, {
      action: 'delete',
      reasonId: 'licencia',
      reasonLabel: 'Licencia',
      presentedOn: '2026-11-06',
      amount: 148000,
      actorName: 'Quien dio la baja',
      actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    const meta = buildLifecycleMeta(baja, {
      action: 'activate',
      reasonId: 'regularizo',
      reasonLabel: 'Regularizó situación',
      presentedOn: '2026-12-02',
      amount: 148000,
      actorName: 'Quien reactivó',
      actorId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    expect(meta.pendingBaja).toBe(false);
    expect(meta.bajaMotivo).toBe('Licencia');
    expect(meta.bajaActorName).toBe('Quien dio la baja');
    expect(meta.bajaRegistradaAt).toBe(baja.bajaRegistradaAt);
    expect(meta.reactivateMotivo).toBe('Regularizó situación');
    expect(meta.reactivateFecha).toBe('2026-12-02');
    expect(meta.reactivateActorName).toBe('Quien reactivó');
    expect(meta.reactivateRegistradaAt).toMatch(/T\d{2}:\d{2}/);
    expect(meta.lifecycleHistory).toHaveLength(2);
    expect(canReactivateMember({ status: 'inactive' })).toBe(true);
    expect(canReactivateMember({ status: 'active', bajaFecha: '2026-12-01' })).toBe(true);
    expect(canReactivateMember({ status: 'active' })).toBe(false);
  });

  it('la nota de baja es con un mes de anticipación y el mes en curso se cobra', () => {
    expect(bajaEffectiveOn('2026-10-20')).toBe('2026-11-01');
    expect(bajaEffectiveOn('2026-11-01')).toBe('2026-12-01');
  });

  it('splitMemberName y collectMemberMeta', () => {
    expect(splitMemberName({ name: 'Ana Pérez López' })).toEqual({
      firstName: 'Ana',
      lastName: 'Pérez López',
    });
    const meta = collectMemberMeta({
      meta: { source: 'datita' },
      portalUsername: 'ana.perez',
      bajaMotivo: 'x',
    });
    expect(meta.source).toBe('datita');
    expect(meta.portalUsername).toBe('ana.perez');
    expect(meta.bajaMotivo).toBe('x');
  });

  it('reconoce acceso Societas en meta o en el socio', () => {
    expect(memberHasSocietasApp({ meta: { hasSocietasApp: true } })).toBe(true);
    expect(memberHasSocietasApp({ hasSocietasApp: true })).toBe(true);
    expect(memberHasSocietasApp({ meta: { hasSocietasApp: false } })).toBe(false);
    const meta = collectMemberMeta({ hasSocietasApp: true, societasAppAsOf: '2026-09-09' });
    expect(meta.hasSocietasApp).toBe(true);
    expect(meta.societasAppAsOf).toBe('2026-09-09');
  });

  it('dice Con app solo si ya abrió el portal, no por Societas', () => {
    expect(memberAppAccess({ meta: { hasSocietasApp: true } })).toEqual({
      kind: 'none',
      hasAccess: false,
      label: 'Sin app',
      hint: 'Todavía no abrió el portal',
    });
    expect(memberAppAccess({ meta: { hasSocietasApp: false }, profileId: 'p-1' })).toEqual({
      kind: 'portal',
      hasAccess: true,
      label: 'Con app',
      hint: 'Ya abrió el portal',
    });
    expect(memberAppAccess({ meta: { portalProvisionedAt: '2026-09-26T12:00:00.000Z' } }).label).toBe('Con app');
    expect(memberAppAccess({ has_portal: true }).label).toBe('Con app');
    expect(memberAppAccess({}).label).toBe('Sin app');
  });
});
