/**
 * Lector de QR en WebAssembly (zxing-wasm): 5 a 10 veces más rápido que jsQR y más fiable
 * con el QR chico o lejos. El .wasm sale del propio sitio (no de un CDN): anda con la
 * sede sin internet y sin permisos extra.
 */

let readerPromise = null;

/**
 * Devuelve `read(imageData, { invert })` → texto del QR o ''.
 * `overrides` es para pruebas (pasarle `wasmBinary`); en el navegador va solo.
 */
export function loadWasmReader(overrides = null) {
  if (!readerPromise || overrides) {
    const pending = (async () => {
      const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader');
      let moduleOverrides = overrides;
      if (!moduleOverrides) {
        const wasmUrl = (await import('zxing-wasm/reader/zxing_reader.wasm?url')).default;
        moduleOverrides = {
          locateFile: (file, prefix) => (String(file).endsWith('.wasm') ? wasmUrl : `${prefix}${file}`),
        };
      }
      await prepareZXingModule({ overrides: moduleOverrides, fireImmediately: true });
      return async (imageData, { invert = false } = {}) => {
        const results = await readBarcodes(imageData, {
          formats: ['QRCode'],
          tryHarder: true,
          tryRotate: false,
          tryInvert: invert,
          maxNumberOfSymbols: 1,
        });
        const hit = results.find((row) => row.isValid !== false && row.text);
        return hit?.text || '';
      };
    })();
    if (overrides) return pending;
    readerPromise = pending.catch((error) => {
      readerPromise = null;
      throw error;
    });
  }
  return readerPromise;
}
