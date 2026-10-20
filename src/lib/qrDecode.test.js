import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { describe, expect, it } from 'vitest';
import {
  fitSize,
  JSQR_MAX_SIDE,
  planDecode,
  WASM_FULL_SIDE,
  WASM_MAX_SIDE,
  WASM_NATIVE_SIDE,
  WASM_ROI_RATIO,
} from './qrDecode';
import { loadWasmReader } from './qrWasm';
import { buildCredentialQRPayload, parseCredentialQRPayload } from '../domain/credentials/qr';

describe('fitSize', () => {
  it('achica al lado mayor sin agrandar nunca', () => {
    expect(fitSize(1280, 720, 720)).toEqual({ w: 720, h: 405 });
    expect(fitSize(720, 1280, 720)).toEqual({ w: 405, h: 720 });
    expect(fitSize(640, 360, 720)).toEqual({ w: 640, h: 360 });
  });

  it('un cuadro vacío no rompe', () => {
    expect(fitSize(0, 0, 720)).toEqual({ w: 0, h: 0 });
    expect(fitSize(undefined, 10, 720)).toEqual({ w: 0, h: 0 });
  });
});

describe('planDecode', () => {
  it('sin lector nativo, el WebAssembly corre en todos los cuadros', () => {
    for (let tick = 1; tick <= 12; tick += 1) {
      const plan = planDecode(tick, { hasNative: false, wasmReady: true });
      expect(plan.native).toBe(false);
      expect(plan.wasm).not.toBeNull();
      expect(plan.jsqr).toBeNull();
    }
  });

  it('con lector nativo, el WebAssembly es refuerzo cada tres cuadros', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((tick) => Boolean(planDecode(tick, { hasNative: true, wasmReady: true }).wasm));
    expect(runs).toEqual([false, false, true, false, false, true]);
  });

  it('el cuadro chico es el normal; cada tanto recorta el centro y cada tanto mira entero a resolución completa', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((tick) => planDecode(tick, { wasmReady: true }).wasm);
    expect(steps.map((s) => [s.maxSide, s.crop])).toEqual([
      [WASM_MAX_SIDE, 1],
      [WASM_MAX_SIDE, 1],
      [WASM_NATIVE_SIDE, WASM_ROI_RATIO],
      [WASM_MAX_SIDE, 1],
      [WASM_MAX_SIDE, 1],
      [WASM_FULL_SIDE, 1],
    ]);
    expect(planDecode(12, { wasmReady: true }).wasm.crop).toBe(1);
  });

  it('solo cada tanto prueba el QR invertido', () => {
    const inverted = [1, 2, 3, 4, 5, 8].map((tick) => planDecode(tick, { wasmReady: true }).wasm.invert);
    expect(inverted).toEqual([false, false, false, true, false, true]);
  });

  it('si el .wasm no cargó, jsQR es el respaldo', () => {
    const plan = planDecode(1, { hasNative: false, wasmReady: false });
    expect(plan.wasm).toBeNull();
    expect(plan.jsqr).toEqual({ inversion: 'dontInvert', maxSide: JSQR_MAX_SIDE });
    expect(planDecode(4, { wasmReady: false }).jsqr.inversion).toBe('attemptBoth');
  });

  it('con nativo y sin .wasm, jsQR no corre en todos los cuadros', () => {
    const runs = [1, 2, 3].map((tick) => Boolean(planDecode(tick, { hasNative: true, wasmReady: false }).jsqr));
    expect(runs).toEqual([false, false, true]);
  });
});

/** El centro del cuadro, sin cambiar la resolución (lo que hace el lector con `crop`). */
function cropCenter(frame, ratio) {
  const cw = Math.round(frame.width * ratio);
  const ch = Math.round(frame.height * ratio);
  const x0 = Math.floor((frame.width - cw) / 2);
  const y0 = Math.floor((frame.height - ch) / 2);
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y += 1) {
    const start = ((y0 + y) * frame.width + x0) * 4;
    data.set(frame.data.subarray(start, start + cw * 4), y * cw * 4);
  }
  return { data, width: cw, height: ch };
}

/** Achica por promedio de área, como un drawImage suavizado. */
function boxDownscale(frame, maxSide) {
  const longest = Math.max(frame.width, frame.height);
  if (longest <= maxSide) return frame;
  const k = longest / maxSide;
  const w = Math.floor(frame.width / k);
  const h = Math.floor(frame.height / k);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const x1 = Math.floor(x * k);
      const x2 = Math.min(frame.width, Math.ceil((x + 1) * k));
      const y1 = Math.floor(y * k);
      const y2 = Math.min(frame.height, Math.ceil((y + 1) * k));
      let acc = 0;
      let n = 0;
      for (let yy = y1; yy < y2; yy += 1) {
        for (let xx = x1; xx < x2; xx += 1) {
          acc += frame.data[(yy * frame.width + xx) * 4];
          n += 1;
        }
      }
      const i = (y * w + x) * 4;
      const v = acc / n;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

/** Matriz de módulos de un QR, leída del SVG que dibuja la credencial. */
function qrMatrix(value, level) {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value, level, size: 100 }));
  const n = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)[1]);
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  for (const seg of paths.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)v1H\d+z/g)) {
    const x = Number(seg[1]);
    const y = Number(seg[2]);
    for (let i = 0; i < Number(seg[3]); i += 1) matrix[y][x + i] = 1;
  }
  return matrix;
}

/** Cuadro de cámara: el QR centrado sobre un fondo gris. `invert` simula un QR claro sobre oscuro. */
function cameraFrame(matrix, { W = 960, H = 540, fill = 0.55, invert = false } = {}) {
  const n = matrix.length;
  const margin = 4;
  const total = n + margin * 2;
  const px = Math.floor(H * fill);
  const mod = px / total;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const rx = x - (W - px) / 2;
      const ry = y - (H - px) / 2;
      let v = 110;
      if (rx >= 0 && ry >= 0 && rx < px && ry < px) {
        const mx = Math.floor(rx / mod) - margin;
        const my = Math.floor(ry / mod) - margin;
        const dark = mx >= 0 && my >= 0 && mx < n && my < n && matrix[my][mx] === 1;
        v = dark !== invert ? 8 : 250;
      }
      const i = (y * W + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

describe('lector WebAssembly con credenciales reales', () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
  const readerPromise = loadWasmReader({ wasmBinary: fs.readFileSync(wasmPath) });

  const old = { memberId: '12345', credentialToken: '3f9a0c7be21d4c55a8b6e0f1d29c7a44' };

  it('lee la credencial nueva (nivel M, mayúsculas) y la firma sigue entera', async () => {
    const read = await readerPromise;
    const payload = buildCredentialQRPayload(old);
    const text = await read(cameraFrame(qrMatrix(payload, 'M')));
    expect(text).toBe(payload);
    expect(parseCredentialQRPayload(text)).toEqual({ memberId: '12345', token: old.credentialToken, signed: true });
  });

  it('sigue leyendo la credencial vieja (nivel H, minúsculas) que un socio tenga en el celular', async () => {
    const read = await readerPromise;
    const viejo = `JCSJ:12345.${old.credentialToken}`;
    const text = await read(cameraFrame(qrMatrix(viejo, 'H')));
    expect(text).toBe(viejo);
    expect(parseCredentialQRPayload(text).token).toBe(old.credentialToken);
  });

  it('lee el QR chico y lejos', async () => {
    const read = await readerPromise;
    const payload = buildCredentialQRPayload(old);
    expect(await read(cameraFrame(qrMatrix(payload, 'M'), { fill: 0.22 }))).toBe(payload);
  });

  it('lee el QR invertido solo cuando se lo pide', async () => {
    const read = await readerPromise;
    const payload = buildCredentialQRPayload(old);
    const frame = cameraFrame(qrMatrix(payload, 'M'), { invert: true });
    expect(await read(frame, { invert: true })).toBe(payload);
  });

  it('un QR lejos solo se lee recortando el centro a resolución nativa, no achicando el cuadro', async () => {
    const read = await readerPromise;
    const payload = buildCredentialQRPayload(old);
    // 1920x1080, el QR ocupa el 12 % del alto: ~130 px para 29 módulos + margen.
    const frame = cameraFrame(qrMatrix(payload, 'M'), { W: 1920, H: 1080, fill: 0.12 });
    const centro = cropCenter(frame, WASM_ROI_RATIO);
    expect(await read(centro)).toBe(payload);
    // achicado a 720 de lado, cada módulo queda en menos de 1 píxel: no se puede leer
    const chico = boxDownscale(frame, WASM_MAX_SIDE);
    expect(await read(chico)).toBe('');
  });

  it('un cuadro sin QR devuelve vacío', async () => {
    const read = await readerPromise;
    expect(await read(cameraFrame([[0]], { fill: 0.02 }))).toBe('');
  });
});
