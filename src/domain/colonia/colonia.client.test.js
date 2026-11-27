import { describe, expect, it } from 'vitest';
import { navItemsForRole } from '../auth/roles';
import { COLONIA_MP_ENABLED, COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import {
  buildMemberColoniaHome,
  buildPortalEnrollmentPayload,
  coloniaBadgeForHouseholdMember,
  coloniaEnrollmentBalance,
  coloniaPortalHeroCopy,
  coloniaPortalMemberKind,
  coloniaSourceLabel,
  coloniaStatusLabel,
  matchHouseholdToEnrollment,
  portalEnabledPlans,
  validatePortalEnrollmentWizard,
} from './coloniaPortal';

const guardian = {
  fullName: 'María Pérez',
  phone: '2644000000',
  emergencyContact: 'Abuela 2644111111',
  authorizedPickup: 'Abuela',
  relationship: 'Madre',
};

const student = {
  fullName: 'Juan Pérez',
  birthDate: '2014-06-15',
  documentNumber: '50111222',
  memberKind: 'socio',
  memberNumber: '008770',
  shirtSize: 'M',
};

function wizard(overrides = {}) {
  return validatePortalEnrollmentWizard({
    step: 10,
    student,
    guardian,
    planKey: 'cuota',
    season: COLONIA_SEASON_2026_2027,
    todayIso: '2026-11-25',
    authorized: true,
    ...overrides,
  });
}

describe('app del socio — Colonia', () => {
  it('el menú del socio incluye Colonia junto a Mi cuenta', () => {
    const ids = navItemsForRole('member').map((item) => item.id);
    expect(ids).toContain('colonia');
    expect(ids).toContain('payments');
    expect(navItemsForRole('member').find((item) => item.id === 'colonia').label).toBe('Colonia');
  });

  it('Mercado Pago de Colonia está habilitado en la app', () => {
    expect(COLONIA_MP_ENABLED).toBe(true);
  });

  it('sin periodicidad no ofrece promo de hermanos', () => {
    expect(portalEnabledPlans({ promotionPeriodicity: null })).toEqual(['cuota', 'temporada', 'hermano_4']);
    expect(portalEnabledPlans({ promotion_periodicity: 'monthly' })).toContain('promo_2');
    expect(portalEnabledPlans({ promotion_periodicity: 'monthly' })).toContain('promo_3');
  });

  it('el inicio separa lo que falta, lo pagado y el mes que viene', () => {
    const home = buildMemberColoniaHome([
      {
        id: 'a',
        status: 'confirmada',
        plan_key: 'cuota',
        charges_total: 200000,
        payments_confirmed: 200000,
        payments_pending: 0,
        student: { full_name: 'Juan Pérez' },
      },
      {
        id: 'b',
        status: 'pendiente_pago',
        plan_key: 'temporada',
        charges_total: 390000,
        payments_confirmed: 50000,
        payments_pending: 0,
        student: { full_name: 'Ana Pérez' },
      },
      {
        id: 'c',
        status: 'cancelada',
        plan_key: 'cuota',
        charges_total: 0,
        payments_confirmed: 0,
      },
    ]);
    expect(home.dueTotal).toBe(340000);
    expect(home.paidTotal).toBe(250000);
    expect(home.mine[0].nextAmount).toBe(150000);
    expect(home.mine[1].nextAmount).toBe(0);
    expect(home.nextLabel.toLowerCase()).toMatch(/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/);
    expect(home.statusParts.map((part) => part.value)).toEqual([1, 1, 1]);
  });

  it('un pago en verificación no se cuenta como saldo saldado', () => {
    const bal = coloniaEnrollmentBalance({
      charges_total: 150000,
      payments_confirmed: 150000,
      payments_pending: 150000,
    });
    expect(bal.balance).toBe(0);
    expect(bal.paymentLabel).toBe('Pago en verificación');
    expect(coloniaEnrollmentBalance({
      charges_total: 150000,
      payments_confirmed: 0,
    }).paymentLabel).toBe('Saldo pendiente');
    expect(coloniaEnrollmentBalance({
      charges_total: 150000,
      payments_confirmed: 150000,
    }).paymentLabel).toBe('Al día');
  });

  it('la cuota de un no socio al día anuncia su tarifa, no la del socio', () => {
    const home = buildMemberColoniaHome([
      {
        status: 'confirmada',
        plan_key: 'cuota',
        charges_total: 180000,
        payments_confirmed: 180000,
        student: { member_kind: 'no_socio', full_name: 'Cami Ruiz' },
      },
    ]);
    expect(home.dueTotal).toBe(0);
    expect(home.mine[0].nextAmount).toBe(180000);
  });

  it('la cuota al día anuncia el mes que viene y la temporada no', () => {
    const home = buildMemberColoniaHome([
      {
        status: 'confirmada',
        plan_key: 'temporada',
        charges_total: 390000,
        payments_confirmed: 390000,
      },
    ]);
    expect(home.dueTotal).toBe(0);
    expect(home.mine[0].nextAmount).toBe(0);
  });

  it('la ficha del grupo distingue inscripto, sin ficha y fuera de edad', () => {
    const enrollments = [{
      status: 'confirmada',
      student_member_number: '101',
      student: { full_name: 'Ana López' },
    }];
    const enrolled = coloniaBadgeForHouseholdMember(
      { name: 'Ana López', memberId: '101', birthDate: '2015-03-01' },
      enrollments,
    );
    expect(enrolled.key).toBe('enrolled');
    expect(enrolled.label).toBe('Confirmada');
    expect(enrolled.tone).toBe('ok');
    expect(coloniaBadgeForHouseholdMember(
      { name: 'Bruno', memberId: '102', birthDate: '2016-01-01' },
      enrollments,
    ).label).toBe('Sin inscripción');
    expect(coloniaBadgeForHouseholdMember(
      { name: 'Adulto', memberId: '100', birthDate: '1980-01-01' },
      [],
    ).key).toBe('out_of_age');
  });

  it('empareja al integrante por número aunque el padrón tenga ceros', () => {
    const row = matchHouseholdToEnrollment(
      { memberId: '08770', name: 'Otro' },
      [{ student: { member_number: '8770', full_name: 'Juan Pérez' }, status: 'pendiente' }],
    );
    expect(row.status).toBe('pendiente');
  });

  it('el asistente pide cada dato antes de armar la inscripción', () => {
    expect(wizard({ step: 1, student: { ...student, fullName: ' ' } }).errors.some((e) => e.code === 'student_name')).toBe(true);
    expect(wizard({ step: 2, student: { ...student, birthDate: '2024-06-01' } }).errors.some((e) => e.code === 'age_out_of_range' || e.code === 'age')).toBe(true);
    expect(wizard({ step: 3, authorized: false }).errors.some((e) => e.code === 'not_authorized')).toBe(true);
    expect(wizard({ step: 4, guardian: { ...guardian, emergencyContact: '' } }).errors.some((e) => e.code === 'emergency')).toBe(true);
    expect(wizard({ step: 5, guardian: { ...guardian, authorizedPickup: '' } }).errors.some((e) => e.code === 'pickup')).toBe(true);
    expect(wizard({ step: 6, student: { ...student, shirtSize: '' } }).errors.some((e) => e.code === 'shirt')).toBe(true);
    expect(wizard({ step: 8, planKey: 'promo_2' }).errors.some((e) => e.code === 'plan')).toBe(false);
    expect(wizard({ step: 9, todayIso: '2026-12-15' }).errors.some((e) => e.code === 'window')).toBe(true);
    expect(wizard({ existingKeys: ['dni:50111222'] }).errors.some((e) => e.code === 'duplicate')).toBe(true);
    expect(wizard().ok).toBe(true);
  });

  it('la promo se habilita en la app cuando la temporada ya tiene periodicidad', () => {
    const check = wizard({
      planKey: 'promo_2',
      season: { ...COLONIA_SEASON_2026_2027, promotionPeriodicity: 'monthly' },
    });
    const codes = check.errors.map((error) => error.code);
    expect(codes).not.toContain('plan');
    expect(codes).not.toContain('promo_periodicity_missing');
  });

  it('el payload del portal no toca la cuota social y guarda el número real', () => {
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student,
      guardian,
      planKey: 'cuota',
      memberId: 'member-1',
      idempotencyKey: 'idem-1',
    });
    expect(payload.student.identity_key).toBe('dni:50111222');
    expect(payload.student.member_number).toBe('8770');
    expect(payload.student.member_kind).toBe('socio');
    expect(payload.guardian.emergency_contact).toContain('Abuela');
    expect(payload).not.toHaveProperty('outstanding_balance');
    expect(payload).not.toHaveProperty('chargeScope');
  });

  it('el no socio de pileta inscribe Colonia como no socio', () => {
    const guest = { tier: 'pileta_no_socio', cuotaCategories: ['PILETA (No socio)'] };
    expect(coloniaPortalMemberKind(guest)).toBe('no_socio');
    expect(coloniaPortalMemberKind({ tier: 'socio_familiar', cuotaCategories: ['SOCIO FAMILIAR'] })).toBe('socio');
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student: { ...student, memberKind: coloniaPortalMemberKind(guest), memberNumber: '' },
      guardian,
      planKey: 'cuota',
    });
    expect(payload.student.member_kind).toBe('no_socio');
    expect(payload.student.member_number).toBeNull();
  });

  it('un no socio también puede armar la ficha desde la app', () => {
    const check = wizard({
      student: { ...student, memberKind: 'no_socio', memberNumber: '' },
    });
    expect(check.ok).toBe(true);
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student: { ...student, memberKind: 'no_socio', memberNumber: '' },
      guardian,
      planKey: 'temporada',
    });
    expect(payload.student.member_kind).toBe('no_socio');
    expect(payload.planKey).toBe('temporada');
  });

  it('sin la cuenta de Mi cuenta, Colonia sigue en el menú del socio', () => {
    const ids = navItemsForRole('member', { membersCanViewCurrentAccounts: false }).map((item) => item.id);
    expect(ids).toContain('colonia');
    expect(ids).not.toContain('payments');
  });

  it('el cuarto hermano no se confirma en la app con un solo chico', () => {
    const check = wizard({ planKey: 'hermano_4' });
    expect(check.ok).toBe(false);
    expect(check.errors.some((error) => error.code === 'fourth_sibling_count')).toBe(true);
  });

  it('sin tarifa publicada la portada no inventa un monto', () => {
    const copy = coloniaPortalHeroCopy(COLONIA_SEASON_2026_2027, []);
    expect(copy.inscriptionNote).toContain('Consultá la inscripción');
  });

  it('la portada usa la temporada publicada', () => {
    const copy = coloniaPortalHeroCopy(COLONIA_SEASON_2026_2027, [
      { concept: 'colonia_inscripcion', amount: 50000 },
    ]);
    expect(copy.title).toContain('2026');
    expect(copy.ages).toContain('3');
    expect(copy.ages).toContain('15');
    expect(copy.schedule).toContain('09:00');
    expect(copy.inscriptionNote).toContain('50.000');
    expect(coloniaStatusLabel('confirmada')).toBe('Confirmada');
    expect(coloniaSourceLabel('portal')).toBe('Portal del socio');
  });
});
