/**
 * Plan de lectura del QR: qué decodificador corre en cada cuadro.
 *
 * Antes cada cuadro probaba hasta 6 decodificadores en cascada (ZXing en JS y jsQR sobre
 * tres recortes), y en un celular o tablet sin lector nativo eso eran segundos por intento.
 * Ahora: el nativo si existe, el de WebAssembly (1 a 2 ms) en un solo cuadro de ~720 px, y
 * jsQR solo de respaldo si el .wasm no cargó.
 */

/** Lado mayor del cuadro que se le da al lector. Alcanza para un QR a 1 m y se lee en un instante. */
export const WASM_MAX_SIDE = 720;
/** Cada tanto se recorta el centro del cuadro a resolución nativa: un QR chico o lejos conserva sus puntos. */
export const WASM_ROI_RATIO = 0.55;
export const WASM_NATIVE_SIDE = 1920;
/** Y cada tanto el cuadro entero a resolución completa (el QR más chico y lejos, o el viejo, más denso). */
export const WASM_FULL_SIDE = 1280;
export const JSQR_MAX_SIDE = 480;

/** Mide el cuadro final sin agrandar nunca. */
export function fitSize(width, height, maxSide) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  const scale = longest > maxSide ? maxSide / longest : 1;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Cuadro entero achicado (casi siempre), centro recortado a resolución nativa y cuadro entero completo. */
function wasmStep(n) {
  const invert = n % 4 === 0;
  if (n % 6 === 0) return { invert, maxSide: WASM_FULL_SIDE, crop: 1 };
  if (n % 3 === 0) return { invert, maxSide: WASM_NATIVE_SIDE, crop: WASM_ROI_RATIO };
  return { invert, maxSide: WASM_MAX_SIDE, crop: 1 };
}

/**
 * @param {number} tick número de cuadro (0, 1, 2…)
 * @param {{ hasNative?: boolean, wasmReady?: boolean }} caps
 * @returns {{ native: boolean, wasm: null | { invert: boolean, maxSide: number, crop: number }, jsqr: null | { inversion: string, maxSide: number } }}
 */
export function planDecode(tick, { hasNative = false, wasmReady = false } = {}) {
  const n = Math.max(0, Math.trunc(Number(tick) || 0));
  // Con lector nativo, WebAssembly entra de refuerzo cada 3 cuadros; sin él, en todos.
  const wasmRun = wasmReady && (!hasNative || n % 3 === 0);
  const jsqrRun = !wasmReady && (!hasNative || n % 3 === 0);
  return {
    native: hasNative,
    wasm: wasmRun
      ? wasmStep(n)
      : null,
    jsqr: jsqrRun
      ? { inversion: n % 4 === 0 ? 'attemptBoth' : 'dontInvert', maxSide: JSQR_MAX_SIDE }
      : null,
  };
}
