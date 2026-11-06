import { describe, expect, it } from 'vitest';
import { buildBajaCertificate, buildReactivacionCertificate, formatBajaLongDate, formatBajaMoney } from './bajaCertificate';

describe('certificado de baja', () => {
  it('escribe la fecha y el monto en el certificado', () => {
    const certificate = buildBajaCertificate({
      member: { name: 'Ana Pérez', memberId: '1200', documentNumber: '30111222' },
      reasonLabel: 'Mora / falta de pago',
      detail: 'Seis meses',
      presentedOn: '2026-11-06',
      effectiveOn: '2026-12-01',
      amount: 70000,
      actorName: 'Ana Admin',
      registeredAt: '2026-11-06T11:46:00.000Z',
      tierLabel: 'Socio familiar',
      club: { name: 'Jockey Club San Juan', issuer: 'Administración', address: 'Rivadavia' },
    });
    const text = certificate.letter.paragraphs.join('\n');
    expect(certificate.letter.headingTitle).toBe('CERTIFICADO DE BAJA');
    expect(text).toContain('6 de noviembre del 2026');
    expect(text).toContain('1 de diciembre del 2026');
    expect(text).toContain(formatBajaMoney(70000));
    expect(text).toContain('Ana Pérez');
    expect(text).toContain('Mora / falta de pago');
    expect(text).toContain('Ana Admin');
    expect(text).toContain('08:46');
    expect(certificate.fileName).toBe('certificado-baja-1200.pdf');
    expect(formatBajaLongDate('2026-11-06')).toBe('6 de noviembre del 2026');
  });

  it('el certificado de reactivación deja la baja anterior y quién reactivó', () => {
    const certificate = buildReactivacionCertificate({
      member: {
        name: 'Ana Pérez',
        memberId: '1200',
        documentNumber: '30111222',
        bajaMotivo: 'Licencia',
        bajaPresentada: '2026-11-06',
      },
      reasonLabel: 'Regularizó situación',
      presentedOn: '2026-12-02',
      amount: 148000,
      actorName: 'Luis Admin',
      registeredAt: '2026-12-02T14:10:00.000Z',
      club: { name: 'Jockey Club San Juan' },
    });
    const text = certificate.letter.paragraphs.join('\n');
    expect(certificate.letter.headingTitle).toBe('CERTIFICADO DE REACTIVACIÓN');
    expect(text).toContain('Licencia');
    expect(text).toContain('Luis Admin');
    expect(text).toContain('11:10');
    expect(certificate.fileName).toBe('certificado-reactivacion-1200.pdf');
  });
});
