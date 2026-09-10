import { describe, expect, it } from 'vitest';
import {
  MEMBER_TIER_CATALOG,
  DEFAULT_MEMBER_TIER,
  getTierMonthlyDues,
  upsertTier,
  remapMemberTiers,
  normalizeTier,
  slugifyTierId,
  pickPrimaryCuotaCategory,
  parseCuotaCategories,
  deriveMemberTier,
  resolveStoredMemberTier,
  mergeOfficialTiers,
  SIN_CATEGORIA_TIER,
} from './tiers';

describe('tiers catalog', () => {
  it('incluye categorías del padrón (sin gold/platinum)', () => {
    const ids = MEMBER_TIER_CATALOG.map((t) => t.id);
    expect(ids).toContain('socio_individual');
    expect(ids).toContain('grupo_familiar_familiar');
    expect(ids).toContain('socio_vitalicio');
    expect(ids).not.toContain('gold');
    expect(ids).not.toContain('platinum');
    expect(ids).not.toContain('royal');
  });

  it('slugify de nombres del padrón', () => {
    expect(slugifyTierId('SOCIO (Vitalicio)')).toBe('socio_vitalicio');
    expect(slugifyTierId('GRUPO FAMILIAR (Familiar)')).toBe('grupo_familiar_familiar');
    expect(slugifyTierId('SOCIO INDIVIDUAL')).toBe('socio_individual');
    expect(slugifyTierId('–')).toBe(SIN_CATEGORIA_TIER);
  });

  it('parte cuotas combinadas y elige la membresía', () => {
    expect(parseCuotaCategories(['SOCIO INDIVIDUAL, ABONO TENIS', '–'])).toEqual([
      'SOCIO INDIVIDUAL',
      'ABONO TENIS',
    ]);
    expect(parseCuotaCategories('SOCIO FAMILIAR (AMET), INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)'))
      .toEqual([
        'SOCIO FAMILIAR (AMET)',
        'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
      ]);
    expect(deriveMemberTier([
      'GRUPO FAMILIAR (AMET)',
      'GRUPO FAMILIAR (AMET), INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
    ])).toBe('grupo_familiar_amet');
    expect(deriveMemberTier('SOCIO FAMILIAR, ABONO TENIS')).toBe('socio_familiar');
    expect(deriveMemberTier(['–'])).toBe(SIN_CATEGORIA_TIER);
    expect(resolveStoredMemberTier('tier_1788997270799', ['–'])).toBe(SIN_CATEGORIA_TIER);
    expect(resolveStoredMemberTier('socio_individual_abono_tenis', ['SOCIO INDIVIDUAL, ABONO TENIS']))
      .toBe('socio_individual');
    expect(resolveStoredMemberTier('socio_familiar', ['SOCIO FAMILIAR, ABONO TENIS']))
      .toBe('socio_familiar');
  });

  it('completa el catálogo oficial sin pisar cuotas editadas', () => {
    const merged = mergeOfficialTiers([
      { id: 'socio_individual', name: 'SOCIO INDIVIDUAL', monthlyDues: 55000, sortOrder: 9 },
    ]);
    expect(merged.find((t) => t.id === 'socio_individual')?.monthlyDues).toBe(55000);
    expect(merged.some((t) => t.id === 'liga_no_socio')).toBe(true);
    expect(merged.some((t) => t.id === 'sin_categoria')).toBe(true);
  });

  it('elige categoría principal ignorando interés', () => {
    expect(pickPrimaryCuotaCategory([
      'INTERES POR TRANSACCIÓN 2,5% GRUPO FAMILIAR (AMET)',
      'GRUPO FAMILIAR (Familiar)',
    ])).toBe('GRUPO FAMILIAR (Familiar)');
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
      { memberId: '1', tier: 'socio_individual', adherents: [{ id: 'a', tier: 'socio_individual' }] },
    ];
    const remapped = remapMemberTiers(members, {
      fromIds: ['socio_individual'],
      toId: 'socio_familiar',
    });
    expect(remapped[0].tier).toBe('socio_familiar');
    expect(remapped[0].adherents[0].tier).toBe('socio_familiar');
  });

  it('normaliza id en minúsculas', () => {
    expect(normalizeTier({ name: 'Socio Honorario' }).id).toBe('socio_honorario');
    expect(DEFAULT_MEMBER_TIER).toBe('socio_individual');
  });
});
