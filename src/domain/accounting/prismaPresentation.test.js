import { describe, expect, it } from 'vitest';
import {
  LILA_PRISMA_FILE_707,
  buildPrismaPresentation,
  presentationDebits,
  summarizeResponseFile,
} from './prismaPresentation';

const LILA_WHEN = new Date('2026-08-29T22:21:00-03:00');

describe('prismaPresentation', () => {
  it('reproduce el archivo 707 de Lila: 90 caracteres, sin socios', () => {
    const file = buildPrismaPresentation({
      fileType: LILA_PRISMA_FILE_707.fileType,
      establishment: '',
      when: LILA_WHEN,
      debits: [{ card: '4111111111111111', clientId: '10146', amount: 100 }],
    });
    const [header, trailer] = file.text.split('\r\n').filter(Boolean);
    expect(file.recordLength).toBe(90);
    expect(file.debitCount).toBe(0);
    expect(header).toBe(`0DEBLIQC 900000    2026082922210${' '.repeat(57)}*`);
    expect(trailer).toBe(`9DEBLIQC 900000    202608292221${'0'.repeat(22)}${' '.repeat(36)}*`);
    expect(header).toHaveLength(90);
    expect(trailer).toHaveLength(90);
    expect(file.filename).toBe('DEBLIQC.txt');
  });

  it('arma el cuerpo de 100 caracteres cuando hay identificador', () => {
    const file = buildPrismaPresentation({
      fileType: 'DEBLIQC',
      establishment: '87654321',
      when: new Date('2019-05-09T17:17:00-03:00'),
      debits: [{
        card: '1237644518206001',
        invoice: 2045335,
        clientId: '38963',
        amount: 1700.1,
        isNew: true,
      }],
    });
    const lines = file.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.length === 100 && line.endsWith('*'))).toBe(true);
    expect(lines[0].slice(0, 19)).toBe('0DEBLIQC 0087654321');
    expect(lines[0].slice(19, 29)).toBe('900000    ');
    expect(lines[0].slice(29, 42)).toBe('2019050917170');
    expect(lines[1].slice(0, 17)).toBe('11237644518206001');
    expect(lines[1].slice(20, 28)).toBe('02045335');
    expect(lines[1].slice(28, 40)).toBe('201905090005');
    expect(lines[1].slice(40, 55)).toBe('000000000170010');
    expect(lines[1].slice(55, 71)).toBe('000000000038963E');
    expect(lines[2].slice(41, 48)).toBe('0000001');
    expect(lines[2].slice(48, 63)).toBe('000000000170010');
    expect(file.totalCents).toBe(170010);
  });

  it('deja afuera a vitalicio y a quien no tiene saldo', () => {
    const members = [
      {
        memberId: '1',
        status: 'active',
        tier: 'vitalicio',
        prismaId: '4111111111111111',
        prismaTipoDebito: 'Visa Crédito',
        outstandingBalance: 5000,
      },
      {
        memberId: '2',
        status: 'active',
        tier: 'socio_familiar',
        prismaId: '4111111111111111',
        prismaTipoDebito: 'Visa Crédito',
        outstandingBalance: 0,
      },
      {
        memberId: '10146',
        status: 'active',
        tier: 'socio_familiar',
        name: 'Socio de prueba',
        prismaId: '4111111111111111',
        prismaTipoDebito: 'Visa Crédito',
        outstandingBalance: 3200,
      },
    ];
    const rows = presentationDebits(members, 'DEBLIQC');
    expect(rows.map((row) => row.memberId)).toEqual(['10146']);
    expect(presentationDebits(members, 'DEBLIQD')).toEqual([]);
  });

  it('reconoce un archivo de respuesta y no exige el detalle', () => {
    const summary = summarizeResponseFile('RDEBLIQC.txt', '0RDEBLIQC900000\n1detalle\n9cierre\n');
    expect(summary.records).toBe(1);
    expect(summary.filename).toBe('RDEBLIQC.txt');
    expect(() => summarizeResponseFile('notas.txt', 'hola')).toThrow(/Prisma/);
  });
});
