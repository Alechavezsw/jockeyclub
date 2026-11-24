/**
 * Único procedimiento de publicación de Edge Functions.
 *
 * Por defecto solo lee el repositorio, resuelve dependencias, compila y
 * compara el paquete consigo mismo. No llama a la API.
 *
 * --publish exige --confirm con el packageSha256 y, aun así, este comando no
 * adjunta un publicador de red: el token de despliegue tiene que vivir en el
 * CI. Un llamado directo a la API no pasa por este archivo.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEdgeFunctions, prepareEdgePackage } from '../src/domain/deploy/edgeFunctionGuard.js';
import {
  EDGE_DEPLOY_LIMIT,
  authorizeEdgePayload,
  confirmDeployedEdge,
  payloadFromPackage,
} from '../src/domain/deploy/edgeFunctionRelease.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');
const args = process.argv.slice(2);
const slugFlag = args.indexOf('--slug');
const slug = slugFlag >= 0 ? args[slugFlag + 1] : '';
const confirmFlag = args.indexOf('--confirm');
const confirm = confirmFlag >= 0 ? args[confirmFlag + 1] : '';
const publish = args.includes('--publish');

const preparedList = slug
  ? [prepareEdgePackage(root, slug)]
  : checkEdgeFunctions(root).results;

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
}

if (failed) process.exit(1);

if (publish) {
  const match = manifests.length === 1 && confirm === manifests[0].packageSha256;
  process.stderr.write(`${EDGE_DEPLOY_LIMIT}\n`);
  if (!match) {
    process.stderr.write('Falta --slug de una sola función y --confirm con su packageSha256. No se publica.\n');
  } else {
    process.stderr.write('El paquete coincide, pero este comando no adjunta un publicador de red. No se llama a la API.\n');
  }
  process.exit(2);
}

process.stdout.write(`${JSON.stringify(manifests, null, 2)}\n`);
