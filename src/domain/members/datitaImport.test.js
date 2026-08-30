import { describe, expect, it } from 'vitest';
import {
  deriveTier,
  parseCsv,
  socioToMember,
  summarizeMembers,
  sociosRowsToMembers,
} from './datitaImport.js';

describe('datitaImport', () => {
  it('parses CSV with accents and quotes', () => {
    const rows = parseCsv('nro_socio,nombre,apellido\n1,"Jonas","Castañeda Rodríguez"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].apellido).toContain('Castañeda');
  });

  it('derives tiers from cuota categories', () => {
    expect(deriveTier(['SOCIO (Vitalicio)'])).toBe('socio_vitalicio');
    expect(deriveTier(['GRUPO FAMILIAR (Familiar)'])).toBe('grupo_familiar_familiar');
    expect(deriveTier(['SOCIO INDIVIDUAL'])).toBe('socio_individual');
    expect(deriveTier(['ABONO TENIS'])).toBe('abono_tenis');
    expect(deriveTier([])).toBe('socio_individual');
    expect(deriveTier([
      'INTERES POR TRANSACCIÓN 2,5% SOCIO INDIVIDUAL (AMET)',
      'SOCIO INDIVIDUAL',
    ])).toBe('socio_individual');
  });

  it('maps socio row with family meta and joined_at fallback', () => {
    const m = socioToMember(
      {
        nro_socio: '1',
        nombre: 'Jonas',
        apellido: 'Castañeda',
        documento_tipo: 'Arg-DNI',
        documento_numero: '50573357',
        socio_activo: 'Habilitado',
        nro_socio_principal_grupo_familiar: '11017',
        nombre_grupo_familiar: 'GF - Rodriguez 11017',
      },
      ['GRUPO FAMILIAR (Familiar)']
    );
    expect(m.memberId).toBe('1');
    expect(m.tier).toBe('grupo_familiar_familiar');
    expect(m.joinDate).toBe('1900-01-01');
    expect(m.meta.joinedAtFallback).toBe(true);
    expect(m.meta.familyPrincipalNumber).toBe(11017);
    expect(m.meta.source).toBe('datita');
  });

  it('summarizes a batch', () => {
    const members = sociosRowsToMembers(
      [
        { nro_socio: '4', nombre: 'Susana', apellido: 'Imparado', socio_activo: 'Habilitado' },
        { nro_socio: '99', nombre: 'Sin', apellido: 'Cuota', socio_activo: 'Deshabilitado' },
      ],
      [{ nro_socio: '4', categoria_cuota: 'SOCIO (Vitalicio)' }]
    );
    const s = summarizeMembers(members);
    expect(s.total).toBe(2);
    expect(s.tiers.socio_vitalicio).toBe(1);
    expect(s.cuotaMissing).toBe(1);
    expect(s.statuses.inactive).toBe(1);
  });
});
