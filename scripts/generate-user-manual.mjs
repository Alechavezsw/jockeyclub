/**
 * Manual de uso en PDF — Jockey Club San Juan, Sede Rivadavia.
 * Uso: node scripts/generate-user-manual.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildBody, CHAPTER_COUNT } from './user-manual-content.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LOGO_JPG = path.join(ROOT, 'public', 'logo-jockey-club-print.jpg');
const LOGO_PNG = path.join(ROOT, 'public', 'logo-jockey-club.png');
const OUT_DOCS = path.join(ROOT, 'docs', 'Manual-del-usuario-Jockey-Club-San-Juan.pdf');
const OUT_PUBLIC = path.join(ROOT, 'public', 'manual-usuario.pdf');

const GREEN = [9, 103, 85];
const GOLD = [202, 57, 12];
const CREAM = [245, 230, 180];
const MUTED = [90, 90, 90];
const INK = [28, 32, 28];
const TIP_BG = [248, 242, 226];
const WARN_BG = [252, 236, 232];
const OK_BG = [232, 242, 234];
const PILL_SHADOW = [6, 82, 68];
const PILL_R = 35;

const MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 14;
const CONTENT_BOTTOM = PAGE_H - 20;

function loadLogo() {
  // El PNG tiene fondo transparente y va sobre una pastilla blanca. El JPG de impresión trae un cuadrado negro.
  const file = fs.existsSync(LOGO_PNG) ? LOGO_PNG : LOGO_JPG;
  if (!fs.existsSync(file)) return null;
  const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function todayLabel() {
  return new Date().toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

class Manual {
  constructor(logoDataUrl) {
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    this.logo = logoDataUrl;
    this.y = MARGIN;
    this.toc = [];
  }

  get page() {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  addPage() {
    this.doc.addPage();
    this.drawChrome();
    this.y = 22;
  }

  ensure(h) {
    if (this.y + h > CONTENT_BOTTOM) this.addPage();
  }

  drawChrome() {
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, PAGE_W, 12, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(8);
    d.setTextColor(...CREAM);
    d.text('Jockey Club San Juan  ·  Sede Rivadavia', MARGIN, 8);
    d.setFont('helvetica', 'normal');
    d.setTextColor(230, 230, 220);
    d.text('Manual de uso del portal', PAGE_W - MARGIN, 8, { align: 'right' });
  }

  cover() {
    const d = this.doc;
    d.setFillColor(...GREEN);
    d.rect(0, 0, PAGE_W, PAGE_H, 'F');
    d.setFillColor(...GOLD);
    d.rect(0, 118, PAGE_W, 1.2, 'F');

    if (this.logo) {
      const isJpeg = this.logo.startsWith('data:image/jpeg');
      const cx = PAGE_W / 2;
      const cy = 56;
      if (!isJpeg) {
        d.setFillColor(...PILL_SHADOW);
        d.circle(cx, cy + 1.2, PILL_R, 'F');
        d.setFillColor(255, 255, 255);
        d.circle(cx, cy, PILL_R, 'F');
      }
      try {
        d.addImage(this.logo, isJpeg ? 'JPEG' : 'PNG', cx - 27, cy - 27, 54, 54);
      } catch {
        /* logo opcional */
      }
    }

    d.setTextColor(...CREAM);
    d.setFont('helvetica', 'bold');
    d.setFontSize(11);
    d.text('JOCKEY CLUB SAN JUAN', PAGE_W / 2, 96, { align: 'center' });
    d.setFont('helvetica', 'normal');
    d.setFontSize(10);
    d.setTextColor(230, 230, 220);
    d.text('Sede Rivadavia  ·  República del Líbano 1799 Oeste', PAGE_W / 2, 103, { align: 'center' });

    d.setFont('helvetica', 'bold');
    d.setFontSize(26);
    d.setTextColor(255, 255, 255);
    d.text('Manual de uso', PAGE_W / 2, 142, { align: 'center' });
    d.setFontSize(14);
    d.setTextColor(...CREAM);
    d.text('Portal de socios, personal y administración', PAGE_W / 2, 154, { align: 'center' });

    d.setFont('helvetica', 'normal');
    d.setFontSize(11);
    d.setTextColor(220, 220, 210);
    const blurb = d.splitTextToSize(
      'Una guía clara, en español, para que cualquier persona del club pueda entrar al sistema, usar su credencial, reservar, cobrar o atender sin tener que ser experta en computación.',
      150
    );
    d.text(blurb, PAGE_W / 2, 172, { align: 'center' });

    d.setFontSize(9);
    d.setTextColor(...CREAM);
    d.text(`Edición ${todayLabel()}  ·  Versión 2.0`, PAGE_W / 2, 250, { align: 'center' });
    d.setTextColor(200, 200, 190);
    d.text('Uso interno del club  ·  No compartir claves', PAGE_W / 2, 258, { align: 'center' });
  }

  writeToc(entries) {
    this.doc.addPage();
    this.drawChrome();
    this.y = 24;
    this.h1('Índice', { toc: false });
    this.p('Empezá por el capítulo de tu rol. Si no sabés cuál es, leé primero “Antes de empezar” y “Cómo entrar”. Si ya conocías la edición 1.0, mirá el último capítulo: resume qué cambió.');

    autoTable(this.doc, {
      startY: this.y,
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 10,
        cellPadding: { top: 2.2, bottom: 2.2, left: 1, right: 1 },
        textColor: INK,
      },
      columnStyles: {
        0: { cellWidth: 14, fontStyle: 'bold', textColor: GREEN },
        1: { cellWidth: 140 },
        2: { cellWidth: 24, halign: 'right', textColor: MUTED },
      },
      body: entries.map((e) => [e.n, e.title, String(e.page)]),
      margin: { left: MARGIN, right: MARGIN },
      didDrawPage: () => this.drawChrome(),
    });
    this.y = (this.doc.lastAutoTable?.finalY || this.y) + 8;
  }

  mark(n, title) {
    this.toc.push({ n, title, page: this.page });
  }

  h1(text, { toc = true, n } = {}) {
    this.ensure(44);
    if (toc && n) this.mark(n, text.replace(/^\d+\.\s*/, ''));
    this.doc.setFillColor(...GREEN);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, 10, 1.2, 1.2, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(12);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(text, MARGIN + 4, this.y + 6.6);
    this.y += 16;
  }

  h2(text) {
    this.ensure(38);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11);
    this.doc.setTextColor(...GREEN);
    this.doc.text(text, MARGIN, this.y);
    this.y += 7;
    this.doc.setDrawColor(...GOLD);
    this.doc.setLineWidth(0.35);
    this.doc.line(MARGIN, this.y - 4, MARGIN + 42, this.y - 4);
  }

  p(text) {
    const lines = this.doc.splitTextToSize(text, CONTENT_W);
    let i = 0;
    while (i < lines.length) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...INK);
      const left = lines.length - i;
      let room = Math.floor((CONTENT_BOTTOM - this.y) / 5);
      if (room >= left) room = left;
      else if (room < 3) {
        this.addPage();
        continue;
      } else if (left - room === 1) room -= 1;
      const chunk = lines.slice(i, i + room);
      this.doc.text(chunk, MARGIN, this.y);
      this.y += chunk.length * 5;
      i += chunk.length;
      if (i < lines.length) this.addPage();
    }
    this.y += 3.5;
  }

  bullets(items) {
    for (const item of items) {
      const lines = this.doc.splitTextToSize(`•  ${item}`, CONTENT_W);
      this.ensure(lines.length * 5 + 2);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...INK);
      this.doc.text(lines, MARGIN, this.y);
      this.y += lines.length * 5 + 1.6;
    }
    this.y += 2;
  }

  steps(items) {
    items.forEach((item, i) => {
      const n = `${i + 1}.`;
      const lines = this.doc.splitTextToSize(item, CONTENT_W - 10);
      this.ensure(lines.length * 5 + 4);
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(10);
      this.doc.setTextColor(...GREEN);
      this.doc.text(n, MARGIN, this.y);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setTextColor(...INK);
      this.doc.text(lines, MARGIN + 8, this.y);
      this.y += lines.length * 5 + 2.4;
    });
    this.y += 2;
  }

  box(kind, title, text) {
    const bg = kind === 'warn' ? WARN_BG : kind === 'ok' ? OK_BG : TIP_BG;
    const bar = kind === 'warn' ? [160, 50, 40] : kind === 'ok' ? [30, 100, 55] : GOLD;
    const body = this.doc.splitTextToSize(text, CONTENT_W - 10);
    const h = 8 + body.length * 4.6;
    this.ensure(h + 4);
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(MARGIN, this.y, CONTENT_W, h, 1.5, 1.5, 'F');
    this.doc.setFillColor(...bar);
    this.doc.rect(MARGIN, this.y, 1.8, h, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...(kind === 'warn' ? INK : kind === 'ok' ? bar : GREEN));
    this.doc.text(title, MARGIN + 6, this.y + 5);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...INK);
    this.doc.text(body, MARGIN + 6, this.y + 10);
    this.y += h + 5;
  }

  table(head, rows, widths) {
    this.ensure(28);
    autoTable(this.doc, {
      startY: this.y,
      head: [head],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 2.1, textColor: INK, valign: 'top' },
      headStyles: { fillColor: GREEN, textColor: CREAM, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 247, 242] },
      columnStyles: (widths || []).reduce((acc, w, i) => {
        acc[i] = { cellWidth: w };
        return acc;
      }, {}),
      margin: { left: MARGIN, right: MARGIN },
      didDrawPage: () => this.drawChrome(),
    });
    this.y = (this.doc.lastAutoTable?.finalY || this.y) + 8;
  }

  footer() {
    const d = this.doc;
    const count = d.getNumberOfPages();
    for (let i = 2; i <= count; i += 1) {
      d.setPage(i);
      d.setDrawColor(...GOLD);
      d.setLineWidth(0.3);
      d.line(MARGIN, FOOTER_Y - 3, PAGE_W - MARGIN, FOOTER_Y - 3);
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      d.setTextColor(...MUTED);
      d.text('Jockey Club San Juan · Portal institucional · Uso interno', MARGIN, FOOTER_Y);
      d.text(`${i} / ${count}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
    }
  }

  save(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(this.doc.output('arraybuffer')));
  }
}


function placeholderToc() {
  return Array.from({ length: CHAPTER_COUNT }, (_, i) => ({
    n: String(i + 1).padStart(2, '0'),
    title: 'Capítulo',
    page: 0,
  }));
}

function main() {
  const logo = loadLogo();
  const draft = new Manual(logo);
  draft.cover();
  draft.writeToc(placeholderToc());
  buildBody(draft);

  const final = new Manual(logo);
  final.cover();
  final.writeToc(draft.toc);
  buildBody(final);
  if (final.toc.length !== CHAPTER_COUNT) {
    throw new Error(`El índice tiene ${final.toc.length} capítulos y CHAPTER_COUNT es ${CHAPTER_COUNT}.`);
  }
  final.footer();
  final.save(OUT_DOCS);
  final.save(OUT_PUBLIC);
  const pages = final.doc.getNumberOfPages();
  console.log(`OK ${pages} páginas`);
  console.log(OUT_DOCS);
  console.log(OUT_PUBLIC);
}

main();
