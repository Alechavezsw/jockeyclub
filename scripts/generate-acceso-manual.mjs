/**
 * Manual de Acceso QR en PDF — Jockey Club San Juan, Sede Rivadavia.
 * Uso: npm run manual:acceso
 *
 * Reutiliza la clase Manual de generate-user-manual.mjs.
 * Sale en docs/ (interno) y en public/ para poder enlazarlo desde el portal.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from './generate-user-manual.mjs';
import { ACCESO_MANUAL_TEXTS, CHAPTER_COUNT, buildBody } from './acceso-manual-content.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DOCS = path.join(ROOT, 'docs', 'Manual-Acceso-QR-Jockey-Club.pdf');
const OUT_PUBLIC = path.join(ROOT, 'public', 'manual-acceso.pdf');

renderManual({
  buildBody,
  chapterCount: CHAPTER_COUNT,
  texts: ACCESO_MANUAL_TEXTS,
  outputs: [OUT_DOCS, OUT_PUBLIC],
});
