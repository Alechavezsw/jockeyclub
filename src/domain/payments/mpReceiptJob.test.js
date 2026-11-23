import { describe, expect, it } from 'vitest';
import { nextReceiptStatus, settleMpReceipt } from '../../../supabase/functions/_shared/mpReceiptJob.js';

function queueAdmin() {
  const jobs = new Map();
  let chain = Promise.resolve();
  const sends = [];

  function exclusive(work) {
    const run = chain.then(work, work);
    chain = run.then(() => {}, () => {});
    return run;
  }

  return {
    sends,
    rpc(name, args) {
      return exclusive(async () => {
        const id = args.p_intent_id;
        if (name === 'claim_mp_receipt_job') {
          if (!jobs.has(id)) {
            jobs.set(id, {
              status: 'pending',
              attempts: 0,
              message_id: null,
              email_id: null,
              ops_notice_id: null,
              locked_until: null,
            });
          }
          const row = jobs.get(id);
          if (row.status === 'sent') return { data: { claimed: false, status: 'sent' }, error: null };
          if (row.locked_until && row.locked_until > Date.now()) {
            return { data: { claimed: false, status: 'locked' }, error: null };
          }
          row.attempts += 1;
          row.locked_until = Date.now() + 120000;
          return {
            data: {
              claimed: true,
              status: row.status,
              attempts: row.attempts,
              message_id: row.message_id,
              email_id: row.email_id,
              ops_notice_id: row.ops_notice_id,
            },
            error: null,
          };
        }
        const row = jobs.get(id);
        row.message_id = args.p_message_id || row.message_id;
        row.email_id = args.p_email_id || row.email_id;
        row.ops_notice_id = args.p_ops_notice_id || row.ops_notice_id;
        row.locked_until = null;
        row.status = nextReceiptStatus({
          messageId: row.message_id,
          emailId: row.email_id,
          opsNoticeId: row.ops_notice_id,
        });
        return { data: { status: row.status }, error: null };
      });
    },
  };
}

describe('settleMpReceipt', () => {
  it('reintenta el mail sin duplicar el mensaje y un tercer aviso no vuelve a enviar', async () => {
    const admin = queueAdmin();
    let emailFails = true;
    const deliver = async (prior) => {
      if (!prior.messageId) admin.sends.push('message');
      if (!prior.opsNoticeId) admin.sends.push('ops');
      if (!prior.emailId) {
        admin.sends.push('email');
        if (emailFails) return {
          messageId: prior.messageId || 'msg-1',
          opsNoticeId: prior.opsNoticeId || 'ops-1',
          emailId: null,
          emailError: 'Resend 502',
          receiptNumber: 'MP-1',
        };
      }
      return {
        messageId: prior.messageId || 'msg-1',
        opsNoticeId: prior.opsNoticeId || 'ops-1',
        emailId: 'mail-1',
        emailError: null,
        receiptNumber: 'MP-1',
      };
    };

    const first = await settleMpReceipt({ admin, intentId: 'intent-1', deliver });
    expect(first.status).toBe('retry');
    expect(admin.sends).toEqual(['message', 'ops', 'email']);

    emailFails = false;
    const second = await settleMpReceipt({ admin, intentId: 'intent-1', deliver });
    expect(second.status).toBe('sent');
    expect(admin.sends).toEqual(['message', 'ops', 'email', 'email']);

    const third = await settleMpReceipt({ admin, intentId: 'intent-1', deliver });
    expect(third.skip).toBe('already');
    expect(admin.sends).toHaveLength(4);
  });

  it('dos entregas concurrentes mandan una sola vez', async () => {
    const admin = queueAdmin();
    let started = 0;
    const deliver = async (prior) => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        messageId: prior.messageId || 'msg-1',
        emailId: 'mail-1',
        opsNoticeId: prior.opsNoticeId || 'ops-1',
        receiptNumber: 'MP-1',
      };
    };
    const [left, right] = await Promise.all([
      settleMpReceipt({ admin, intentId: 'intent-race', deliver }),
      settleMpReceipt({ admin, intentId: 'intent-race', deliver }),
    ]);
    const skips = [left.skip, right.skip].filter(Boolean);
    expect(started).toBe(1);
    expect(skips).toEqual(['locked']);
  });
});
