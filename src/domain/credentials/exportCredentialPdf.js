import { loadJsPdf } from '../../lib/office.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { loadClubLogoDataUrl } from '../reports/pdfBrand';
import { getTierDisplayName, tierCardStyle } from '../members/tiers';
import { isFamilyDependent } from '../members/households';
import JsBarcode from 'jsbarcode';
import { buildCredentialQRPayload } from './qr';
import { BARCODE_FORMAT, buildCredentialBarcodePayload } from './barcode';

export function formatCredentialNumber(id = '') {
  const digits = String(id).replace(/\D/g, '');
  if (!digits) return String(id || '—');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function credentialPdfFileName(member) {
  const id = String(member?.memberId || '').replace(/\D/g, '') || 'socio';
  return `credencial-jockey-${id}.pdf`;
}

export function hexToRgb(hex, fallback = [202, 57, 12]) {
  const raw = String(hex || '').trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function renderBarcodePng(member, { height = 90, scale = 3 } = {}) {
  const payload = buildCredentialBarcodePayload(member);
  if (!payload || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, payload, {
      format: BARCODE_FORMAT,
      width: scale,
      height,
      displayValue: true,
      fontSize: 14,
      textMargin: 6,
      margin: 16,
      background: '#ffffff',
      lineColor: '#060e0a',
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function renderQrPng(value, size = 420) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(QRCodeCanvas, {
        value,
        size,
        level: 'H',
        includeMargin: true,
        bgColor: '#ffffff',
        fgColor: '#060e0a',
      }));
    });
    const canvas = host.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : null;
  } finally {
    root.unmount();
    host.remove();
  }
}

async function imageToDataUrl(src) {
  if (!src) return null;
  if (String(src).startsWith('data:')) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * PDF de la credencial: una cara tamaño ISO ID-1, lista para imprimir o guardar.
 */
export async function exportCredentialPdf(member) {
  if (!member) throw new Error('No hay socio para la credencial.');
  const [{ jsPDF }, logoDataUrl, photoDataUrl] = await Promise.all([
    loadJsPdf(),
    loadClubLogoDataUrl(),
    imageToDataUrl(member.photo),
  ]);
  const qrDataUrl = renderQrPng(buildCredentialQRPayload(member), 480);
  const barcodeDataUrl = renderBarcodePng(member, { height: 72, scale: 2.4 });
  const barcodePayload = buildCredentialBarcodePayload(member);
  const style = tierCardStyle(member.tier);
  const gold = hexToRgb(style.accent);
  const fileName = credentialPdfFileName(member);
  const role = isFamilyDependent(member) ? 'GRUPO FAMILIAR' : 'TITULAR';
  const category = getTierDisplayName(member.tier);
  const number = formatCredentialNumber(member.memberId);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 53.98] });
  const w = 85.6;
  const h = 53.98;

  doc.setFillColor(12, 10, 6);
  doc.rect(0, 0, w, h, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 0, 1.6, h, 'F');
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.25);
  doc.rect(1.4, 1.4, w - 2.8, h - 2.8, 'S');

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 4.2, 3.6, 8.2, 8.2);
    } catch { /* logo opcional */ }
  }

  doc.setTextColor(...gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('JOCKEY CLUB', logoDataUrl ? 14 : 4.4, 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(210, 196, 150);
  doc.text('SAN JUAN  ·  SEDE RIVADAVIA', logoDataUrl ? 14 : 4.4, 11);

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(250, 246, 232);
  doc.text(number, 4.4, 24);

  if (photoDataUrl) {
    try {
      doc.addImage(photoDataUrl, 'JPEG', 4.4, 28.2, 14.2, 14.2);
    } catch { /* foto opcional */ }
  }

  const textX = photoDataUrl ? 20.4 : 4.4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.6);
  doc.setTextColor(180, 168, 140);
  doc.text(role, textX, 30.4);
  doc.setFont('times', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  const nameLines = doc.splitTextToSize(String(member.name || '—'), photoDataUrl ? 40 : 56);
  doc.text(nameLines.slice(0, 2), textX, 35.2);

  doc.setFillColor(gold[0], gold[1], gold[2]);
  const badge = String(category || 'SOCIO').toUpperCase();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  const badgeW = Math.min(42, doc.getTextWidth(badge) + 3.2);
  doc.setFillColor(...gold);
  doc.roundedRect(textX, 43.6, badgeW, 4.4, 0.6, 0.6, 'F');
  doc.setTextColor(12, 10, 6);
  doc.text(badge, textX + 1.6, 46.6);

  if (qrDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(w - 21.4, h - 21.2, 17.4, 17.4, 1, 1, 'F');
    doc.addImage(qrDataUrl, 'PNG', w - 20.4, h - 20.2, 15.4, 15.4);
  }

  // Reverso: Code 128 a lo ancho para pistola láser (quiet zone + altura útil).
  doc.addPage([85.6, 53.98], 'landscape');
  doc.setFillColor(250, 246, 232);
  doc.rect(0, 0, w, h, 'F');
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.25);
  doc.rect(1.4, 1.4, w - 2.8, h - 2.8, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...gold);
  doc.text('JOCKEY CLUB SAN JUAN', 4.4, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(80, 70, 50);
  doc.text('Código de barras · acceso portería', 4.4, 12);
  if (barcodeDataUrl) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(4, 16, w - 8, 28, 1.2, 1.2, 'F');
    try {
      doc.addImage(barcodeDataUrl, 'PNG', 6, 18, w - 12, 24);
    } catch { /* barcode opcional */ }
  } else if (barcodePayload) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(barcodePayload, w / 2, 32, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.8);
  doc.setTextColor(100, 90, 70);
  doc.text(String(member.name || '').toUpperCase(), 4.4, 49);
  doc.text(`Nº ${number}`, w - 4.4, 49, { align: 'right' });

  doc.save(fileName);
  return fileName;
}
