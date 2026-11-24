import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareEdgePackage } from './edgeFunctionGuard.js';
import { hashEdgePayload } from './edgeFunctionRelease.js';
import {
  EDGE_DEPLOY_STATUS,
  REMOTE_SOURCE_LIMITATION,
  createSimulatedEdgeUploader,
  createSupabaseEdgeUploader,
  interpretRemoteDeployRead,
  publishAuthorizedEdgeFunction,
  redactSecrets,
  summarizeDeployOutcome,
} from './edgeFunctionPublisher.js';

const repoRoot = join(import.meta.dirname, '../../..');

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

describe('estados del publicador de Edge Functions', () => {
  it('el simulacro es status=simulated y nunca published', async () => {
    const { root, prepared } = demoPackage();
    const uploader = createSimulatedEdgeUploader();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'simulate',
      upload: (payload) => uploader.upload(payload),
      fetchDeployed: (ctx) => uploader.fetchDeployed(ctx),
    });
    expect(result.status).toBe(EDGE_DEPLOY_STATUS.SIMULATED);
    expect(result.deployed).toBe(false);
    expect(result.summary.simulated).toBe(true);
    expect(result.summary.published).toBe(false);
    expect(result.summary.verified).toBe(false);
    expect(uploader.store.bySlug.get('demo').files).toEqual(prepared.files);
    rmSync(root, { recursive: true, force: true });
  });

  it('published_verified solo con fuentes remotas idénticas', async () => {
    const { root, prepared } = demoPackage();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      upload: async (payload) => ({ slug: payload.slug }),
      fetchDeployed: async () => ({ kind: 'sources', files: prepared.files }),
    });
    expect(result.status).toBe(EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED);
    expect(result.deployed).toBe(true);
    expect(result.summary.verified).toBe(true);
    expect(result.limitation).toBe('');
    rmSync(root, { recursive: true, force: true });
  });

  it('respuesta opaca de Supabase → published_unverified o failed según política', async () => {
    const { root, prepared } = demoPackage();
    const opaque = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      unverifiedPolicy: 'accept',
      upload: async (payload) => ({ slug: payload.slug }),
      fetchDeployed: async () => ({ kind: 'opaque', limitation: REMOTE_SOURCE_LIMITATION }),
    });
    expect(opaque.status).toBe(EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED);
    expect(opaque.deployed).toBe(true);
    expect(opaque.summary.unverified).toBe(true);
    expect(opaque.summary.verified).toBe(false);
    expect(opaque.limitation).toMatch(/opaco|eszip|byte a byte/i);
    expect(opaque.problems.join(' ')).toMatch(/No se inventaron hashes/);

    const stopped = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      unverifiedPolicy: 'fail',
      upload: async (payload) => ({ slug: payload.slug }),
      fetchDeployed: async () => ({ kind: 'opaque', limitation: REMOTE_SOURCE_LIMITATION }),
    });
    expect(stopped.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(stopped.verifyFailed).toBe(true);
    expect(stopped.recovery.packageSha256).toBe(prepared.manifest.packageSha256);
    rmSync(root, { recursive: true, force: true });
  });

  it('interpretRemoteDeployRead no inventa hashes ni declara fuentes falsas', () => {
    expect(interpretRemoteDeployRead({ kind: 'opaque', limitation: 'x' }).kind).toBe('opaque');
    expect(interpretRemoteDeployRead({ kind: 'sources', files: [{ name: 'a', content: '1' }] }).kind).toBe('sources');
    expect(interpretRemoteDeployRead(null).kind).toBe('error');
    expect(interpretRemoteDeployRead({ weird: true }).kind).toBe('error');
  });

  it('failed ante dependencia faltante, hash distinto, proveedor y mismatch', async () => {
    const missing = fixture();
    missing.write('demo/index.ts', 'import { ready } from "../_shared/missing.ts";\nexport const value = ready;\n');
    const badPrep = prepareEdgePackage(missing.root, 'demo');
    let uploaded = false;
    const blocked = await publishAuthorizedEdgeFunction({
      prepared: badPrep,
      confirm: '0'.repeat(64),
      mode: 'supabase',
      upload: async () => { uploaded = true; },
    });
    expect(blocked.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(blocked.cancelled).toBe(true);
    expect(uploaded).toBe(false);
    rmSync(missing.root, { recursive: true, force: true });

    const { root, prepared } = demoPackage();
    const wrongHash = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: hashEdgePayload(prepared.files.map((file) => (
        file.name === 'index.ts' ? { ...file, content: `${file.content}\n` } : file
      ))).packageSha256,
      mode: 'supabase',
      upload: async () => { uploaded = true; },
    });
    expect(wrongHash.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(uploaded).toBe(false);

    const provider = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      upload: async () => {
        throw new Error('Proveedor 500: boom sbp_secret_token_value');
      },
    });
    expect(provider.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(provider.providerError).toBe(true);
    expect(provider.problems.join(' ')).not.toContain('sbp_secret_token_value');
    expect(redactSecrets('Bearer sbp_abcdefghijklmnop')).toContain('[redacted]');

    const mismatch = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      upload: async (payload) => ({ slug: payload.slug }),
      fetchDeployed: async () => ({
        kind: 'sources',
        files: prepared.files.map((file) => (
          file.name === 'index.ts' ? { ...file, content: 'PLACEHOLDER\n' } : file
        )),
      }),
    });
    expect(mismatch.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(mismatch.verifyFailed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('el publicador de Supabase marca opaco un cuerpo eszip/no JSON', async () => {
    const { root, prepared } = demoPackage();
    let phase = 0;
    const uploader = createSupabaseEdgeUploader({
      projectRef: 'demo-ref',
      accessToken: 'sbp_test_token_not_real',
      fetchImpl: async (url) => {
        phase += 1;
        if (String(url).includes('/deploy')) {
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ slug: 'demo', version: 1 }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => 'EZBR\0compiled-bundle-not-source',
        };
      },
    });
    const remote = await uploader.fetchDeployed({ payload: { slug: 'demo' } });
    expect(remote.kind).toBe('opaque');
    expect(remote.limitation).toBe(REMOTE_SOURCE_LIMITATION);

    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
      unverifiedPolicy: 'fail',
      upload: (payload) => uploader.upload(payload),
      fetchDeployed: (ctx) => uploader.fetchDeployed(ctx),
    });
    expect(phase).toBeGreaterThan(0);
    expect(result.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(result.limitation).toBe(REMOTE_SOURCE_LIMITATION);
    rmSync(root, { recursive: true, force: true });
  });

  it('summarizeDeployOutcome distingue los cuatro estados', () => {
    expect(summarizeDeployOutcome({ status: EDGE_DEPLOY_STATUS.SIMULATED }).simulated).toBe(true);
    expect(summarizeDeployOutcome({ status: EDGE_DEPLOY_STATUS.PUBLISHED_VERIFIED }).verified).toBe(true);
    expect(summarizeDeployOutcome({ status: EDGE_DEPLOY_STATUS.PUBLISHED_UNVERIFIED }).unverified).toBe(true);
    expect(summarizeDeployOutcome({ status: EDGE_DEPLOY_STATUS.FAILED }).failed).toBe(true);
  });

  it('sin publicador falla y no llama a la API', async () => {
    const { root, prepared } = demoPackage();
    const result = await publishAuthorizedEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      mode: 'supabase',
    });
    expect(result.status).toBe(EDGE_DEPLOY_STATUS.FAILED);
    expect(result.cancelled).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('seguridad del workflow de Edge Functions', () => {
  it('solo workflow_dispatch, dry-run sin secretos y publish detrás de environment', () => {
    const yaml = readFileSync(join(repoRoot, '.github/workflows/deploy-edge-functions.yml'), 'utf8');
    expect(yaml).toMatch(/workflow_dispatch:/);
    expect(yaml).not.toMatch(/\bpush:\s*$/m);
    expect(yaml).toMatch(/environment:\s*production-edge/);
    expect(yaml).toMatch(/if: \$\{\{ inputs\.dry_run \}\}/);
    expect(yaml).toMatch(/if: \$\{\{ inputs\.dry_run == false \}\}/);
    expect(yaml).toMatch(/merge-base --is-ancestor/);
    expect(yaml).toMatch(/status !== 'simulated'/);
    expect(yaml).toMatch(/published_verified/);
    // Secretos solo referenciados en el job publish (environment protegido).
    const simulateBlock = yaml.slice(yaml.indexOf('simulate:'), yaml.indexOf('publish:'));
    const publishBlock = yaml.slice(yaml.indexOf('publish:'));
    expect(simulateBlock).not.toMatch(/secrets\.SUPABASE_/);
    expect(simulateBlock).toMatch(/SUPABASE_ACCESS_TOKEN: ''/);
    expect(publishBlock).toMatch(/secrets\.SUPABASE_ACCESS_TOKEN/);
    expect(publishBlock).toMatch(/secrets\.SUPABASE_PROJECT_REF/);
    expect(yaml).not.toMatch(/echo:.*SUPABASE_ACCESS_TOKEN|printenv.*TOKEN/i);
  });

  it('test.yml no publica Edge Functions en push', () => {
    const yaml = readFileSync(join(repoRoot, '.github/workflows/test.yml'), 'utf8');
    expect(yaml).toMatch(/deploy-edge-function\.mjs --check/);
    expect(yaml).not.toMatch(/--publish/);
  });
});
