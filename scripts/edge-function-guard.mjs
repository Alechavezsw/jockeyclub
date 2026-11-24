import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEdgeFunctions, prepareEdgePackage } from '../src/domain/deploy/edgeFunctionGuard.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');
const slugFlag = process.argv.indexOf('--slug');
const slug = slugFlag >= 0 ? process.argv[slugFlag + 1] : '';

const report = slug
  ? { ok: false, results: [prepareEdgePackage(root, slug)] }
  : checkEdgeFunctions(root);
report.ok = report.results.every((item) => item.ok);

if (!report.ok) {
  for (const item of report.results.filter((entry) => !entry.ok)) {
    process.stderr.write(`${item.slug}\n`);
    for (const problem of item.problems) process.stderr.write(`- ${problem}\n`);
  }
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(report.results.map((item) => item.manifest), null, 2)}\n`);
