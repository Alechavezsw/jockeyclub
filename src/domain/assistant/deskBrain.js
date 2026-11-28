/** Libro de reglas del escritorio. Jev no inventa: si no está acá o en la base, lo dice. */
export const DESK_RULE_MARK = 'El mes que ya empezó no es cuota anticipada.';

export const DESK_RULES = Object.freeze({
  cuota: `Cuota social. El día 1 se liquida el mes a cada titular que abona. Si no paga, el mes siguiente se suma otra cuota arriba. Vence el 10. El 10 o antes: sin recargo. Desde el 11: mora.
Socio individual: $ 40.000 de capital en noviembre y en todos los meses.
Socio familiar: $ 70.000 de capital. En mora el recibo de cada mes es $ 77.000 (capital + 10 %).
El saldo de la ficha guarda capital. El 10 % no se mete al liquidar: se calcula al cobrar.
Hasta que el mes no está liquidado, nadie lo debe. En noviembre nadie debe diciembre. Un próximo vencimiento en el mes que sigue no es deuda.
El recibo nombra el mes en español: «Noviembre de 2026». Si son varios, van todos.
Mi cuenta: https://www.jockeyclubsj.com.ar/cuenta.`,
  mora: `Mora de cuota social: desde el día 11 del mes, 10 % sobre el capital, solo socio familiar y socio individual. Se suma al cobrar, no al liquidar.
El débito (caja, Galicia, automático, suscripción de Mercado Pago) cobra solo capital: no lleva el 10 %. Efectivo, transferencia, tarjeta y Mercado Pago de un pago sí llevan el 10 % si el mes ya venció.
No se perdona el recargo en el mostrador. AMET no lleva este 10 %.`,
  adelanto: `Adelanto de cuota social: uno o varios meses que todavía no empezaron. Es voluntario, es capital, no es deuda y no lleva 10 %.
${DESK_RULE_MARK} Cobrar noviembre el 27 de noviembre es la cuota de noviembre. Si es individual y ya venció, son $ 40.000 + 10 % = $ 44.000, y el recibo dice «Cuota social · Noviembre de 2026».
Cuando ese mes futuro se liquide, el socio ya figura pago y no se le genera deuda de ese mes.
El adelanto no se guarda como un saldo a favor genérico que después se coma otro mes.
Consultar deuda, mora y boleto no muestran los meses futuros como deuda.`,
  exentos: `Vitalicio, fundador y comisión no abonan cuota social. No tienen mora, ni Mercado Pago de cuota, ni aviso de cuota, ni cobro de cuota en caja.
Sí pueden pagar una reserva u otro cargo que no sea cuota, y el comprobante de ese cobro sí les llega.
El abono de tenis, si está en la ficha o en el grupo, se cobra igual: $ 12.000 por mes, sin el 10 %, aparte de la cuota, a la cuenta del titular.`,
  reserva: `La reserva de instalación (salón, Espacio Verde) es aparte de la cuota social. No es mora y no lleva el 10 % de la cuota.
Siempre seña del 50 % del precio total. El resto queda pendiente en la cuenta del titular.
Mercado Pago, transferencia o aviso de pago de reserva: el monto es la seña, salvo que el socio pague el resto a propósito.
Comisión (presidente o comisión directiva) no paga canon de salones ni Espacio Verde: Anhelo, Bustos, Maurín, Refugio y Espacio Verde a $ 0, sin seña. No aplica a canchas ni pileta. Vitalicio y fundador sí pagan, salvo que también sean comisión.`,
  grupo: `El grupo familiar vive en la ficha del titular. Se lee titular más integrantes, cada uno con su número real.
La cuota y el alquiler van a la cuenta del titular. Si el titular está al día, el estado es Al día.
Al agregar un integrante, la categoría sale del titular.`,
  comprobante: `Cuando un cobro queda acreditado a un socio, el comprobante sale solo: PDF al mail real y mensaje en el portal. El cobro no falla si el mail falla.
No se reenvía el mismo comprobante. El mail no va a casillas inventadas del club.
El recibo nombra los meses. El link de Mi cuenta es https://www.jockeyclubsj.com.ar/cuenta.`,
  colonia: `Colonia de Verano 2026/2027 es un libro aparte de la cuota social.
Inscripción: $ 50.000. El 4º hermano paga solo la inscripción: el plan queda en $ 0.
Socio: cuota mensual $ 150.000, temporada $ 390.000, 2 hermanos $ 280.000, 3 hermanos $ 410.000.
No socio: temporada $ 490.000 por cada chico (también 2 y 3 hermanos). Cuota mensual no socio $ 180.000.
El 15 % de la cuota de Colonia corre desde diciembre: el 10 de ese mes sin interés, desde el 11 se suma al cobrar. Noviembre no lleva ese 15 %. La inscripción, la temporada y la cuota social no llevan ese 15 %.
Las promos de hermanos son temporada completa, no una cuota mensual.`,
  pileta: `La pileta no es la cuota social. El apto médico se carga en la ficha. El canon de pileta, si corresponde, se cobra antes de dar el apto por cargado.
Un no socio de pileta o de colonia puede tener acceso a la app sin cuota social.
La entrada del día es la pantalla Entrada pileta. El abono de la temporada no se mezcla con la mora de la cuota.`,
  roles: `Liquidan cuotas: superadministrador y contador. El administrador no entra a Contabilidad. Cajero y portería ven su caja, no el diario.
El profesor entra a asistencia, no al panel.
Jev solo lee. No cobra, no liquida, no cambia una ficha y no manda un mail.`,
});

export const DESK_TOPICS = Object.freeze(Object.keys(DESK_RULES));

export function deskRule(topic) {
  const key = String(topic || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (DESK_RULES[key]) return DESK_RULES[key];
  if (key.startsWith('anticip')) return DESK_RULES.adelanto;
  if (key.includes('familia')) return DESK_RULES.grupo;
  if (key.includes('tenis')) return DESK_RULES.exentos;
  return null;
}

export function parseDeskJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const slice = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  try {
    const json = JSON.parse(slice);
    if (!json || typeof json !== 'object') return null;
    return json;
  } catch {
    return null;
  }
}

/** Gemini manda cuando contestó de verdad. Si no, queda el libro de la sesión. */
export function preferDeskReply(local, remote) {
  const parsed = parseDeskJson(remote?.text) || remote || {};
  const remoteText = String(parsed.text || (parsed.verdict ? '' : remote?.text) || '').trim();
  const broken = !remoteText || remoteText.startsWith('{') || remoteText.startsWith('```');
  const gemini = remote?.source === 'gemini' && !broken;
  if (!gemini) {
    const note = String(parsed.text || remote?.text || '').trim();
    if (note && /gemini/i.test(note)) {
      return {
        verdict: parsed.verdict || 'Gemini no respondió',
        text: note,
        figures: [],
        next: parsed.next || null,
        go: null,
        focus: null,
        lookups: [],
        source: 'gemini',
      };
    }
    return {
      verdict: local?.verdict || 'No tengo ese dato en el libro.',
      text: local?.text || 'No pude consultar la base. Preguntame de nuevo en un momento.',
      figures: Array.isArray(local?.figures) ? local.figures : [],
      next: local?.next || null,
      go: local?.go || null,
      focus: local?.focus || null,
      lookups: [],
      source: 'libro',
    };
  }
  const figures = Array.isArray(parsed.figures) && parsed.figures.length
    ? parsed.figures
    : (Array.isArray(local?.figures) ? local.figures : []);
  return {
    verdict: parsed.verdict || local?.verdict || null,
    text: remoteText,
    figures,
    next: parsed.next || null,
    go: parsed.tab || parsed.go || local?.go || null,
    focus: parsed.focus || local?.focus || null,
    lookups: Array.isArray(remote.lookups) ? remote.lookups.slice(0, 6) : [],
    source: 'gemini',
  };
}
