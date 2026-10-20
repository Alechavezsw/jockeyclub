import { describe, expect, it, vi } from 'vitest';
import { createCredentialVerifier, isMissingVerifyFunction, sha256Hex } from './credentialCheck';

const TOKEN = '3f9a0c7be21d4c55a8b6e0f1d29c7a44';

describe('sha256Hex', () => {
  it('es el SHA-256 de siempre', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('createCredentialVerifier', () => {
  it('firma buena: el servidor dice que sí y la segunda lectura sale de memoria, sin red', async () => {
    const verifyRemote = vi.fn().mockResolvedValue({ found: true, valid: true });
    const verifier = createCredentialVerifier({ verifyRemote });
    expect(await verifier.verify('1001', TOKEN)).toEqual({ status: 'valid', source: 'server' });
    expect(await verifier.verify('1001', TOKEN.toUpperCase())).toEqual({ status: 'valid', source: 'cache' });
    expect(verifyRemote).toHaveBeenCalledTimes(1);
  });

  it('sin internet, un socio ya verificado sigue pasando', async () => {
    const verifyRemote = vi.fn()
      .mockResolvedValueOnce({ found: true, valid: true })
      .mockRejectedValue(new Error('Failed to fetch'));
    const verifier = createCredentialVerifier({ verifyRemote });
    await verifier.verify('1001', TOKEN);
    expect((await verifier.verify('1001', TOKEN)).status).toBe('valid');
  });

  it('sin internet y sin haberlo visto: «no pude verificar», nunca «adulterado»', async () => {
    const verifyRemote = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const verifier = createCredentialVerifier({ verifyRemote });
    expect(await verifier.verify('1001', TOKEN)).toEqual({ status: 'unreachable', source: 'server' });
  });

  it('firma que no es: inválida, y una firma buena de antes ya no vale', async () => {
    const verifyRemote = vi.fn()
      .mockResolvedValueOnce({ found: true, valid: true })
      .mockResolvedValueOnce({ found: true, valid: false });
    const verifier = createCredentialVerifier({ verifyRemote });
    await verifier.verify('1001', TOKEN);
    const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect((await verifier.verify('1001', other)).status).toBe('invalid');
  });

  it('socio que no existe', async () => {
    const verifier = createCredentialVerifier({ verifyRemote: async () => ({ found: false, valid: false }) });
    expect((await verifier.verify('9999', TOKEN)).status).toBe('unknown_member');
  });

  it('la ficha en memoria que ya trae la firma no necesita red', async () => {
    const verifyRemote = vi.fn();
    const verifier = createCredentialVerifier({ verifyRemote });
    const result = await verifier.verify('1001', TOKEN, { member: { credentialToken: TOKEN } });
    expect(result).toEqual({ status: 'valid', source: 'local' });
    expect(verifyRemote).not.toHaveBeenCalled();
  });

  it('lo verificado vence a las 12 horas', async () => {
    let t = 1_000;
    const verifyRemote = vi.fn().mockResolvedValue({ found: true, valid: true });
    const verifier = createCredentialVerifier({ verifyRemote, now: () => t, ttlMs: 60_000 });
    await verifier.verify('1001', TOKEN);
    t += 30_000;
    expect((await verifier.verify('1001', TOKEN)).source).toBe('cache');
    t += 60_000;
    expect((await verifier.verify('1001', TOKEN)).source).toBe('server');
    expect(verifyRemote).toHaveBeenCalledTimes(2);
  });

  it('mientras el servidor no tenga la función nueva, usa el camino de antes', async () => {
    const missing = Object.assign(new Error('Could not find the function public.verify_member_credential'), { code: 'PGRST202' });
    const verifyRemote = vi.fn().mockRejectedValue(missing);
    const fetchMember = vi.fn().mockResolvedValue({ credentialToken: TOKEN });
    const verifier = createCredentialVerifier({ verifyRemote, fetchMember });
    expect(await verifier.verify('1001', TOKEN)).toEqual({ status: 'valid', source: 'fallback' });
    fetchMember.mockResolvedValue({ credentialToken: 'cccccccccccccccccccccccccccccccc' });
    expect((await verifier.verify('1002', TOKEN)).status).toBe('invalid');
    fetchMember.mockRejectedValue(new Error('Failed to fetch'));
    expect((await verifier.verify('1003', TOKEN)).status).toBe('unreachable');
  });

  it('sin firma no hay nada que verificar', async () => {
    const verifier = createCredentialVerifier({ verifyRemote: vi.fn() });
    expect((await verifier.verify('1001', '')).status).toBe('invalid');
    expect((await verifier.verify('', TOKEN)).status).toBe('invalid');
  });
});

describe('isMissingVerifyFunction', () => {
  it('reconoce que la función no existe, no un corte de red', () => {
    expect(isMissingVerifyFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingVerifyFunction({ code: '42883' })).toBe(true);
    expect(isMissingVerifyFunction({ message: 'Could not find the function public.verify_member_credential(p_member_number) in the schema cache' })).toBe(true);
    expect(isMissingVerifyFunction(new Error('Failed to fetch'))).toBe(false);
  });
});
