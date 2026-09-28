import { describe, it, expect } from 'vitest';
import {
  MEMBER_STATUS_REASONS,
  reasonLabel,
  buildLifecycleMeta,
  collectMemberMeta,
  memberAppAccess,
  memberHasSocietasApp,
  splitMemberName,
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
    expect(memberAppAccess({}).label).toBe('Sin app');
  });
});
