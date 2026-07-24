/** Cuentas bancarias y medios de cobro institucionales del club. */

export const CLUB_BANK_ACCOUNTS = [
  {
    id: 'nacion',
    name: 'Banco Nación',
    accountName: 'Jockey Club San Juan',
    cbu: '0110599520000001234567',
    alias: 'JOCKEY.CLUB.SJ',
    journalAccount: 'Banco Nación',
  },
];

export const MERCADO_PAGO = {
  id: 'mercadopago',
  name: 'Mercado Pago',
  alias: 'jockey.club.sj.mp',
  cvu: '0000003100012345678901',
  journalAccount: 'Banco Nación',
};

export const CASH_JOURNAL_ACCOUNT = 'Caja General';

/** Payload del QR de cobro MP (demo operativo hasta integrar API real). */
export function buildMercadoPagoQrPayload({ amount, memberId, memberName }) {
  const ref = `JCSJ-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  return [
    'mercadopago:',
    `alias=${MERCADO_PAGO.alias}`,
    `amount=${Number(amount) || 0}`,
    `ref=${ref}`,
    `concept=Cuota social ${memberName || ''}`.trim(),
  ].join('|');
}

export function journalAccountForPayment(method, bankId) {
  if (method === 'efectivo') return CASH_JOURNAL_ACCOUNT;
  if (method === 'mercadopago') return MERCADO_PAGO.journalAccount;
  const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === bankId) || CLUB_BANK_ACCOUNTS[0];
  return bank.journalAccount;
}
