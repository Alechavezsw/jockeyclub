import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LILA_BALANCE_CUT,
  summarizeCurrentAccountCut,
} from '../../domain/accounting/currentAccountBalances';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function longDate(iso) {
  const [year, month, day] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '';
  return `${day} de ${MONTHS[month - 1]} del ${year}`;
}

function pesos(amount) {
  const value = Number(amount) || 0;
  const text = value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$ ${text}`;
}

/** Signo de pregunta mínimo. La explicación del corte se abre al tocarlo. */
export default function CurrentAccountCutNote({ members = [] }) {
  const summary = useMemo(() => summarizeCurrentAccountCut(members), [members]);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(352, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      const top = rect.bottom + 6;
      setBox({ top, left, width });
    };
    place();
    const onPointer = (event) => {
      const target = event.target;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!summary.asOf) return null;

  const date = longDate(summary.asOf);
  const sameCut = summary.asOf === LILA_BALANCE_CUT.asOf;
  const omitted = LILA_BALANCE_CUT.omitted.map((row) => row.memberNumber).join(', ');

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cc-cut-q"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="De dónde salen estos saldos"
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open && box
        ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className="cc-cut-note"
            role="region"
            aria-label="Corte de saldos"
            style={{ top: box.top, left: box.left, width: box.width }}
          >
            <p>
              Estos datos salieron de Lila el {date} y quedaron en esta app.
              A partir de ese corte, el padrón y los saldos se usan acá.
              Hay {summary.members.toLocaleString('es-AR')} socios.
              Hoy, {summary.withBalance.toLocaleString('es-AR')} deben y el total es {pesos(summary.total)}.
            </p>
            {sameCut ? (
              <p>
                El archivo de Lila sumaba {pesos(LILA_BALANCE_CUT.filePositiveTotal)}.
                La diferencia de {pesos(LILA_BALANCE_CUT.omittedTotal)} son los números {omitted}, que no vinieron en el padrón.
              </p>
            ) : null}
            {sameCut ? (
              <p>
                El detalle de cada cuota es el de septiembre, del 1 al 29, tal como salió de Lila a las 10:15.
              </p>
            ) : null}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
