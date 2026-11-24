import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEdgeFunctions, prepareEdgePackage, releaseEdgeDeploy } from './edgeFunctionGuard';

const repoFunctions = join(import.meta.dirname, '../../../supabase/functions');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'edge-guard-'));
  const write = (name, source) => {
    const file = join(root, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
  };
  return { root, write };
}

describe('paquete de Edge Functions', () => {
  it('arma el manifiesto de send-club-mail con sus dependencias', () => {
    const prepared = prepareEdgePackage(repoFunctions, 'send-club-mail');
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    const names = prepared.manifest.files.map((file) => file.name);
    expect(names).toContain('index.ts');
    expect(names).toContain('../_shared/clubMailAudience.ts');
    expect(names).toContain('../_shared/operationalMember.ts');
    expect(prepared.manifest.packageSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.files.length).toBe(prepared.manifest.files.length);
  });

  it('revisa todas las funciones del repositorio', () => {
    const report = checkEdgeFunctions(repoFunctions);
    const failed = report.results.filter((item) => !item.ok).map((item) => `${item.slug}: ${item.problems.join(' ')}`);
    expect(failed, failed.join('\n')).toEqual([]);
  });

  it('frena un import que no existe', () => {
    const { root, write } = fixture();
    write('demo/index.ts', 'import { ready } from "../_shared/missing.ts";\nexport const value = ready;\n');
    const prepared = prepareEdgePackage(root, 'demo');
    expect(prepared.ok).toBe(false);
    expect(prepared.problems.join(' ')).toMatch(/no está/);
    rmSync(root, { recursive: true, force: true });
  });

  it('frena un símbolo que el módulo no exporta', () => {
    const { root, write } = fixture();
    write('_shared/audience.ts', 'export function ready() { return 1; }\n');
    write('demo/index.ts', 'import { missing } from "../_shared/audience.ts";\nexport const value = missing;\n');
    const prepared = prepareEdgePackage(root, 'demo');
    expect(prepared.ok).toBe(false);
    expect(prepared.problems.join(' ')).toMatch(/no lo exporta/);
    rmSync(root, { recursive: true, force: true });
  });

  it('frena un archivo que no compila', () => {
    const { root, write } = fixture();
    write('demo/index.ts', 'export const value =\n');
    const prepared = prepareEdgePackage(root, 'demo');
    expect(prepared.ok).toBe(false);
    expect(prepared.problems.join(' ')).toMatch(/no compiló/);
    rmSync(root, { recursive: true, force: true });
  });

  it('no publica un marcador ni un paquete incompleto', () => {
    const { root, write } = fixture();
    write('demo/index.ts', 'PLACEHOLDER\n');
    const prepared = prepareEdgePackage(root, 'demo');
    let uploaded = false;
    const result = releaseEdgeDeploy(prepared, () => {
      uploaded = true;
    });
    expect(prepared.ok).toBe(false);
    expect(result.deployed).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(uploaded).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('publica solo después de validar el paquete', () => {
    const { root, write } = fixture();
    write('_shared/audience.ts', 'export function ready() { return 1; }\n');
    write('demo/index.ts', 'import { ready } from "../_shared/audience.ts";\nexport const value = ready();\n');
    const prepared = prepareEdgePackage(root, 'demo');
    let payload = null;
    const result = releaseEdgeDeploy(prepared, (files) => {
      payload = files;
    });
    expect(prepared.ok, prepared.problems?.join('\n')).toBe(true);
    expect(result.deployed).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(payload.files.map((file) => file.name)).toEqual(expect.arrayContaining([
      'index.ts',
      '../_shared/audience.ts',
    ]));
    rmSync(root, { recursive: true, force: true });
  });
});
