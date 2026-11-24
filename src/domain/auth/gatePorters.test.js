import { describe, expect, it } from 'vitest';
import {
  dedupeGateOperators,
  isCanonicalGatePorter,
  normalizePorterName,
  porterCanonicalKey,
} from './gatePorters';

describe('gatePorters', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(normalizePorterName('Adrian Pablo Suárez')).toBe('adrian pablo suarez');
  });

  it('reconoce los porteros canónicos', () => {
    expect(porterCanonicalKey('Adrian Pablo Suarez')).toBe('adrian-suarez');
    expect(porterCanonicalKey('elias carrizo')).toBe('elias-carrizo');
    expect(porterCanonicalKey('Guillermo Castro')).toBe('guillermo-castro');
    expect(porterCanonicalKey('Juan ignacio Molina')).toBe('juan-molina');
    expect(porterCanonicalKey('Julio cesar Diaz')).toBe('julio-diaz');
    expect(porterCanonicalKey('Rosana Rodriguez')).toBe('rosana-rodriguez');
    expect(porterCanonicalKey('Jorge Luis Galdeano Bernales')).toBe('jorge-galdeano');
  });

  it('rechaza perfiles que no son de la lista', () => {
    expect(isCanonicalGatePorter('Portena Seguridad')).toBe(false);
    expect(isCanonicalGatePorter('Cristian Sergio Bonilla')).toBe(false);
    expect(isCanonicalGatePorter('Ruben Dario Mercado')).toBe(false);
  });

  it('elimina duplicados Adrian Suarez / Suárez y Julio Diaz', () => {
    const rows = dedupeGateOperators([
      { id: 'a1', fullName: 'Adrian Pablo Suárez', role: 'admin' },
      { id: 'a2', fullName: 'Adrian Pablo Suarez', role: 'gate_operator' },
      { id: 'j1', fullName: 'Julio Cesar Diaz', role: 'gate_operator' },
      { id: 'j2', fullName: 'Julio cesar Diaz', role: 'admin' },
      { id: 'e1', fullName: 'elias carrizo', role: 'admin' },
    ]);
    expect(rows).toEqual([
      { id: 'a2', fullName: 'Adrian Pablo Suarez' },
      { id: 'e1', fullName: 'elias carrizo' },
      { id: 'j1', fullName: 'Julio Cesar Diaz' },
    ]);
  });
});

