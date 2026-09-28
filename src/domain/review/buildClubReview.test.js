import { describe, expect, it } from 'vitest';
import { buildClubReview, reviewItemsForAccess } from './buildClubReview';

const TODAY = '2026-09-26';

describe('buildClubReview', () => {
  it('pone primero el asiento descuadrado y no cuenta como bien al activo sin DNI', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '10', name: 'Ana Bien', documentNumber: '30111222', tier: 'socio', status: 'active' },
        { memberId: '11', name: 'Luis Roto', documentNumber: '', tier: 'socio', status: 'active' },
      ],
      journalEntries: [
        {
          id: 'bad',
          date: '2026-09-01',
          description: 'Cuota mal cargada',
          status: 'posted',
          lines: [
            { accountId: 'caja', debit: 100, credit: 0 },
            { accountId: 'socios', debit: 0, credit: 40 },
          ],
        },
      ],
    });

    expect(review.counts.activos).toBe(2);
    expect(review.counts.bien).toBe(1);
    expect(review.counts.fichas).toBe(1);
    expect(review.items[0].id).toBe('journal-unbalanced');
    expect(review.items.map((item) => item.tier)).toEqual(['contabilidad', 'ficha']);
  });

  it('marca al familiar de 26, el cheque vencido y la baja ilegible, en ese orden', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        {
          memberId: '100',
          name: 'Titular',
          documentNumber: '20111000',
          tier: 'familiar',
          status: 'active',
        },
        {
          memberId: '101',
          name: 'Hijo Grande',
          documentNumber: '40111001',
          tier: 'familiar',
          status: 'active',
          birthDate: '2000-01-01',
          familyPrincipalNumber: '100',
        },
      ],
      cheques: [
        { id: 'c1', status: 'in_portfolio', dueAt: '2026-09-01', checkNumber: '550' },
        { id: 'c2', status: 'in_portfolio', dueAt: '2026-12-01', checkNumber: '551' },
      ],
      bajas: [
        { memberId: '100', name: 'Titular', date: '2026-09-02', motivo: 'se mudó al sur' },
      ],
    });

    const ids = review.items.map((item) => item.id);
    expect(ids).toEqual(['cheques-overdue', 'age-26', 'bajas-otro']);
    expect(review.counts.bien).toBe(1);
    expect(review.items.find((item) => item.id === 'age-26').samples[0].label).toMatch(/Hijo Grande/);
    expect(review.items.find((item) => item.id === 'age-26').samples[0].href).toBe('/panel/members/101?editar=1');
  });

  it('deja un enlace de edición en cada muestra de ficha, proveedor y concesión', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '200', name: 'Titular Baja', documentNumber: '20111000', tier: 'familiar', status: 'inactive' },
        { memberId: '201', name: 'Hijo Activo', documentNumber: '40111001', tier: 'familiar', status: 'active', familyPrincipalNumber: '200' },
        { memberId: '100713', name: 'Sebastian Alvarez', documentNumber: '30111222', tier: 'socio', status: 'active' },
        { memberId: '101370', name: 'Francisco Alvarez', documentNumber: '30111222', tier: 'socio', status: 'active' },
        { memberId: '101324', name: 'Sabrina Pontoriero', documentNumber: '27111222', status: 'active' },
        { memberId: '12932', name: 'Tomas Gimenez', documentNumber: '28111222', tier: 'familiar', status: 'active', familyPrincipalNumber: '99999' },
        { memberId: '6677', name: 'Silvia Grillia', documentNumber: '12', tier: 'socio', status: 'active' },
      ],
      suppliers: [{ id: 'sup-1', legalName: 'REPARACION IMPRESORA', status: 'active', cuit: '' }],
      concessions: [{ id: 'conc-1', name: 'Proveduría', endDate: '2026-01-01' }],
      bajas: [{ memberId: '11354', name: 'Tomas Ovejero', date: '2026-09-02', motivo: 'sin clasificar' }],
    });

    const byId = Object.fromEntries(review.items.map((item) => [item.id, item]));
    expect(byId['concessions-expired'].samples[0].href).toBe('/concesiones?id=conc-1');
    expect(byId['suppliers-cuit'].samples[0].href).toBe('/panel/accounting?sub=suppliers&supplier=sup-1');
    expect(byId['titular-baja'].samples[0].href).toBe('/panel/members/201?editar=1');
    expect(byId['dup-dni'].samples[0].href).toMatch(/\/panel\/members\/(100713|101370)\?editar=1/);
    expect(byId['no-category'].samples[0].href).toBe('/panel/members/101324?editar=1');
    expect(byId['no-titular'].samples[0].href).toBe('/panel/members/12932?editar=1');
    expect(byId['no-dni'].samples[0].href).toBe('/panel/members/6677?editar=1');
    expect(byId['bajas-otro'].samples[0].href).toBe('/panel/members/11354?editar=1');
  });

  it('guarda todas las fichas del hallazgo, no solo las primeras ocho', () => {
    const members = Array.from({ length: 12 }, (_, index) => ({
      memberId: String(7000 + index),
      name: `Familiar ${index + 1}`,
      documentNumber: `30111${String(index).padStart(3, '0')}`,
      tier: 'familiar',
      status: 'active',
      familyPrincipalNumber: '10',
    }));
    members.unshift({
      memberId: '10',
      name: 'Titular',
      documentNumber: '20111000',
      tier: 'familiar',
      status: 'active',
    });

    const review = buildClubReview({ today: TODAY, members });
    const noBirth = review.items.find((item) => item.id === 'no-birth');
    expect(noBirth.count).toBe(12);
    expect(noBirth.samples).toHaveLength(12);
    expect(noBirth.samples.every((sample) => sample.href)).toBe(true);
  });

  it('avisa si los extractos de cuenta no están cargados y no arma la fila cuando ya hay', () => {
    const missing = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '10', name: 'Ana Bien', documentNumber: '30111222', tier: 'socio', status: 'active' },
      ],
      accountLedgers: { loaded: 0 },
    });
    const notice = missing.items.find((item) => item.id === 'ledgers-missing');
    expect(notice.tier).toBe('contabilidad');
    expect(notice.title).toBe('El resumen de cuenta todavía no abre los movimientos');
    expect(notice.tab).toBe('jev');
    expect(notice.why).toMatch(/No los carga/);
    expect(notice.samples[0].href).toBe('/panel/dues?vista=saldos');
    expect(missing.counts.bien).toBe(1);

    const loaded = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '10', name: 'Ana Bien', documentNumber: '30111222', tier: 'socio', status: 'active' },
      ],
      accountLedgers: { loaded: 12 },
    });
    expect(loaded.items.find((item) => item.id === 'ledgers-missing')).toBeUndefined();

    const unknown = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '10', name: 'Ana Bien', documentNumber: '30111222', tier: 'socio', status: 'active' },
      ],
    });
    expect(unknown.items.find((item) => item.id === 'ledgers-missing')).toBeUndefined();
  });

  it('esconde contabilidad a quien no tiene esa pestaña y deja la ficha', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '1', name: '', documentNumber: '30111222', tier: 'socio', status: 'active' },
      ],
      unidentifiedCollections: [
        { id: 'u1', status: 'pending', date: '2026-09-01', note: 'pago suelto', amount: 10 },
      ],
    });
    const visible = reviewItemsForAccess(review.items, { tabs: ['members', 'dashboard'] });
    expect(visible.map((item) => item.id)).toEqual(['no-name']);
  });

  it('revisa gastos, cuota del mes, correo repetido, descuento vencido y alta pendiente', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '1', name: 'Ana', documentNumber: '30111222', tier: 'socio', status: 'active', email: 'ana@club.com' },
        { memberId: '2', name: 'Luis', documentNumber: '30111333', tier: 'socio', status: 'active', email: 'ana@club.com' },
      ],
      expenses: [{ id: 'e1', status: 'pending_approval', concept: 'Luz' }],
      feePeriods: [{ id: 'fp', year: 2026, month: 9, status: 'pending' }],
      membershipApplications: [{ id: 'a1', fullName: 'Eva', status: 'pending' }],
      discounts: [{ id: 'd1', isActive: true, description: 'Viejo', validTo: '2026-01-01', category: 'members' }],
      cashSessions: [{ id: 'cs', status: 'open', openedAt: '2026-09-20T10:00:00.000Z' }],
      claims: [{ id: 'cl', status: 'pending', date: '2026-09-01', title: 'Pileta' }],
    });

    const ids = review.items.map((item) => item.id);
    expect(ids.indexOf('expenses-pending')).toBeLessThan(ids.indexOf('discount-expired'));
    expect(ids.indexOf('discount-expired')).toBeLessThan(ids.indexOf('dup-email'));
    expect(ids.indexOf('dup-email')).toBeLessThan(ids.indexOf('cash-still-open'));
    expect(ids.indexOf('fee-month')).toBeGreaterThan(ids.indexOf('cash-still-open'));
    expect(ids).toContain('join-pending');
    expect(ids).toContain('claims-old');
    expect(review.counts.bien).toBe(0);
  });

  it('pone en Mercado Pago al socio que pide débito y al cobro rechazado', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        { memberId: '10', name: 'Ana Bien', documentNumber: '30111222', tier: 'socio', status: 'active', paymentMethod: 'transferencia' },
        { memberId: '11', name: 'Luis Debito', documentNumber: '30111333', tier: 'socio', status: 'active', paymentMethod: 'debito' },
        { memberId: '12', name: 'Eva Adherida', documentNumber: '30111444', tier: 'socio', status: 'active', paymentMethod: 'debito', mpAdhesion: 'authorized' },
        { memberId: '13', name: 'Nora Rechazada', documentNumber: '30111555', tier: 'socio', status: 'active', paymentMethod: 'debito', mpAdhesion: 'rejected' },
      ],
      galiciaDebits: [
        { id: 'd1', status: 'rejected', memberName: 'Adolfo Sarmiento', memberId: '2018' },
        { id: 'd2', status: 'sent', memberName: 'Victoria Cantoni', memberId: '2020' },
      ],
    });

    const adhesion = review.items.find((item) => item.id === 'mp-adhesion');
    const rejected = review.items.find((item) => item.id === 'mp-rejected');
    expect(adhesion.count).toBe(1);
    expect(adhesion.samples[0].label).toMatch(/Luis Debito/);
    expect(adhesion.samples[0].href).toBe('/panel/members/11?editar=1');
    expect(rejected.count).toBe(2);
    expect(rejected.title).toMatch(/Mercado Pago/);
    expect(review.items.map((item) => item.id)).not.toContain('galicia-rejected');
    expect(review.counts.bien).toBe(4);
  });

  it('suma saldo desparejo, familiar sin nacimiento, portal sin correo, turno de hoy y buzón viejo', () => {
    const review = buildClubReview({
      today: TODAY,
      members: [
        {
          memberId: '10',
          name: 'Ana Bien',
          documentNumber: '30111222',
          tier: 'socio',
          status: 'active',
          email: 'ana@club.com',
          outstandingBalance: 1000,
        },
        {
          memberId: '11',
          name: 'Luis Desparejo',
          documentNumber: '30111333',
          tier: 'socio',
          status: 'active',
          email: 'luis@club.com',
          outstandingBalance: 5000,
        },
        {
          memberId: '12',
          name: 'Hijo Sin Fecha',
          documentNumber: '40111001',
          tier: 'familiar',
          status: 'active',
          familyPrincipalNumber: '10',
          email: 'hijo@club.com',
        },
        {
          memberId: '13',
          name: 'Eva Portal',
          documentNumber: '30111444',
          tier: 'socio',
          status: 'active',
          profileId: 'p-eva',
        },
      ],
      accountBalances: {
        asOf: '2026-09-01',
        byNumber: {
          10: { balance: 1000 },
          11: { balance: 1200 },
        },
      },
      feePeriods: [{ id: 'fp', year: 2026, month: 9, status: 'processed' }],
      feeChargedNumbers: ['10', '11', '12'],
      reservations: [
        { id: 'r1', memberId: '10', date: '2026-09-26', time: '18:00', status: 'pending' },
      ],
      messages: [
        {
          id: 'm1',
          recipientId: 'ops',
          isRead: false,
          sender: 'Luis Desparejo',
          senderId: '11',
          subject: 'Pago por Mercado Pago',
          date: '2026-09-26',
          meta: { kind: 'dues_payment', method: 'mercadopago' },
        },
        {
          id: 'm2',
          recipientId: 'ops',
          isRead: false,
          sender: 'Ana Bien',
          subject: 'Consulta',
          date: '2026-09-20',
        },
        {
          id: 'm3',
          recipientId: 'ops',
          isRead: false,
          sender: 'Eva Portal',
          subject: 'Ya respondido',
          date: '2026-09-20',
        },
        {
          id: 'm4',
          parentId: 'm3',
          recipientId: '13',
          senderId: 'ops',
          isRead: false,
          date: '2026-09-21',
        },
      ],
    });

    const ids = review.items.map((item) => item.id);
    expect(ids).toContain('balance-gap');
    expect(ids).toContain('mp-notice');
    expect(ids).toContain('no-birth');
    expect(ids).toContain('portal-email');
    expect(ids).toContain('booking-pending');
    expect(ids).toContain('fee-missing');
    expect(ids).toContain('inbox-stale');
    expect(ids.indexOf('balance-gap')).toBeLessThan(ids.indexOf('no-birth'));
    expect(ids.indexOf('no-birth')).toBeLessThan(ids.indexOf('portal-email'));
    expect(ids.indexOf('portal-email')).toBeLessThan(ids.indexOf('booking-pending'));
    expect(ids.indexOf('booking-pending')).toBeLessThan(ids.indexOf('fee-missing'));
    expect(ids.indexOf('fee-missing')).toBeLessThan(ids.indexOf('inbox-stale'));
    expect(review.items.find((item) => item.id === 'balance-gap').count).toBe(1);
    expect(review.items.find((item) => item.id === 'fee-missing').samples[0].label).toMatch(/Eva Portal/);
    expect(review.items.find((item) => item.id === 'inbox-stale').count).toBe(1);
    expect(review.counts.bien).toBe(3);
  });
});
