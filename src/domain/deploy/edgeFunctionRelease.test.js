import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareEdgePackage } from './edgeFunctionGuard';
import {
  EDGE_DEPLOY_LIMIT,
  authorizeEdgePayload,
  confirmDeployedEdge,
  hashEdgePayload,
  publishEdgeFunction,
} from './edgeFunctionRelease';

const repoRoot = join(import.meta.dirname, '../../..');
const repoFunctions = join(repoRoot, 'supabase', 'functions');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edge-release-'));
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
  const prepared = prepareEdgePackage(root, 'demo');
  return { root, prepared };
}

describe('publicación autorizada de Edge Functions', () => {
  it('el hash del envío es el del paquete leído del disco', () => {
    const prepared = prepareEdgePackage(repoFunctions, 'send-club-mail');
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    expect(hashEdgePayload(prepared.files).packageSha256).toBe(prepared.manifest.packageSha256);
  });

  it('no publica si falta una dependencia', () => {
    const { root, write } = fixture();
    write('demo/index.ts', 'import { ready } from "../_shared/missing.ts";\nexport const value = ready;\n');
    const prepared = prepareEdgePackage(root, 'demo');
    let uploaded = false;
    const result = publishEdgeFunction({
      prepared,
      confirm: 'abc',
      upload: () => { uploaded = true; },
    });
    expect(prepared.ok).toBe(false);
    expect(result.deployed).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(uploaded).toBe(false);
    expect(result.recovery.steps.join(' ')).toMatch(/no intercepta/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('rechaza un archivo truncado, un import roto y un paquete distinto', () => {
    const { root, prepared } = demoPackage();
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    const truncated = {
      slug: prepared.slug,
      files: prepared.files.map((file) => (
        file.name === 'index.ts' ? { ...file, content: file.content.slice(0, 12) } : file
      )),
    };
    const truncatedDecision = authorizeEdgePayload(prepared, truncated);
    expect(truncatedDecision.ok).toBe(false);
    expect(truncatedDecision.problems.join(' ')).toMatch(/no coincide|hash/);

    const marker = {
      slug: prepared.slug,
      files: prepared.files.map((file) => (
        file.name === 'index.ts' ? { ...file, content: 'PLACEHOLDER' } : file
      )),
    };
    expect(authorizeEdgePayload(prepared, marker).ok).toBe(false);

    const extra = {
      slug: prepared.slug,
      files: [...prepared.files, { name: 'extra.ts', content: 'export const extra = 1;\n' }],
    };
    expect(authorizeEdgePayload(prepared, extra).ok).toBe(false);

    let uploaded = false;
    const published = publishEdgeFunction({
      prepared,
      confirm: hashEdgePayload(truncated.files).packageSha256,
      upload: () => { uploaded = true; },
    });
    expect(published.deployed).toBe(false);
    expect(uploaded).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('publica el paquete del disco solo si la confirmación es su hash', () => {
    const { root, prepared } = demoPackage();
    let payload = null;
    const wrong = publishEdgeFunction({
      prepared,
      confirm: '0'.repeat(64),
      upload: (sent) => { payload = sent; },
    });
    expect(wrong.deployed).toBe(false);
    expect(payload).toBeNull();

    const right = publishEdgeFunction({
      prepared,
      confirm: prepared.manifest.packageSha256,
      upload: (sent) => { payload = sent; },
    });
    expect(right.deployed).toBe(true);
    expect(payload.files).toEqual(prepared.files);
    expect(hashEdgePayload(payload.files).packageSha256).toBe(prepared.manifest.packageSha256);
    rmSync(root, { recursive: true, force: true });
  });

  it('la lectura desplegada tiene que coincidir y, si no, deja cómo recuperarla', () => {
    const { root, prepared } = demoPackage();
    const same = confirmDeployedEdge(prepared, prepared.files);
    expect(same.ok).toBe(true);
    expect(same.recovery).toBeNull();

    const crlf = prepared.files.map((file) => ({
      name: file.name,
      content: file.content.replace(/\n/g, '\r\n'),
    }));
    expect(confirmDeployedEdge(prepared, crlf).ok).toBe(true);

    const remote = prepared.files.map((file) => (
      file.name === 'index.ts' ? { ...file, content: 'PLACEHOLDER\n' } : file
    ));
    const mismatch = confirmDeployedEdge(prepared, remote);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.problems.join(' ')).toMatch(/no coincide/);
    expect(mismatch.recovery.packageSha256).toBe(prepared.manifest.packageSha256);
    expect(mismatch.recovery.steps.join(' ')).toMatch(/deploy-edge-function/);
    expect(mismatch.recovery.steps.join(' ')).toContain(EDGE_DEPLOY_LIMIT);
    rmSync(root, { recursive: true, force: true });
  });

  it('el comando local no llama a la API aunque le pidan publicar', () => {
    const result = spawnSync(process.execPath, [
      'scripts/deploy-edge-function.mjs',
      '--publish',
      '--slug',
      'send-club-mail',
      '--confirm',
      '0'.repeat(64),
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/no intercepta una llamada directa a la API/i);
    expect(result.stderr).toMatch(/No se publica|No se llama a la API/);
  });

  it('el simulacro del comando queda en status=simulated, no published', () => {
    const prepared = prepareEdgePackage(repoFunctions, 'send-access-invite');
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    const result = spawnSync(process.execPath, [
      'scripts/deploy-edge-function.mjs',
      '--publish',
      '--simulate',
      '--slug',
      'send-access-invite',
      '--confirm',
      prepared.manifest.packageSha256,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: 'sbp_should_be_ignored',
        SUPABASE_PROJECT_REF: 'should-be-ignored',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.status).toBe('simulated');
    expect(body.deployed).toBe(false);
    expect(body.summary.published).toBe(false);
    expect(body.summary.simulated).toBe(true);
    expect(body.packageSha256).toBe(prepared.manifest.packageSha256);
    expect(result.stderr).toMatch(/simulated/i);
  });

  it('un commit fuera de main bloquea el comando', () => {
    const result = spawnSync(process.execPath, [
      'scripts/deploy-edge-function.mjs',
      '--slug',
      'send-access-invite',
      '--require-main-sha',
      'a'.repeat(40),
    ], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no pertenece a main/i);
  });
});
