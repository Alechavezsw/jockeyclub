import { describe, it, expect } from 'vitest';
import { slugForExcel } from './exportTableExcel';

describe('slugForExcel', () => {
  it('deja un nombre de archivo corto y sin acentos', () => {
    expect(slugForExcel('12 saldos de socio no coinciden')).toBe('12_saldos_de_socio_no_coinciden');
  });
});
