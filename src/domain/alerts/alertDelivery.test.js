import { describe, expect, it } from 'vitest';
import { MAILBOX } from '../messaging/messages';
import {
  alertDmRecipient,
  alertDeliverySummary,
  alertMailAudience,
  buildAlertDmMessage,
} from './alertDelivery';

describe('alertDelivery', () => {
  it('manda MD a todos los socios o a operaciones según audiencia', () => {
    expect(alertDmRecipient('all')).toBe(MAILBOX.ALL_MEMBERS);
    expect(alertDmRecipient('members')).toBe(MAILBOX.ALL_MEMBERS);
    expect(alertDmRecipient('staff')).toBe(MAILBOX.OPERATIONS);
    expect(alertDmRecipient('admin')).toBe(MAILBOX.OPERATIONS);
  });

  it('arma el MD de alerta con meta club_alert', () => {
    const msg = buildAlertDmMessage({
      id: 'a1',
      title: 'Zonda',
      body: 'Canchas cerradas.',
      severity: 'critical',
      audience: 'all',
      source: 'manual',
    });
    expect(msg.recipientId).toBe(MAILBOX.ALL_MEMBERS);
    expect(msg.subject).toMatch(/Alerta/);
    expect(msg.meta.kind).toBe('club_alert');
    expect(alertMailAudience('members')).toBe('all');
    expect(alertMailAudience('staff')).toBe('staff');
  });

  it('resume el envío', () => {
    expect(alertDeliverySummary({
      dm: MAILBOX.ALL_MEMBERS,
      mail: true,
      mailed: { sent: 12, failed: 1 },
    })).toMatch(/MD a socios/);
    expect(alertDeliverySummary({
      dm: MAILBOX.ALL_MEMBERS,
      mail: true,
      mailed: { sent: 12, failed: 1 },
    })).toMatch(/12 mails/);
  });
});
