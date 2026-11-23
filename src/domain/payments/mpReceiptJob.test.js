import { describe, expect, it } from 'vitest';
import { nextReceiptStatus, settleMpReceipt, storedReceiptEmail } from '../../../supabase/functions/_shared/mpReceiptJob.js';

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
          if (row.status === 'attention' && !args.p_force) {
            return { data: { claimed: false, status: 'attention' }, error: null };
          }
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
        row.email_id = storedReceiptEmail(args.p_email_id) || row.email_id;
        row.ops_notice_id = args.p_ops_notice_id || row.ops_notice_id;
        row.locked_until = null;
        if (args.p_close) {
          row.status = 'sent';
          return { data: { status: row.status }, error: null };
        }
        row.status = nextReceiptStatus({
          messageId: row.message_id,
          emailId: row.email_id,
          opsNoticeId: row.ops_notice_id,
          permanent: Boolean(args.p_permanent),
          attempts: row.attempts,
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

  it('sin mail real omite el canal y no lo reintenta', async () => {
    const admin = queueAdmin();
    const deliver = async (prior) => {
      admin.sends.push('message');
      return {
        messageId: prior.messageId || 'msg-1',
        opsNoticeId: prior.opsNoticeId || 'ops-1',
        emailId: 'no-email',
        emailError: 'Sin mail real',
        receiptNumber: 'MP-1',
      };
    };
    const first = await settleMpReceipt({ admin, intentId: 'intent-nomail', deliver });
    expect(first.status).toBe('sent');
    expect(first.emailId).toBe('skipped:no-email');
    const second = await settleMpReceipt({ admin, intentId: 'intent-nomail', deliver });
    expect(second.skip).toBe('already');
    expect(admin.sends).toEqual(['message']);
  });

  it('un rechazo permanente del proveedor queda para intervención', async () => {
    const admin = queueAdmin();
    let calls = 0;
    const deliver = async (prior) => {
      calls += 1;
      return {
        messageId: prior.messageId || 'msg-1',
        opsNoticeId: prior.opsNoticeId || 'ops-1',
        emailId: null,
        emailError: 'Resend 422',
        permanent: true,
        receiptNumber: 'MP-1',
      };
    };
    const first = await settleMpReceipt({ admin, intentId: 'intent-permanent', deliver });
    expect(first.status).toBe('attention');
    const second = await settleMpReceipt({ admin, intentId: 'intent-permanent', deliver });
    expect(second.skip).toBe('attention');
    expect(calls).toBe(1);
    const forced = await settleMpReceipt({ admin, intentId: 'intent-permanent', deliver, force: true });
    expect(forced.status).toBe('attention');
    expect(calls).toBe(2);
  });

  it('si el proveedor aceptó el mail y no se guardó el id, el reintento usa la misma clave', async () => {
    const admin = queueAdmin();
    const provider = new Map();
    let crash = true;
    const deliver = async (prior) => {
      const key = 'mp-receipt/intent-lost';
      if (!provider.has(key)) provider.set(key, 'mail-real');
      const emailId = provider.get(key);
      if (crash) {
        crash = false;
        throw new Error('cae después de que Resend aceptó');
      }
      return {
        messageId: prior.messageId || 'msg-1',
        opsNoticeId: prior.opsNoticeId || 'ops-1',
        emailId,
        idempotencyKey: key,
        receiptNumber: 'MP-1',
      };
    };
    const first = await settleMpReceipt({ admin, intentId: 'intent-lost', deliver });
    expect(first.error).toMatch(/Resend aceptó/);
    expect(first.status).toBe('retry');
    const second = await settleMpReceipt({ admin, intentId: 'intent-lost', deliver });
    expect(second.status).toBe('sent');
    expect(second.emailId).toBe('mail-real');
    expect(provider.size).toBe(1);
  });

  it('un comprobante ya guardado en el cobro cierra la cola sin otro envío', async () => {
    const admin = queueAdmin();
    const deliver = async () => {
      admin.sends.push('no');
      return {
        skip: 'already',
        messageId: 'msg-prev',
        emailId: 'mail-prev',
        opsNoticeId: 'ops-prev',
        receiptNumber: 'MP-9',
      };
    };
    const first = await settleMpReceipt({ admin, intentId: 'intent-prev', deliver });
    expect(first.status).toBe('sent');
    const second = await settleMpReceipt({ admin, intentId: 'intent-prev', deliver });
    expect(second.skip).toBe('already');
    expect(admin.sends).toEqual(['no']);
  });

  it('un socio exento cierra el comprobante de cuota sin enviarlo', async () => {
    const admin = queueAdmin();
    let calls = 0;
    const deliver = async () => {
      calls += 1;
      return { skip: 'dues-exempt' };
    };
    const first = await settleMpReceipt({ admin, intentId: 'intent-exempt', deliver });
    expect(first.status).toBe('sent');
    const second = await settleMpReceipt({ admin, intentId: 'intent-exempt', deliver });
    expect(second.skip).toBe('already');
    expect(calls).toBe(1);
  });
});
