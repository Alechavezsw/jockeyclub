/** Cuentas bancarias y medios de cobro institucionales del club. */

export const CLUB_BANK_ACCOUNTS = [
  {
    id: 'macro',
    name: 'Banco Macro',
    accountName: 'Jockey Club San Juan',
    cbu: '2850590940094123456789',
    alias: 'Jockey.club.sj',
    journalAccount: 'Banco Macro',
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    accountName: 'Jockey Club San Juan',
    cbu: '',
    alias: 'jockey.club.sj.mp',
    journalAccount: 'Mercado Pago',
  },
];

export const MERCADO_PAGO = {
  id: 'mercadopago',
  name: 'Mercado Pago',
  alias: 'jockey.club.sj.mp',
  cvu: '0000003100012345678901',
  journalAccount: 'Mercado Pago',
};

export const AMET_CASH_ACCOUNT = {
  id: 'amet',
  name: 'AMET',
  accountName: 'AMET',
  journalAccount: 'AMET',
};

export const CASH_JOURNAL_ACCOUNT = 'Caja General';

/** Payload de respaldo (alias) si el checkout todavía no está habilitado. */
export function buildMercadoPagoQrPayload({ amount, memberId, memberName, concept }) {
  const ref = `JCSJ-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  const label = concept || `Cuota social ${memberName || ''}`.trim();
  return [
    'mercadopago:',
    `alias=${MERCADO_PAGO.alias}`,
    `amount=${Number(amount) || 0}`,
    `ref=${ref}`,
    `concept=${label}`,
  ].join('|');
}

export function journalAccountForPayment(method, bankId) {
  // A cuenta: entrega en sede → Caja General (mismo bolsillo que efectivo).
  if (method === 'efectivo' || method === 'tarjeta' || method === 'a_cuenta' || method === 'caja') {
    return CASH_JOURNAL_ACCOUNT;
  }
  if (method === 'mercadopago') return MERCADO_PAGO.journalAccount;
  // Transferencia y débito (comprobante / manual) acreditan en el banco o alias elegido.
  if (method === 'transferencia' || method === 'debito') {
    const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === bankId) || CLUB_BANK_ACCOUNTS[0];
    return bank.journalAccount;
  }
  const bank = CLUB_BANK_ACCOUNTS.find((b) => b.id === bankId) || CLUB_BANK_ACCOUNTS[0];
  return bank.journalAccount;
}
