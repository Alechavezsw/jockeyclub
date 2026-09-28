#!/usr/bin/env node
/**
 * Importa el listado de reservas Mi Socio (xlsx) → CSV + seed JS para el portal.
 *
 * Uso:
 *   node scripts/import-datita-reservas.mjs
 *   node scripts/import-datita-reservas.mjs --file "datita/Avtualizacion/reservas/Listado….xlsx"
 *
 * Salidas (locales, no commitear PII):
 *   datita/reservas/reservas.csv
 *   src/data/seedDatitaReservas.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function findDefaultXlsx() {
  const dirs = [
    path.join(root, 'datita', 'Avtualizacion', 'reservas'),
    path.join(root, 'datita', 'reservas'),
  ];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.xlsx$/i.test(name) || name.startsWith('~$')) continue;
      if (!/Listado de Reservas/i.test(name)) continue;
      const full = path.join(dir, name);
      const dated = name.match(/(\d{4}-\d{2}-\d{2})/);
      files.push({
        full,
        date: dated ? dated[1] : '',
        mtime: fs.statSync(full).mtimeMs,
      });
    }
  }
  files.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.mtime - a.mtime);
  return files[0]?.full || null;
}

async function main() {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('Falta el paquete xlsx. Corré: npm install xlsx --no-save');
    process.exit(1);
  }

  const fileArg = argValue('--file');
  const xlsxPath = fileArg
    ? path.resolve(root, fileArg)
    : findDefaultXlsx();

  if (!xlsxPath || !fs.existsSync(xlsxPath)) {
    console.error('No encontré el xlsx en Avtualizacion/reservas ni datita/reservas/. Pasá --file <ruta>.');
    process.exit(1);
  }

  const importUrl = pathToFileURL(
    path.join(root, 'src', 'domain', 'reservations', 'datitaReservasImport.js'),
  ).href;
  const {
    aoaToReservations,
    summarizeReservations,
    findHeaderRowIndex,
  } = await import(importUrl);

  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const { reservations, skipped, errors } = aoaToReservations(aoa);
  const summary = summarizeReservations(reservations);

  const outDir = path.join(root, 'datita', 'reservas');
  fs.mkdirSync(outDir, { recursive: true });

  // CSV desde filas originales del export (preserva nombres/fechas)
  const headerIdx = findHeaderRowIndex(aoa);
  const csvAoA = headerIdx >= 0 ? aoa.slice(headerIdx).filter((row, i) => {
    if (i === 0) return true;
    return /^\d+$/.test(String(row[0] || '').trim());
  }) : [];
  const csvSheet = XLSX.utils.aoa_to_sheet(csvAoA);
  const csvPath = path.join(outDir, 'reservas.csv');
  fs.writeFileSync(csvPath, XLSX.utils.sheet_to_csv(csvSheet), 'utf8');

  const seedPath = path.join(root, 'src', 'data', 'seedDatitaReservas.js');
  const seedBody = `/** Generado por scripts/import-datita-reservas.mjs — no editar a mano. */
/* eslint-disable */
export const SEED_DATITA_RESERVAS = ${JSON.stringify(reservations, null, 2)};

export default SEED_DATITA_RESERVAS;
`;
  fs.writeFileSync(seedPath, seedBody, 'utf8');

  console.log(`Origen: ${path.relative(root, xlsxPath)}`);
  console.log(`Reservas: ${summary.total} · omitidas: ${skipped}`);
  console.log('Por espacio:', summary.byFacility);
  console.log('Por estado:', summary.byStatus);
  console.log(`CSV → ${path.relative(root, csvPath)}`);
  console.log(`Seed → ${path.relative(root, seedPath)}`);
  if (errors.length) {
    console.log(`Avisos (${errors.length}):`, errors.slice(0, 5));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
