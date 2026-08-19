import { describe, expect, it } from 'vitest';
import {
  MEMBER_TIER_CATALOG,
  getTierMonthlyDues,
  upsertTier,
  remapMemberTiers,
  normalizeTier,
} from './tiers';

describe('tiers catalog', () => {
  it('montos por defecto', () => {
    expect(getTierMonthlyDues('gold', MEMBER_TIER_CATALOG)).toBe(32000);
    expect(getTierMonthlyDues('platinum', MEMBER_TIER_CATALOG)).toBe(38000);
    expect(getTierMonthlyDues('royal', MEMBER_TIER_CATALOG)).toBe(45000);
  });

  it('alta y cambio de cuota', () => {
    const next = upsertTier(MEMBER_TIER_CATALOG, {
      name: 'Junior',
      label: 'Menores',
      monthlyDues: 15000,
      color: '#10b981',
      sortOrder: 4,
    });
    const junior = next.find((t) => t.name === 'Junior');
    expect(junior).toBeTruthy();
    expect(getTierMonthlyDues(junior.id, next)).toBe(15000);

    const edited = upsertTier(next, { ...junior, monthlyDues: 18000 });
    expect(getTierMonthlyDues(junior.id, edited)).toBe(18000);
  });

  it('remap de categoría en padrón', () => {
    const members = [
      { memberId: '1', tier: 'gold', adherents: [{ id: 'a', tier: 'gold' }] },
    ];
    const remapped = remapMemberTiers(members, { fromIds: ['gold'], toId: 'platinum' });
    expect(remapped[0].tier).toBe('platinum');
    expect(remapped[0].adherents[0].tier).toBe('platinum');
  });

  it('normaliza id en minúsculas', () => {
    expect(normalizeTier({ name: 'Socio Honorario' }).id).toBe('socio_honorario');
  });
});
