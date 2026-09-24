import { describe, expect, it } from 'vitest';
import {
  applyJoinApplicationToMember,
  joinDateFromApplication,
  matchMemberForAccessRequest,
  accessReasonLabel,
  buildRequestDetail,
  requestPdfFileName,
  buildAccessInvite,
  memberDraftFromApplication,
  joinIdentityConflicts,
  joinPhoneKey,
  joinConflictMessage,
} from './selfService';

const members = [
  { id: '11111111-1111-4111-8111-111111111111', memberId: '3368', name: 'Ana', documentNumber: '20.123.456' },
  { id: '22222222-2222-4222-8222-222222222222', memberId: '1001', name: 'Luis', documentNumber: '30111222' },
  { id: '33333333-3333-4333-8333-333333333333', memberId: '31098538', name: 'Bonilla Cristian Sergio', documentNumber: '31098538' },
  { id: '44444444-4444-4444-8444-444444444444', memberId: '10111', name: 'Maria Bonilla', documentNumber: '22111000' },
];

describe('selfService', () => {
  it('prioriza Nº de socio', () => {
    expect(matchMemberForAccessRequest(members, {
      memberNumber: '3368',
      documentNumber: '30111222',
    })?.name).toBe('Ana');
  });

  it('cae a DNI sin puntos', () => {
    expect(matchMemberForAccessRequest(members, {
      documentNumber: '20123456',
    })?.name).toBe('Ana');
  });

  it('no inventa match si faltan datos', () => {
    expect(matchMemberForAccessRequest(members, { documentNumber: '12' })).toBeNull();
  });

  it('vincula por id de ficha si la solicitud ya trae el socio', () => {
    expect(matchMemberForAccessRequest(members, {
      memberId: '33333333-3333-4333-8333-333333333333',
      fullName: 'bonilla',
    })?.memberId).toBe('31098538');
  });

  it('no elige un Bonilla al azar si hay varios', () => {
    expect(matchMemberForAccessRequest(members, { fullName: 'bonilla' })).toBeNull();
  });

  it('identifica si el nombre del padrón es único', () => {
    expect(matchMemberForAccessRequest(members, {
      fullName: 'Cristian Sergio Bonilla',
    })?.memberId).toBe('31098538');
  });

  it('normaliza celular AR para comparar', () => {
    expect(joinPhoneKey('+5492645468012')).toBe('2645468012');
    expect(joinPhoneKey('2645468012')).toBe('2645468012');
  });

  it('bloquea DNI, celular y nombre iguales a un socio', () => {
    const existing = [
      { name: 'Ale Chavez', documentNumber: '31888184', phone: '+5492645468012' },
    ];
    expect(joinIdentityConflicts({
      fullName: 'manuel alejandro Chávez',
      documentNumber: '31888184',
      phone: '+5492645468012',
    }, existing)).toEqual({
      fullName: false,
      documentNumber: true,
      phone: true,
    });
    expect(joinIdentityConflicts({
      fullName: 'Ale Chávez',
      documentNumber: '20.123.456',
      phone: '2645550000',
    }, existing)).toEqual({
      fullName: true,
      documentNumber: false,
      phone: false,
    });
    expect(joinConflictMessage({ documentNumber: true, phone: true })).toContain('Ya soy socio');
  });

  it('al aceptar un ingreso, pisa la ficha vieja con la categoría pedida', () => {
    const next = applyJoinApplicationToMember({
      fullName: 'manuel alejandro Chávez',
      documentNumber: '31888184',
      phone: '+5492645468012',
      email: 'alechavez@cosechacreativa.com.ar',
      requestedTier: 'socio_individual',
      createdAt: '2026-09-23T00:26:09.717Z',
    }, {
      id: 'bd6a7348-94a8-4fee-8eff-03dd56fd9c78',
      memberId: '4240955017912629',
      name: 'Ale Chavez',
      documentNumber: '31888184',
      tier: 'grupo_familiar_familiar',
      email: 'sarmientowebb@gmail.com',
      joinDate: '2026-09-13',
      status: 'active',
    });
    expect(next.id).toBe('bd6a7348-94a8-4fee-8eff-03dd56fd9c78');
    expect(next.memberId).toBe('4240955017912629');
    expect(next.name).toBe('manuel alejandro Chávez');
    expect(next.tier).toBe('socio_individual');
    expect(next.email).toBe('alechavez@cosechacreativa.com.ar');
    expect(next.joinDate).toBe('2026-09-22');
    expect(joinDateFromApplication({ createdAt: '2026-09-23T00:26:09.717Z' })).toBe('2026-09-22');
  });

  it('etiqueta el motivo', () => {
    expect(accessReasonLabel('forgot_password')).toBe('Olvidé la contraseña');
  });

  it('arma la ficha de ingreso para modal y PDF', () => {
    const detail = buildRequestDetail('alta', {
      fullName: 'Ale Chavez',
      documentType: 'DNI',
      documentNumber: '31888184',
      phone: '+5492645468012',
      requestedTier: 'grupo_familiar_familiar',
      status: 'pending',
    }, { tierLabel: 'GRUPO FAMILIAR (Familiar)' });
    expect(detail.title).toBe('Solicitud de ingreso');
    expect(detail.rows.find(([label]) => label === 'Celular')[1]).toBe('+5492645468012');
    expect(requestPdfFileName(detail)).toBe('solicitud-ingreso-ale-chavez.pdf');
  });

  it('arma WhatsApp y mail con usuario, clave y link', () => {
    const invite = buildAccessInvite({
      name: 'Ale Chavez',
      phone: '+5492645468012',
      contactEmail: 'sarmientowebb@gmail.com',
      creds: { username: 'ale.chavez.8184', email: 'ale.chavez.8184@jockey.sj', password: 'Abc12345' },
      portalUrl: 'https://club.example/',
    });
    expect(invite.whatsappUrl).toContain('https://wa.me/5492645468012');
    expect(invite.whatsappUrl).toContain(encodeURIComponent('ale.chavez.8184@jockey.sj'));
    expect(invite.mailUrl).toMatch(/^mailto:sarmientowebb@gmail.com/);
    expect(invite.message).toContain('https://club.example/');
    expect(memberDraftFromApplication({
      fullName: 'Ale Chavez',
      documentNumber: '31888184',
      phone: '+5492645468012',
    }).name).toBe('Ale Chavez');
  });
});
