import { describe, expect, it } from 'vitest';
import {
  cycleDueOnFromToday,
  duesNoticeCalendar,
  duesNoticeCopy,
  duesNoticeKind,
  duesNoticeStagesForDay,
} from './duesNotices';

describe('duesNotices', () => {
  it('el 5 manda aviso de por vencer, el 10 de vencimiento y el 15 de mora', () => {
    expect(duesNoticeCalendar(10)).toEqual({
      dueDay: 10,
      advanceDays: 5,
      upcomingDay: 5,
      moraDay: 15,
    });
    expect(duesNoticeStagesForDay('2026-10-05')).toEqual(['upcoming']);
    expect(duesNoticeStagesForDay('2026-10-10')).toEqual(['due']);
    expect(duesNoticeStagesForDay('2026-10-15')).toEqual(['mora']);
    expect(duesNoticeStagesForDay('2026-10-04')).toEqual([]);
  });

  it('si se atrasó el cron, el 12 todavía manda el del 10 y el 16 el de mora', () => {
    expect(duesNoticeStagesForDay('2026-10-12')).toEqual(['due']);
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
  });
});
