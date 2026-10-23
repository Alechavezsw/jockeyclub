#!/usr/bin/env node
/**
 * Arma la presentación «Cómo funciona el mostrador del Jockey Club» como una página
 * estática: public/powerpoint/index.html (se ve en /powerpoint).
 *
 * Fuentes: scripts/powerpoint/deck.json (orden y título), scripts/powerpoint/slides/*.html
 * (una diapositiva por archivo, formato 1920x1080) y scripts/powerpoint/template.html (visor).
 * Imágenes: public/powerpoint/img/.
 *
 * Uso: npm run powerpoint:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'scripts', 'powerpoint');
const OUT = path.join(ROOT, 'public', 'powerpoint', 'index.html');
const IMG_DIR = path.join(ROOT, 'public', 'powerpoint', 'img');

/** Nombre del ícono en las diapositivas -> ícono de lucide-react. */
const ICONS = {
  Check: 'check',
  CheckCircle: 'circle-check',
  Users: 'users',
  Chat: 'message-square',
  Search: 'search',
  Verified: 'badge-check',
  Key: 'key',
  Book: 'book-open',
  Tool: 'wrench',
  Chart: 'chart-column',
  Warning: 'triangle-alert',
  Lock: 'lock',
};

/** Id de imagen de la presentación original -> archivo en public/powerpoint/img. */
const IMAGES = {
  '08281f69d2e8ab4c643677d96d46f3f3': 'logo.png',
  '2ab76a24cb0fff04626b6b590f20064b': 'inicio-recorte.png',
  '2e317fe8e9d36040e91565324e4c91aa': 'socios.jpg',
  '5dbbb8d0f7890e48b5557feefc6464f2': 'pileta.jpg',
  'f8cf6a4ad442133e8b21ff46c4b10e58': 'entrada-pileta.jpg',
  '8bd96b4ded07a2ad7b49098d4b2b890c': 'acceso-qr.jpg',
  '043aa0b189ea387531992a6edc6cb2bb': 'ingresos.jpg',
  '2ffc6df6ce6cccc4f18a68418a1a5db4': 'jev-franja.png',
  'bd8b16cef53ee29dc84ae2147c5f1a0c': 'novedades.jpg',
};

async function loadIcons() {
  const out = {};
  for (const [name, lucide] of Object.entries(ICONS)) {
    const file = path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${lucide}.mjs`);
    const mod = await import(pathToFileURL(file).href);
    const inner = mod.__iconNode
      .map(([tag, attrs]) => {
        const a = Object.entries(attrs)
          .filter(([k]) => k !== 'key')
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ');
        return `<${tag} ${a}/>`;
      })
      .join('');
    out[name] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }
  return out;
}

function transform(html, icons, slideId) {
  let out = html;

  // Pantallas animadas: iframe aislado. El contenido va en data-srcdoc y el visor lo
  // carga cuando la diapositiva entra, así la animación arranca de cero.
  out = out.replace(/<x-embed style="([^"]*)">([\s\S]*?)<\/x-embed>/g, (_, style, inner) => {
    const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>${inner}</body></html>`;
    const esc = doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<iframe class="embed" style="${style}" sandbox="allow-scripts" tabindex="-1" aria-hidden="true" title="Pantalla animada de ejemplo" data-srcdoc="${esc}"></iframe>`;
  });

  out = out.replace(/<x-icon name="(\w+)" style="([^"]*)"><\/x-icon>/g, (_, name, style) => {
    if (!icons[name]) throw new Error(`${slideId}: ícono sin mapear: ${name}`);
    return `<span class="ico" style="${style}">${icons[name]}</span>`;
  });

  out = out.replace(/<x-shape kind="([\w-]+)" style="([^"]*)"([^>]*)><\/x-shape>/g, (_, kind, style, rest) => (
    `<div class="shape ${kind}" style="${style}"${rest}></div>`
  ));

  // data-crop="zoom X% Y%" -> object-position (el zoom de las capturas es siempre 1).
  out = out.replace(/data-crop="[\d.]+ ([^"]+)"([^>]*?)style="/g, (_, pos, mid) => `${mid}style="object-position:${pos};`);

  out = out.replace(/\/_blob\/([0-9a-f]{32})/g, (_, id) => {
    const file = IMAGES[id];
    if (!file) throw new Error(`${slideId}: imagen sin mapear: ${id}`);
    if (!fs.existsSync(path.join(IMG_DIR, file))) throw new Error(`${slideId}: falta public/powerpoint/img/${file}`);
    return `/powerpoint/img/${file}`;
  });

  return out;
}

async function main() {
  const deck = JSON.parse(fs.readFileSync(path.join(SRC, 'deck.json'), 'utf8'));
  const icons = await loadIcons();

  const parts = deck.order.map((id) => {
    const file = path.join(SRC, 'slides', `${id}.html`);
    if (!fs.existsSync(file)) throw new Error(`Falta la diapositiva ${id}`);
    const html = transform(fs.readFileSync(file, 'utf8').trim(), icons, id);
    if (!new RegExp(`^<section id="${id}"`).test(html)) throw new Error(`${id}: el archivo no empieza con <section id="${id}">`);
    return html;
  });

  const leftovers = parts.join('\n').match(/<x-(embed|icon|shape)|\/_blob\//g);
  if (leftovers) throw new Error(`Quedaron elementos sin convertir: ${[...new Set(leftovers)].join(', ')}`);

  const unused = fs.readdirSync(path.join(SRC, 'slides'))
    .map((f) => f.replace(/\.html$/, ''))
    .filter((id) => !deck.order.includes(id));
  if (unused.length) console.warn(`Aviso: diapositivas que no están en deck.json: ${unused.join(', ')}`);

  const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
  const html = template
    .replace('{{TITLE}}', deck.title)
    .replace('<!--SLIDES-->', () => parts.join('\n'));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`OK: ${deck.order.length} diapositivas -> ${path.relative(ROOT, OUT)} (${Math.round(html.length / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
