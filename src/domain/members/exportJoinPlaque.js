import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { loadClubLogoDataUrl } from '../reports/pdfBrand';

export const JOIN_PLAQUE_PRINT_SIZES = [
  { id: 'a6', label: 'A6', hint: '10 × 15 cm', wMm: 105, hMm: 148 },
  { id: 'a5', label: 'A5', hint: '15 × 21 cm', wMm: 148, hMm: 210 },
  { id: 'a4', label: 'A4', hint: '21 × 30 cm', wMm: 210, hMm: 297 },
];

export const JOIN_PLAQUE_SOCIAL_SIZES = [
  { id: 'story', label: 'Historia', hint: '9:16 · IG / WhatsApp', wPx: 1080, hPx: 1920 },
  { id: 'square', label: 'Cuadrado', hint: '1:1 · Feed', wPx: 1080, hPx: 1080 },
  { id: 'post', label: 'Horizontal', hint: '16:9 · Post', wPx: 1920, hPx: 1080 },
];

export const JOIN_PLAQUE_SIZES = [...JOIN_PLAQUE_PRINT_SIZES, ...JOIN_PLAQUE_SOCIAL_SIZES];

const GREEN = '#096755';
const CREAM = '#fffaf4';
const INK = '#0c1a14';
const TEXT = '#f4efe4';
const HINT = 'Escaneá el código y pedí el alta desde el celular.';

function renderQrPng(value, size) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(QRCodeCanvas, {
        value,
        size,
        level: 'M',
        includeMargin: false,
        bgColor: CREAM,
        fgColor: INK,
      }));
    });
    const canvas = host.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : null;
  } finally {
    root.unmount();
    host.remove();
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function canvasPixels(spec, pxPerMm = 10) {
  if (spec.wPx && spec.hPx) return { w: spec.wPx, h: spec.hPx };
  return { w: Math.round(spec.wMm * pxPerMm), h: Math.round(spec.hMm * pxPerMm) };
}

function fillWrapped(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

async function drawLogo(ctx, logoSrc, cx, y, size) {
  if (!logoSrc) return;
  try {
    const logo = await loadImage(logoSrc);
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(cx, y + size / 2, size / 2 + size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    const inner = size * 0.82;
    ctx.drawImage(logo, cx - inner / 2, y + size / 2 - inner / 2, inner, inner);
  } catch {
    /* skip */
  }
}

async function drawQrBox(ctx, url, x, y, box) {
  const pad = box * 0.08;
  ctx.fillStyle = CREAM;
  roundRect(ctx, x, y, box, box, box * 0.1);
  ctx.fill();
  const qrPng = renderQrPng(url, Math.round(box - pad * 2));
  if (!qrPng) return;
  const qrImg = await loadImage(qrPng);
  ctx.drawImage(qrImg, x + pad, y + pad, box - pad * 2, box - pad * 2);
}

export async function renderJoinPlaqueCanvas(url, spec = {}) {
  const { w, h } = canvasPixels(spec);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const display = String(url).replace(/^https?:\/\//, '');
  const landscape = w / h > 1.2;
  const short = Math.min(w, h);

  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w, 0, 0, w, 0, Math.max(w, h) * 0.7);
  glow.addColorStop(0, 'rgba(255,250,244,0.12)');
  glow.addColorStop(1, 'rgba(255,250,244,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }
  }

  const logoSrc = await loadClubLogoDataUrl();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (landscape) {
    const pad = short * 0.08;
    const leftW = w * 0.5;
    const cx = leftW / 2;
    const logoSize = short * 0.18;
    let y = h * 0.16;
    await drawLogo(ctx, logoSrc, cx, y, logoSize);
    y += logoSize + short * 0.05;

    ctx.fillStyle = TEXT;
    ctx.font = `800 ${Math.round(short * 0.034)}px "DM Sans", system-ui, sans-serif`;
    ctx.fillText('JOCKEY CLUB SAN JUAN', cx, y);
    y += short * 0.1;

    ctx.font = `600 ${Math.round(short * 0.15)}px "Playfair Display", Georgia, serif`;
    ctx.fillText('Asociate', cx, y);
    y += short * 0.09;

    ctx.fillStyle = 'rgba(244,239,228,0.84)';
    ctx.font = `400 ${Math.round(short * 0.038)}px "DM Sans", system-ui, sans-serif`;
    fillWrapped(ctx, HINT, cx, y, leftW - pad * 2, short * 0.05);

    ctx.fillStyle = 'rgba(244,239,228,0.72)';
    ctx.font = `400 ${Math.round(short * 0.028)}px "DM Sans", ui-monospace, monospace`;
    ctx.fillText(display, cx, h - pad, leftW - pad * 2);

    const qrBox = Math.min(h * 0.68, w * 0.36);
    await drawQrBox(ctx, url, w * 0.72 - qrBox / 2, (h - qrBox) / 2, qrBox);
    return canvas;
  }

  const pad = h * 0.055;
  let y = pad;
  const logoSize = short * 0.12;
  await drawLogo(ctx, logoSrc, w / 2, y, logoSize);
  y += logoSize + h * 0.03;

  ctx.fillStyle = TEXT;
  ctx.font = `800 ${Math.round(short * 0.028)}px "DM Sans", system-ui, sans-serif`;
  ctx.fillText('JOCKEY CLUB SAN JUAN', w / 2, y);
  y += h * 0.07;

  ctx.font = `600 ${Math.round(short * 0.12)}px "Playfair Display", Georgia, serif`;
  ctx.fillText('Asociate', w / 2, y);
  y += h * 0.055;

  ctx.fillStyle = 'rgba(244,239,228,0.84)';
  ctx.font = `400 ${Math.round(short * 0.032)}px "DM Sans", system-ui, sans-serif`;
  y = fillWrapped(ctx, HINT, w / 2, y, w - pad * 2, short * 0.042);
  y += h * 0.02;

  const qrBox = Math.min(w * 0.58, h * 0.38);
  await drawQrBox(ctx, url, (w - qrBox) / 2, y, qrBox);
  y += qrBox + h * 0.04;

  ctx.fillStyle = 'rgba(244,239,228,0.72)';
  ctx.font = `400 ${Math.round(short * 0.024)}px "DM Sans", ui-monospace, monospace`;
  ctx.fillText(display, w / 2, Math.min(y, h - pad * 0.8), w - pad * 2);

  return canvas;
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadJoinPlaque(url, { size, format }) {
  const spec = JOIN_PLAQUE_SIZES.find((item) => item.id === size);
  if (!spec) throw new Error('Tamaño de placa desconocido.');
  const canvas = await renderJoinPlaqueCanvas(url, spec);
  const base = `jockey-club-asociate-${spec.id}`;
  if (format === 'png') {
    triggerDownload(canvas.toDataURL('image/png'), `${base}.png`);
    return;
  }
  if (format === 'jpg' || format === 'jpeg') {
    triggerDownload(canvas.toDataURL('image/jpeg', 0.93), `${base}.jpg`);
    return;
  }
  const { w, h } = canvasPixels(spec);
  const wMm = spec.wMm || (w * 25.4) / 96;
  const hMm = spec.hMm || (h * 25.4) / 96;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: wMm > hMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [wMm, hMm],
  });
  doc.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, wMm, hMm);
  doc.save(`${base}.pdf`);
}
