import { describe, expect, it } from 'vitest';
import {
  ageBucketForYears,
  ageYearsOn,
  buildEntryHourStats,
  buildMemberAgeStats,
  buildMemberStatsBundle,
  buildPaymentStats,
  memberStatsJevPrompt,
} from './memberStats';

describe('memberStats ages', () => {
  it('calcula edad cumplida y bucket', () => {
    expect(ageYearsOn('2000-03-10', '2026-11-16')).toBe(26);
    expect(ageYearsOn('2000-11-20', '2026-11-16')).toBe(25);
    expect(ageBucketForYears(26)?.id).toBe('26_35');
    expect(ageBucketForYears(3)?.id).toBe('lt4');
    expect(ageBucketForYears(70)?.id).toBe('66_plus');
  });

  it('arma rangos en vivo del padrón', () => {
    const stats = buildMemberAgeStats([
      { memberId: '1', status: 'active', tier: 'socio_familiar', birthDate: '1990-01-01' },
      { memberId: '2', status: 'active', tier: 'grupo_familiar_familiar', birthDate: '2015-06-01', familyPrincipalNumber: '1' },
      { memberId: '3', status: 'active', tier: 'socio_individual', birthDate: null },
      { memberId: '4', status: 'inactive', tier: 'socio_familiar', birthDate: '1980-01-01' },
    ], { on: '2026-11-16' });
    expect(stats.activos).toBe(3);
    expect(stats.sinEdad).toBe(1);
    expect(stats.withAge).toBe(2);
    expect(stats.buckets.find((b) => b.id === '36_45')?.count).toBe(1);
    expect(stats.buckets.find((b) => b.id === '6_12')?.count).toBe(1);
  });
});

describe('memberStats entries & payments', () => {
  it('agrupa ingresos por hora', () => {
    const stats = buildEntryHourStats([
      { date: '2026-11-16', time: '09:15:00', status: 'granted', daySource: 'ar' },
      { date: '2026-11-16', time: '09:40:00', status: 'granted', daySource: 'ar' },
      { date: '2026-11-15', time: '18:05:00', status: 'denied', daySource: 'ar' },
    ], { days: 7, today: '2026-11-16' });
    expect(stats.total).toBe(3);
    expect(stats.hours[9].count).toBe(2);
    expect(stats.peakHour?.hour).toBe(9);
    expect(stats.denied).toBe(1);
  });

  it('suma pagos y deuda', () => {
    const stats = buildPaymentStats([
      {
        memberId: '1',
        status: 'active',
        outstandingBalance: 70000,
        paymentHistory: [
          { date: '2026-10-05', amount: 70000, method: 'efectivo' },
          { date: '2026-09-04', amount: 70000, method: 'transferencia' },
        ],
      },
      {
        memberId: '2',
        status: 'active',
        outstandingBalance: 0,
        paymentHistory: [
          { date: '2026-11-02', amount: 40000, method: 'mercadopago' },
        ],
      },
    ], { months: 6, on: '2026-11-16' });
    expect(stats.withDebt).toBe(1);
    expect(stats.alDia).toBe(1);
    expect(stats.payments).toBe(3);
    expect(stats.amount).toBe(180000);
    expect(stats.methods[0].amount).toBeGreaterThan(0);
  });

  it('arma prompt para JEV', () => {
    const bundle = buildMemberStatsBundle([
      { memberId: '1', status: 'active', birthDate: '1990-01-01' },
    ], []);
    expect(memberStatsJevPrompt(bundle)).toMatch(/Jockey Club/);
    expect(memberStatsJevPrompt(bundle)).toMatch(/Activos/);
  });
});
