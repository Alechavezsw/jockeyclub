import { describe, expect, it } from 'vitest';
import {
  applyJoinApplicationToMember,
  joinDateFromApplication,
  matchMemberForAccessRequest,
  accessInviteMailError,
  accessLookupPickedLine,
  accessReasonForMember,
  accessReasonsForMember,
  accessReasonLabel,
  accessRequestIsOpen,
  effectiveAccessStatus,
  mergeOpenAccessRequest,
  oneAccessRequestTrail,
  splitAccessRequestInbox,
  portalLoginUrl,
  portalAccountUrl,
  requestStatusLabel,
  membershipApplicationStatusLabel,
  membershipInquiryContact,
  searchRequestDirectoryHits,
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

  it('si el id no está en el padrón cargado, usa el número', () => {
    expect(matchMemberForAccessRequest(members, {
      memberId: '99999999-9999-4999-8999-999999999999',
      memberNumber: '3368',
      documentNumber: '30111222',
    })?.name).toBe('Ana');
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
      memberId: '111591',
      name: 'Ale Chavez',
      documentNumber: '31888184',
      tier: 'grupo_familiar_familiar',
      email: 'sarmientowebb@gmail.com',
      joinDate: '2026-09-13',
      status: 'active',
    });
    expect(next.id).toBe('bd6a7348-94a8-4fee-8eff-03dd56fd9c78');
    expect(next.memberId).toBe('111591');
    expect(next.name).toBe('manuel alejandro Chávez');
    expect(next.tier).toBe('socio_individual');
    expect(next.email).toBe('alechavez@cosechacreativa.com.ar');
    expect(next.joinDate).toBe('2026-09-22');
    expect(joinDateFromApplication({ createdAt: '2026-09-23T00:26:09.717Z' })).toBe('2026-09-22');
  });

  it('alta nueva usa correlativo corto, no un random de 16 dígitos', () => {
    const next = applyJoinApplicationToMember({
      fullName: 'Nuevo Socio',
      documentNumber: '40111222',
      phone: '2644000000',
      email: 'nuevo@example.com',
      requestedTier: 'socio_individual',
      createdAt: '2026-11-01T12:00:00.000Z',
    }, null, {
      members: [
        { memberId: '111590' },
        { memberId: '4240955017912629' },
      ],
    });
    expect(next.memberId).toBe('111591');
    expect(next.memberId.length).toBeLessThanOrEqual(6);
  });

  it('etiqueta el motivo', () => {
    expect(accessReasonLabel('forgot_password')).toBe('Olvidé la contraseña');
  });

  it('a la semana el pedido queda listo y no duplica el trazado', () => {
    const now = Date.parse('2026-10-14T21:24:00.000-03:00');
    const fresh = {
      id: 'a',
      memberNumber: '9910',
      documentNumber: '25939818',
      status: 'pending',
      createdAt: '2026-10-14T21:24:00.000-03:00',
    };
    const stale = {
      id: 'b',
      memberNumber: '9910',
      status: 'pending',
      createdAt: '2026-10-06T12:00:00.000-03:00',
    };
    expect(accessRequestIsOpen(fresh, now)).toBe(true);
    expect(effectiveAccessStatus(stale, now)).toBe('done');
    expect(oneAccessRequestTrail([stale, fresh]).map((r) => r.id)).toEqual(['a']);
    const merged = mergeOpenAccessRequest([fresh], {
      memberNumber: '9910',
      phone: '2644436262',
      reason: 'forgot_password',
    }, now);
    expect(merged.merged).toBe(true);
    expect(merged.item.id).toBe('a');
    expect(merged.item.createdAt).toBe(fresh.createdAt);
    expect(merged.list).toHaveLength(1);
    const inbox = splitAccessRequestInbox([
      fresh,
      stale,
      { id: 'c', memberNumber: '1622', status: 'approved', createdAt: '2026-09-30T12:00:00.000Z' },
    ], now);
    expect(inbox.open.map((r) => r.id)).toEqual(['a']);
    expect(inbox.hidden.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('si ya tiene usuario, el trámite es recuperar clave', () => {
    expect(accessReasonsForMember({ hasApp: true }).map((r) => r.id)).toEqual(['forgot_password']);
    expect(accessReasonForMember({ hasApp: true }, 'first_access')).toBe('forgot_password');
    expect(accessReasonsForMember({ id: 'm1', memberId: '9910' }).map((r) => r.id)).toEqual(['first_access']);
    expect(accessReasonsForMember(null).map((r) => r.id)).toEqual(['first_access', 'forgot_password']);
  });

  it('dice si la ficha ya tiene usuario', () => {
    expect(accessLookupPickedLine({
      memberId: '9910',
      name: 'Paula Andrea Cuello Scida',
    })).toBe('Socio Nº 9910 · Paula Andrea Cuello Scida · el pedido llega a esa ficha');
    expect(accessLookupPickedLine({
      memberId: '9910',
      name: 'Paula Andrea Cuello Scida',
      hasApp: true,
    })).toBe('Socio Nº 9910 · Paula Andrea Cuello Scida · ya tiene usuario');
  });

  it('al aprobar dice Aprobado y no muestra la secreta de Resend', () => {
    expect(portalLoginUrl()).toBe('https://jockeyclubsj.com.ar/');
    expect(portalAccountUrl()).toBe('https://www.jockeyclubsj.com.ar/cuenta');
    expect(requestStatusLabel('approved')).toBe('Aprobado');
    expect(requestStatusLabel('pending')).toBe('Pendiente');
    expect(requestStatusLabel('done')).toBe('Listo');
    expect(accessInviteMailError('Falta configurar RESEND_API_KEY en las secretas de Supabase.')).toBe('');
    expect(accessInviteMailError('El destinatario rebotó')).toBe('El destinatario rebotó');
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
    expect(detail.title).toBe('Quiere asociarse');
    expect(detail.notice).toMatch(/requisitos/i);
    expect(detail.rows.find(([label]) => label === 'Celular')[1]).toBe('+5492645468012');
    expect(requestPdfFileName(detail)).toBe('solicitud-ingreso-ale-chavez.pdf');
  });

  it('contacto de asociarse arma WhatsApp y mail sin dar acceso', () => {
    const contact = membershipInquiryContact({
      fullName: 'Luciana Ponce',
      phone: '+5492644108712',
      email: 'luciana@mail.com',
    });
    expect(contact.whatsappUrl).toContain('https://wa.me/5492644108712');
    expect(contact.whatsappUrl).toMatch(/asociarte|requisitos/i);
    expect(contact.mailUrl).toMatch(/^mailto:/);
    expect(membershipApplicationStatusLabel('approved')).toBe('Contactado');
    expect(membershipApplicationStatusLabel('pending')).toBe('Pendiente');
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

  it('la búsqueda del padrón incluye quien pidió asociarse o acceso', () => {
    const hits = searchRequestDirectoryHits('esquivel', {
      applications: [
        { id: 'app-1', fullName: 'Agustina Esquivel', documentNumber: '40111222', email: 'agustina@mail.com', phone: '2644001122', status: 'pending', createdAt: '2026-11-01T12:00:00.000Z' },
        { id: 'app-2', fullName: 'Agustina Esquivel', documentNumber: '40111222', status: 'approved', memberId: 'mem-1', createdAt: '2026-10-01T12:00:00.000Z' },
      ],
      accessRequests: [
        { id: 'acc-1', fullName: 'Agustina Esquivel', documentNumber: '30999888', memberNumber: '8801', phone: '2644003344', status: 'pending', createdAt: '2026-11-02T12:00:00.000Z' },
      ],
      listedMembers: [
        { id: 'mem-1', memberId: '1200', name: 'Agustina Esquivel', documentNumber: '40111222' },
      ],
    });
    expect(hits.map((hit) => hit.id)).toEqual(['acc-1', 'app-1']);
    expect(hits.find((hit) => hit.id === 'app-1').kind).toBe('alta');
    expect(searchRequestDirectoryHits('40111222', {
      applications: [{ id: 'app-1', fullName: 'Agustina Esquivel', documentNumber: '40.111.222', status: 'pending' }],
    }).map((hit) => hit.id)).toEqual(['app-1']);
  });
});
