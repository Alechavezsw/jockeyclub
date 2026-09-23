import { describe, it, expect } from 'vitest';
import { FACILITIES } from './facilities.js';
import {
  normalizeFacilityConfig,
  applyFacilityEditorPatch,
  buildFacilityCatalog,
  deriveHoursFromSchedule,
} from './facilityConfig.js';

describe('facilityConfig', () => {
  it('normaliza un espacio del catálogo con horarios semanales', () => {
    const fac = normalizeFacilityConfig(FACILITIES[0]);
    expect(fac.weeklySchedule).toHaveLength(7);
    expect(fac.status).toBe('disponible');
    expect(fac.rules.createStatus).toBe('approved');
    expect(fac.guests.maxGuests).toBe(FACILITIES[0].guestLimit);
  });

  it('actualiza hours al guardar patch de horarios', () => {
    const fac = normalizeFacilityConfig(FACILITIES[0]);
    const next = applyFacilityEditorPatch(fac, {
      weeklySchedule: fac.weeklySchedule.map((r) => ({
        ...r,
        open: '10:00',
        close: '18:00',
        enabled: true,
      })),
    });
    expect(deriveHoursFromSchedule(next.weeklySchedule)).toBe('10:00 - 18:00');
    expect(next.hours).toBe('10:00 - 18:00');
    expect(next.slots.length).toBeGreaterThan(0);
  });

  it('buildFacilityCatalog mergea overrides y conserva extras', () => {
    const catalog = buildFacilityCatalog(FACILITIES.slice(0, 2), [
      { id: FACILITIES[0].id, name: 'Cancha editada' },
      { id: 'custom-1', name: 'Espacio nuevo', spaceType: 'parrilla', capacity: '25' },
    ]);
    expect(catalog[0].name).toBe('Cancha editada');
    expect(catalog[1].name).toBe(FACILITIES[1].name);
    expect(catalog.some((f) => f.id === 'custom-1')).toBe(true);
  });

  it('incluye salones y parrilla reales en el seed', () => {
    const catalog = buildFacilityCatalog(FACILITIES);
    expect(catalog.some((f) => f.spaceType === 'salon' && /anhelo/i.test(f.name))).toBe(true);
    expect(catalog.some((f) => f.spaceType === 'parrilla' && /verde/i.test(f.name))).toBe(true);
    expect(catalog.some((f) => f.id === 'salon_eventos')).toBe(true);
    expect(catalog.some((f) => f.id === 'pileta_olimpica')).toBe(false);
    expect(catalog.some((f) => f.id === 'gimnasio')).toBe(false);
    expect(catalog.some((f) => f.id === 'tenis_trad')).toBe(false);
    expect(catalog.every((f) => String(f.image || '').startsWith('/espacios/'))).toBe(true);
  });

  it('omite instalaciones de demo al mergear overrides', () => {
    const catalog = buildFacilityCatalog(FACILITIES, [
      { id: 'restaurant', name: 'The Pavilion' },
      { id: 'piscina_verano', name: 'Piscina de Verano' },
      { id: 'rugby_masc', name: 'Rugby Masculino' },
      { id: 'custom-real', name: 'Quincho nuevo', spaceType: 'parrilla', capacity: '20' },
    ]);
    expect(catalog.some((f) => f.id === 'restaurant')).toBe(false);
    expect(catalog.some((f) => f.id === 'piscina_verano')).toBe(false);
    expect(catalog.some((f) => f.id === 'rugby_masc')).toBe(false);
    expect(catalog.some((f) => f.id === 'custom-real')).toBe(true);
  });
});
