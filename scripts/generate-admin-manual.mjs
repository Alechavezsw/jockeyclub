/**
 * Manual de Administración y Pileta en PDF — Jockey Club San Juan, Sede Rivadavia.
 * Uso: npm run manual:admin
 *
 * Usa la misma clase que el manual general (generate-user-manual.mjs). Solo escribe en
 * docs/: es un manual interno del personal y no se publica en el sitio.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from './generate-user-manual.mjs';
import { ADMIN_MANUAL_TEXTS, CHAPTER_COUNT, buildBody } from './admin-manual-content.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'docs', 'Manual-Administracion-y-Pileta-Jockey-Club.pdf');

renderManual({
  buildBody,
  chapterCount: CHAPTER_COUNT,
  texts: ADMIN_MANUAL_TEXTS,
  outputs: [OUT],
});
