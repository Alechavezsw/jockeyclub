import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareEdgePackage } from './edgeFunctionGuard.js';
import { hashEdgePayload } from './edgeFunctionRelease.js';
import {
  createSimulatedEdgeUploader,
  createSupabaseEdgeUploader,
  publishAuthorizedEdgeFunction,
  redactSecrets,
} from './edgeFunctionPublisher.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edge-pub-'));
  const write = (name, source) => {
    const file = join(root, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
  };
  return { root, write };
}

function demoPackage() {
  const { root, write } = fixture();
  write('_shared/audience.ts', 'export function ready() { return 1; }\n');
  write('demo/index.ts', 'import { ready } from "../_shared/audience.ts";\nexport const value = ready();\n');
  return { root, prepared: prepareEdgePackage(root, 'demo') };
}

describe('publicador autorizado de Edge Functions', () => {
  it('el simulacro recibe exactamente el paquete validado', async () => {
    const { root, prepared } = demoPackage();
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    const uploader = createSimulatedEdgeUploader();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      upload: (payload) => uploader.upload(payload),
      fetchDeployed: (ctx) => uploader.fetchDeployed(ctx),
    });
    expect(result.deployed).toBe(true);
    expect(result.verifyFailed).toBe(false);
    const saved = uploader.store.bySlug.get('demo');
    expect(saved.packageSha256).toBe(prepared.manifest.packageSha256);
    expect(saved.files).toEqual(prepared.files);
    rmSync(root, { recursive: true, force: true });
  });

  it('bloquea dependencia faltante, truncado, import/export rotos y hash distinto', async () => {
    const missing = fixture();
    missing.write('demo/index.ts', 'import { ready } from "../_shared/missing.ts";\nexport const value = ready;\n');
    const badPrep = prepareEdgePackage(missing.root, 'demo');
    let uploaded = false;
    const blocked = await publishAuthorizedEdgeFunction({
      prepared: badPrep,
      confirm: '0'.repeat(64),
      upload: async () => { uploaded = true; },
    });
    expect(badPrep.ok).toBe(false);
    expect(blocked.deployed).toBe(false);
    expect(blocked.cancelled).toBe(true);
    expect(uploaded).toBe(false);
    rmSync(missing.root, { recursive: true, force: true });

    const { root, prepared } = demoPackage();
    const wrongHash = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: hashEdgePayload(prepared.files.map((file) => (
        file.name === 'index.ts' ? { ...file, content: `${file.content}\n` } : file
      ))).packageSha256,
      upload: async () => { uploaded = true; },
    });
    expect(wrongHash.deployed).toBe(false);
    expect(uploaded).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('informa error del proveedor y no declara éxito', async () => {
    const { root, prepared } = demoPackage();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      upload: async () => {
        throw new Error('Proveedor 500: boom sbp_secret_token_value');
      },
    });
    expect(result.deployed).toBe(false);
    expect(result.providerError).toBe(true);
    expect(result.problems.join(' ')).toMatch(/Proveedor 500/);
    expect(result.problems.join(' ')).not.toContain('sbp_secret_token_value');
    expect(redactSecrets('Bearer sbp_abcdefghijklmnop')).toContain('[redacted]');
    rmSync(root, { recursive: true, force: true });
  });

  it('detiene si la verificación posterior no coincide', async () => {
    const { root, prepared } = demoPackage();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      upload: async (payload) => ({ ok: true, slug: payload.slug }),
      fetchDeployed: async () => prepared.files.map((file) => (
        file.name === 'index.ts' ? { ...file, content: 'PLACEHOLDER\n' } : file
      )),
    });
    expect(result.deployed).toBe(false);
    expect(result.verifyFailed).toBe(true);
    expect(result.recovery.packageSha256).toBe(prepared.manifest.packageSha256);
    rmSync(root, { recursive: true, force: true });
  });

  it('el publicador de Supabase solo manda el multipart del paquete sellado', async () => {
    const { root, prepared } = demoPackage();
    const calls = [];
    const uploader = createSupabaseEdgeUploader({
      projectRef: 'demo-ref',
      accessToken: 'sbp_test_token_not_real',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), hasAuth: Boolean(init?.headers?.Authorization) });
        expect(String(init.headers.Authorization)).toMatch(/^Bearer /);
        expect(init.body).toBeInstanceOf(FormData);
        const names = [];
        for (const [key, value] of init.body.entries()) {
          if (key === 'file' && value && typeof value === 'object' && 'name' in value) {
            names.push(value.name);
          }
        }
        expect(names).toEqual(expect.arrayContaining(['index.ts', '../_shared/audience.ts']));
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ slug: 'demo', version: 1 }),
        };
      },
    });
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      upload: (payload) => uploader.upload(payload),
      fetchDeployed: async () => prepared.files,
    });
    expect(result.deployed).toBe(true);
    expect(calls[0].url).toMatch(/\/functions\/deploy\?slug=demo$/);
    rmSync(root, { recursive: true, force: true });
  });

  it('sin publicador no llama a la API', async () => {
    const { root, prepared } = demoPackage();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
    });
    expect(result.deployed).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.problems.join(' ')).toMatch(/No hay un publicador/);
    rmSync(root, { recursive: true, force: true });
  });
});
