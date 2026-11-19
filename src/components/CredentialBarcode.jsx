import { useEffect, useId, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import {
  BARCODE_FORMAT,
  buildCredentialBarcodePayload,
} from '../domain/credentials/barcode';

/**
 * Code 128 optimizado para pistola láser / imager:
 * alto generoso, quiet zone, módulos anchos, fondo blanco puro.
 */
export default function CredentialBarcode({
  member,
  height = 56,
  displayValue = true,
  className,
  style,
}) {
  const svgRef = useRef(null);
  const reactId = useId().replace(/:/g, '');
  const payload = buildCredentialBarcodePayload(member);

  useEffect(() => {
    const node = svgRef.current;
    if (!node || !payload) return;
    try {
      JsBarcode(node, payload, {
        format: BARCODE_FORMAT,
        width: 2.2,
        height,
        displayValue,
        fontSize: 12,
        textMargin: 4,
        margin: 12,
        background: '#ffffff',
        lineColor: '#060e0a',
        flat: false,
      });
    } catch {
      node.replaceChildren();
    }
  }, [payload, height, displayValue]);

  if (!payload) return null;

  return (
    <div
      className={className}
      style={{
        background: '#ffffff',
        borderRadius: 10,
        padding: '10px 12px 6px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        ...style,
      }}
      aria-label={`Código de barras ${payload}`}
    >
      <svg ref={svgRef} id={`cred-barcode-${reactId}`} role="img" />
    </div>
  );
}

/** PNG data URL para el PDF de credencial. */
export function renderCredentialBarcodePng(member, {
  height = 90,
  scale = 3,
} = {}) {
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
