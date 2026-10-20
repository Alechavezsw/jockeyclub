import { describe, expect, it } from 'vitest';
import {
  cycleDueOnFromToday,
  duesNoticeCalendar,
  duesNoticeCopy,
  duesNoticeKind,
  duesNoticeStagesForDay,
  duesNoticeStagesForMember,
  shouldSendDuesNotice,
} from './duesNotices';

describe('duesNotices', () => {
  it('el 5 manda aviso de por vencer, el 10 de vencimiento y el 11 de mora', () => {
    expect(duesNoticeCalendar(10)).toEqual({
      dueDay: 10,
      advanceDays: 5,
      upcomingDay: 5,
      moraDay: 11,
    });
    expect(duesNoticeStagesForDay('2026-10-05')).toEqual(['upcoming']);
    expect(duesNoticeStagesForDay('2026-10-10')).toEqual(['due']);
    expect(duesNoticeStagesForDay('2026-10-11')).toEqual(['mora']);
    expect(duesNoticeStagesForDay('2026-10-04')).toEqual([]);
  });

  it('si se atrasó el cron, el 12 ya manda mora, no el aviso de vencimiento', () => {
    expect(duesNoticeStagesForDay('2026-10-12')).toEqual(['mora']);
    expect(duesNoticeStagesForDay('2026-10-20')).toEqual(['mora']);
  });

  it('arma el ciclo del mes y el texto con mora', () => {
    expect(cycleDueOnFromToday('2026-10-15')).toBe('2026-10-10');
    expect(duesNoticeKind('upcoming')).toBe('dues_upcoming');
    expect(duesNoticeKind('mora')).toBe('dues_mora');
    const upcoming = duesNoticeCopy({ name: 'Alejandro', dueOn: '2026-10-10', stage: 'upcoming' });
    expect(upcoming.subject).toMatch(/vence el 10 de octubre/i);
    expect(upcoming.consequences).toMatch(/recargo del 10/i);
    expect(upcoming.consequences).toMatch(/pileta/i);
    const mora = duesNoticeCopy({ name: 'Alejandro', dueOn: '2026-10-10', stage: 'mora' });
    expect(mora.subject).toMatch(/mora/i);
    expect(mora.lead).toMatch(/venció/i);
    expect(mora.greeting).toMatch(/Alejandro/);
    expect(mora.accountUrl).toBe('https://www.jockeyclubsj.com.ar/cuenta');
  });

  it('AMET avisa el 13, vence el 18 y mora el 19, sin recargo del 10 %', () => {
    expect(duesNoticeCalendar(18)).toEqual({
      dueDay: 18,
      advanceDays: 5,
      upcomingDay: 13,
      moraDay: 19,
    });
    const amet = { status: 'active', tier: 'socio_familiar_amet', cuotaCategories: ['SOCIO FAMILIAR (AMET)'] };
    expect(duesNoticeStagesForMember(amet, '2026-10-13')).toEqual(['upcoming']);
    expect(duesNoticeStagesForMember(amet, '2026-10-18')).toEqual(['due']);
    expect(duesNoticeStagesForMember(amet, '2026-10-19')).toEqual(['mora']);
    expect(duesNoticeStagesForMember(amet, '2026-10-11')).toEqual([]);
    const copy = duesNoticeCopy({ name: 'Paula', dueOn: '2026-10-18', stage: 'due', amet: true });
    expect(copy.lead).toMatch(/AMET/i);
    expect(copy.consequences).not.toMatch(/día 11/);
    expect(copy.consequences).toMatch(/18/);
  });

  it('vitalicio, fundador y comisión no reciben aviso de cuota', () => {
    expect(shouldSendDuesNotice({ status: 'active', tier: 'socio_vitalicio', notifyDues: true })).toBe(false);
    expect(shouldSendDuesNotice({ status: 'active', tier: 'socio_fundador', notifyDues: true })).toBe(false);
    expect(shouldSendDuesNotice({ status: 'active', tier: 'comision', cuotaCategories: ['COMISION'], notifyDues: true })).toBe(false);
    expect(shouldSendDuesNotice({ status: 'active', tier: 'socio_individual', notifyDues: true })).toBe(true);
  });
});
