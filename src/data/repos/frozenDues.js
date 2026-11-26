import { unwrap } from '../errors';
import { sb } from './shared.js';
import { frozenAgreementFromDb } from '../../domain/members/frozenDuesAgreement.js';

/** Acuerdo activo del socio, con capital autorizado y saldo abierto por período. */
export async function listFrozenDuesAgreement(memberDbId) {
  if (!memberDbId) return null;
  const row = await unwrap(
    sb()
      .from('member_dues_frozen_agreement_balances')
      .select('*')
      .eq('member_id', memberDbId)
      .eq('status', 'active')
      .maybeSingle(),
    'No se pudo leer el acuerdo de deuda histórica',
  );
  return frozenAgreementFromDb(row);
}
