import { describe, expect, it } from 'vitest';
import { credentialPdfFileName, formatCredentialNumber, hexToRgb } from './exportCredentialPdf';

describe('exportCredentialPdf helpers', () => {
  it('nombra el archivo con el número de credencial', () => {
    expect(credentialPdfFileName({ memberId: '1017' })).toBe('credencial-jockey-1017.pdf');
  });

  it('agrupa el número de credencial', () => {
    expect(formatCredentialNumber('2026887744320988')).toBe('2026 8877 4432 0988');
  });

  it('convierte el acento de categoría a RGB', () => {
    expect(hexToRgb('#10b981')).toEqual([16, 185, 129]);
  });
});
