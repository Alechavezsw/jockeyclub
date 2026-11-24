/**
 * Único procedimiento de publicación de Edge Functions.
 *
 * Por defecto (--check implícito): lee el repositorio, resuelve dependencias,
 * compila, arma el manifiesto SHA-256 y compara el paquete consigo mismo.
 *
 * --publish exige --slug, --confirm=<packageSha256> y un publicador:
 *   --simulate  → no llama a la red; guarda el paquete sellado en memoria/archivo
 *   sin --simulate → usa SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (solo CI)
 *
 * --require-main-sha=<sha> exige que el SHA sea ancestro de refs/remotes/origin/main
 * o de la punta local de main.
 *
 * Un llamado directo a la API de Supabase no pasa por este archivo.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizeMainCommit, normalizeCommitSha } from '../src/domain/deploy/edgeCommitGuard.js';
import { checkEdgeFunctions, prepareEdgePackage } from '../src/domain/deploy/edgeFunctionGuard.js';
import {
  EDGE_DEPLOY_LIMIT,
  authorizeEdgePayload,
  confirmDeployedEdge,
  payloadFromPackage,
} from '../src/domain/deploy/edgeFunctionRelease.js';
import {
  createSimulatedEdgeUploader,
  createSupabaseEdgeUploader,
  publishAuthorizedEdgeFunction,
  redactSecrets,
} from '../src/domain/deploy/edgeFunctionPublisher.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = join(rootDir, 'supabase', 'functions');
const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

const slug = flagValue('--slug');
const confirm = flagValue('--confirm');
const requireMainSha = normalizeCommitSha(flagValue('--require-main-sha'));
const publish = args.includes('--publish');
const simulate = args.includes('--simulate');
const artifactDir = flagValue('--write-artifact') || '';

function gitIsAncestor(ancestor, tip) {
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', ancestor, tip],
    { cwd: rootDir, encoding: 'utf8' },
  );
  return result.status === 0;
}

function mainTips() {
  const tips = [];
  for (const ref of ['refs/remotes/origin/main', 'origin/main', 'main']) {
    const tip = spawnSync('git', ['rev-parse', '--verify', ref], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    if (tip.status === 0) tips.push(String(tip.stdout || '').trim());
  }
  return [...new Set(tips.filter(Boolean))];
}

if (requireMainSha) {
  const decision = authorizeMainCommit({
    sha: requireMainSha,
    mainTips: mainTips(),
    isAncestor: gitIsAncestor,
  });
  if (!decision.ok) {
    for (const problem of decision.problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
}

const preparedList = slug
  ? [prepareEdgePackage(functionsRoot, slug)]
  : checkEdgeFunctions(functionsRoot).results;

let failed = false;
const manifests = [];

for (const prepared of preparedList) {
  const payload = payloadFromPackage(prepared);
  const decision = authorizeEdgePayload(prepared, payload);
  const readback = confirmDeployedEdge(prepared, payload?.files || []);
  if (!prepared.ok || !decision.ok || !readback.ok) {
    failed = true;
    process.stderr.write(`${prepared.slug}\n`);
    for (const problem of [...(prepared.problems || []), ...decision.problems, ...readback.problems]) {
      process.stderr.write(`- ${problem}\n`);
    }
    continue;
  }
  manifests.push(prepared.manifest);
  if (artifactDir && slug && prepared.slug === slug) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, 'manifest.json'),
      `${JSON.stringify(prepared.manifest, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(artifactDir, 'files.json'),
      `${JSON.stringify(prepared.files, null, 2)}\n`,
      'utf8',
    );
  }
}

if (failed) process.exit(1);

if (!publish) {
  process.stdout.write(`${JSON.stringify(manifests, null, 2)}\n`);
  process.exit(0);
}

if (manifests.length !== 1 || !slug) {
  process.stderr.write('Para publicar hace falta --slug de una sola función validada.\n');
  process.exit(2);
}

const prepared = preparedList[0];
if (!confirm) {
  process.stderr.write('Falta --confirm con el packageSha256 del manifiesto. No se publica.\n');
  process.stderr.write(`${EDGE_DEPLOY_LIMIT}\n`);
  process.exit(2);
}
if (confirm !== prepared.manifest.packageSha256) {
  process.stderr.write('La confirmación no es el hash del paquete autorizado. No se publica.\n');
  process.stderr.write(`${EDGE_DEPLOY_LIMIT}\n`);
  process.exit(2);
}

let uploader;
if (simulate) {
  uploader = createSimulatedEdgeUploader();
} else {
  const projectRef = String(process.env.SUPABASE_PROJECT_REF || '').trim();
  const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!projectRef || !accessToken) {
    process.stderr.write(`${EDGE_DEPLOY_LIMIT}\n`);
    process.stderr.write('Sin SUPABASE_PROJECT_REF/SUPABASE_ACCESS_TOKEN no hay publicador de red. Usá --simulate.\n');
    process.exit(2);
  }
  try {
    uploader = createSupabaseEdgeUploader({ projectRef, accessToken });
  } catch (error) {
    process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : error)}\n`);
    process.exit(2);
  }
}

const result = await publishAuthorizedEdgeFunction({
  prepared,
  confirm,
  upload: (payload) => uploader.upload(payload),
  fetchDeployed: (ctx) => uploader.fetchDeployed(ctx),
});

if (!result.deployed) {
  process.stderr.write(result.verifyFailed ? 'Verificación posterior fallida.\n' : 'Publicación bloqueada.\n');
  for (const problem of result.problems) process.stderr.write(`- ${redactSecrets(problem)}\n`);
  if (result.recovery?.steps?.length) {
    process.stderr.write('Recuperación:\n');
    for (const step of result.recovery.steps) process.stderr.write(`- ${step}\n`);
  }
  process.exit(result.providerError || result.verifyFailed ? 3 : 2);
}

process.stdout.write(`${JSON.stringify({
  deployed: true,
  mode: simulate ? 'simulate' : 'supabase',
  slug: prepared.slug,
  packageSha256: prepared.manifest.packageSha256,
  uploadResult: result.uploadResult,
}, null, 2)}\n`);
