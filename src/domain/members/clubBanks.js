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
    alias: '',
    journalAccount: 'Mercado Pago',
  },
];

export const MERCADO_PAGO = {
  id: 'mercadopago',
  name: 'Mercado Pago',
  alias: '',
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
/** POS / Visa pendiente de liquidación: no es efectivo de caja. */
export const CARD_JOURNAL_ACCOUNT = 'Tarjetas a cobrar';

/** Payload de respaldo (alias) si el checkout todavía no está habilitado. */
export function buildMercadoPagoQrPayload({ amount, memberId, memberName, concept }) {
  const ref = `JCSJ-${String(memberId || '').slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
  const label = concept || `Cuota social ${memberName || ''}`.trim();
  return [
    'mercadopago:',
    `amount=${Number(amount) || 0}`,
    `ref=${ref}`,
    `concept=${label}`,
  ].join('|');
}

export function journalAccountForPayment(method, bankId) {
  // Pago POS / tarjeta: activo a cobrar hasta liquidar el cupón (no Caja General).
  const methodKey = String(method || '').trim().toLowerCase();
  if (methodKey === 'tarjeta' || methodKey === 'pos' || methodKey === 'pago pos' || methodKey === 'card') {
    return CARD_JOURNAL_ACCOUNT;
  }
  // A cuenta / efectivo: entrega en sede → Caja General.
  if (method === 'efectivo' || method === 'a_cuenta' || method === 'caja') {
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
