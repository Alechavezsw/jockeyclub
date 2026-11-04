/**
 * Manual del Superadministrador en PDF — Jockey Club San Juan, Sede Rivadavia.
 * Uso: npm run manual:superadmin
 *
 * Usa la misma clase que el manual general (generate-user-manual.mjs). Solo escribe en
 * docs/: es un manual reservado a quien tiene el rol y no se publica en el sitio.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from './generate-user-manual.mjs';
import { SUPERADMIN_MANUAL_TEXTS, CHAPTER_COUNT, buildBody } from './superadmin-manual-content.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'docs', 'Manual-Superadministrador-Jockey-Club.pdf');

renderManual({
  buildBody,
  chapterCount: CHAPTER_COUNT,
  texts: SUPERADMIN_MANUAL_TEXTS,
  outputs: [OUT],
});
