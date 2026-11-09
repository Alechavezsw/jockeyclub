/**
 * Contenido del Manual de Acceso QR (/acceso) — club y socio.
 * Lo dibuja scripts/generate-acceso-manual.mjs.
 *
 * Helvetica Latin-1: sin flechas ni emojis. Caminos de menú con " > ".
 */

export const CHAPTER_COUNT = 12;

export const ACCESO_MANUAL_TEXTS = {
  chromeRight: 'Manual de Acceso QR',
  coverTitle: 'Acceso QR',
  coverSubtitle: 'La puerta de la sede: del lado del club y del socio',
  coverBlurb:
    'Guía clara de la pantalla /acceso (el molinete digital) y de la credencial virtual del socio. Cómo escanear, qué significan los carteles, cómo presentar el QR y qué hacer cuando algo no cierra.',
  coverEdition: 'Versión 1.0',
  coverNote: 'Uso interno del club  ·  También para explicar al socio',
  tocIntro:
    'Los capítulos 1 a 7 son para quien atiende la puerta. Los capítulos 8 a 10 son para el socio (y para quien le explica cómo usar la credencial). El 11 resume los carteles; el 12, los problemas frecuentes.',
};

export function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  /* ------------------------------------------------------------------ 1 */
  m.h1('1.  Qué es Acceso QR', { n: '01' });
  m.p(
    'Acceso QR es la pantalla del molinete de la sede Rivadavia. No es el libro de ingresos ni la puerta de la pileta: es el control en vivo de quién entra al club con la credencial digital.'
  );
  m.table(
    ['Qué', 'Dónde', 'Para qué'],
    [
      ['Acceso QR', '/acceso  (Operación > Acceso QR)', 'Leer credenciales en la puerta y decidir el ingreso'],
      ['Ingresos', 'Operación > Ingresos', 'Ver el libro del día: lecturas, denegados y quién leyó'],
      ['Entrada pileta', '/entrada-pileta', 'Puerta de la pileta (otra caja, otras reglas)'],
      ['Credencial del socio', 'Inicio del portal del socio', 'Tarjeta virtual con QR firmado'],
    ],
    [42, 58, 78]
  );
  m.box(
    'tip',
    'Idea clave',
    'El socio muestra el QR desde el celular. El club lo lee en /acceso. El sistema dice si puede pasar, si tiene deuda, si está en mora de temporada o si hay que denegar. Vos decidís con el cartel a la vista; la lectura queda guardada.'
  );

  /* ------------------------------------------------------------------ 2 */
  m.h1('2.  Del lado del club: abrir el molinete', { n: '02' });
  m.h2('Quién puede usarlo');
  m.p(
    'Portería, caja, personal, administración y superadministración. Hace falta sesión del personal: no es una pantalla pública.'
  );
  m.h2('Cómo abrirlo');
  m.steps([
    'Entrá al portal del club con tu usuario de personal.',
    'Andá a Operación > Acceso QR, o abrí directo www.jockeyclubsj.com.ar/acceso.',
    'Usá preferente un celular o tablet en vertical: la pantalla está pensada para el mostrador de la puerta.',
    'Tocá Abrir cámara (o Reintentar cámara si falló). El navegador te pide permiso: aceptalo.',
    'Apuntá la cámara al QR del socio. No hace falta “disparar”: lee solo cuando ve un código válido.',
  ]);
  m.box(
    'ok',
    'Ritmo de la puerta',
    'No esperés a que se apague el cartel verde o rojo. La credencial siguiente reemplaza el resultado al instante. La misma credencial no se vuelve a leer mientras sigue frente a la cámara unos segundos: evita dobles lecturas.'
  );
  m.h2('Sin cámara o con mal internet');
  m.bullets([
    'Si la cámara no arranca: revisá permisos del navegador, probá Chrome o Safari, o usá Código manual.',
    'Si se corta internet: las lecturas se guardan en el dispositivo y se envían solas cuando vuelve la conexión.',
    'Si aparece NO SE PUDO VERIFICAR (amarillo): no es un rechazo. Buscá al socio por DNI o número y dejalo pasar a mano.',
  ]);

  /* ------------------------------------------------------------------ 3 */
  m.h1('3.  Del lado del club: leer el cartel', { n: '03' });
  m.p(
    'Cada lectura muestra un resultado grande. El título manda: es lo que tenés que mirar antes de abrir o cerrar el paso.'
  );
  m.table(
    ['Cartel', 'Qué significa', 'Qué hacés'],
    [
      ['ACCESO AUTORIZADO', 'Socio al día (o sin bloqueo de puerta)', 'Dejalo pasar'],
      ['ACCESO CON DEUDA', 'Debe cuota, pero la puerta no cierra', 'Pasa igual; invitalo a regularizar en Caja o Mi cuenta'],
      ['ACCESO DENEGADO · MORA', 'Temporada pileta (dic–mar), desde el 10, sin cuota del mes', 'No pasa. Que regularice; al acreditar, entra'],
      ['ACCESO DENEGADO', 'Suspendido u otro bloqueo', 'No pasa. Se rehabilita en la ficha, con motivo'],
      ['NO SE PUDO VERIFICAR', 'Sin conexión para comprobar la firma', 'Buscá por DNI/número y pasalo a mano'],
    ],
    [48, 72, 58]
  );
  m.box(
    'warn',
    'Mora de temporada',
    'ACCESO DENEGADO · MORA solo aparece en temporada de pileta (diciembre a marzo), a partir del día 10, si no pagó la cuota del mes. Fuera de esa ventana la deuda se informa (ACCESO CON DEUDA) pero no cierra la puerta. Un adherente hereda la mora de su titular: si el titular debe, el grupo tampoco entra en temporada.'
  );

  /* ------------------------------------------------------------------ 4 */
  m.h1('4.  Del lado del club: búsqueda manual', { n: '04' });
  m.p(
    'Cuando el socio no tiene celular, el QR no se lee o vino sin app, usá el buscador de la misma pantalla.'
  );
  m.steps([
    'En Código manual escribí DNI, apellido, número de socio o código JCSJ.',
    'Elegí el resultado correcto de la lista.',
    'Se aplican las mismas reglas que con el QR: autorizado, con deuda, mora o denegado.',
    'Si no figura en el padrón: avisá a Secretaría. No improvises un pase.',
  ]);
  m.box(
    'tip',
    'Misma persona, mismo criterio',
    'El ingreso a mano no es un “favor aparte”: es el mismo control con otro medio de identificación. Queda registrado igual en Ingresos.'
  );

  /* ------------------------------------------------------------------ 5 */
  m.h1('5.  Del lado del club: aviso “Ya ingresó”', { n: '05' });
  m.p(
    'Si sobre un ACCESO AUTORIZADO aparece un aviso amarillo del estilo «Ya ingresó hace N min», esa misma credencial entró hace poco (ventana corta, alrededor de 20 minutos).'
  );
  m.bullets([
    'Puede ser alguien que salió y volvió: normal.',
    'También puede ser un QR prestado, una captura mandada por WhatsApp o una foto del carnet en otro celular.',
    'El aviso no bloquea solo: mirá que la persona frente a vos sea el socio de la ficha (nombre y foto si hay).',
    'Si dudás, pedí DNI o buscalo a mano y confirmá identidad.',
  ]);
  m.box(
    'warn',
    'El QR se puede copiar',
    'No se puede inventar un QR con solo el número, pero sí se puede reenviar una captura vigente. Por eso existe el aviso de reingreso reciente. Pedile al socio que no mande su QR por WhatsApp.'
  );

  /* ------------------------------------------------------------------ 6 */
  m.h1('6.  Del lado del club: reservas de hoy e historial', { n: '06' });
  m.h2('Reservas de hoy');
  m.p(
    'En la misma pantalla /acceso hay un bloque Reservas de hoy: canchas, salones y demás instalaciones con turno en la fecha. Sirve para anticipar llegadas y cruzar nombre o número sin salir del molinete.'
  );
  m.h2('Lecturas de hoy');
  m.bullets([
    'El botón Hoy muestra las lecturas del turno en la puerta.',
    'El libro completo del día (y el historial) está en Operación > Ingresos.',
    'Cada lectura guarda quién la hizo: útil si después hay un reclamo.',
  ]);
  m.box(
    'tip',
    'Pileta aparte',
    'No uses Acceso QR para la puerta de la pileta. Entrada pileta y la caja de pileta son pantallas propias, con canon e invitados.'
  );

  /* ------------------------------------------------------------------ 7 */
  m.h1('7.  Del lado del club: invitados y pases', { n: '07' });
  m.p(
    'Además de la credencial de socio, /acceso puede leer pases de invitado del día cuando el club los emite.'
  );
  m.bullets([
    'ANFITRIÓN EN MORA: el socio que invita está bloqueado por mora de temporada; el invitado no entra por ese pase.',
    'PASE INVÁLIDO: vencido, anulado o con anfitrión suspendido.',
    'Los pases valen solo el día. No reutilices uno de ayer.',
  ]);
  m.box(
    'ok',
    'Registro',
    'Un QR inválido o adulterado también queda anotado en Ingresos. No hace falta inventar una planilla aparte.'
  );

  /* ------------------------------------------------------------------ 8 */
  m.h1('8.  Del lado del socio: la credencial digital', { n: '08' });
  m.p(
    'La credencial del socio es la tarjeta virtual del Inicio del portal: nombre, número de socio y un QR firmado por el club. Reemplaza el carnet plástico para pasar por la puerta.'
  );
  m.steps([
    'Entrá a www.jockeyclubsj.com.ar con tu usuario de socio (o abrí Mi cuenta: www.jockeyclubsj.com.ar/cuenta).',
    'En Inicio vas a ver tu credencial virtual.',
    'Tocá la tarjeta para verla a pantalla completa (recomendado en la puerta).',
    'Si querés, descargá el PDF de la credencial desde la misma tarjeta para tener una copia; el ingreso vivo sigue siendo el QR de la app.',
  ]);
  m.box(
    'tip',
    'Firmada = válida',
    'El QR lleva una firma digital. Un carnet impreso viejo, un código inventado o un QR recortado de otra app no sirven. Si la app no abre o el QR no aparece, pedí ayuda en Secretaría o Caja: te buscan por DNI o número.'
  );

  /* ------------------------------------------------------------------ 9 */
  m.h1('9.  Del lado del socio: cómo presentarla en la puerta', { n: '09' });
  m.steps([
    'Subí el brillo del celular al máximo.',
    'Abrí la credencial a pantalla completa (un toque en la tarjeta).',
    'Acercá el QR a la cámara de portería, sin temblar y sin dedos tapando el código.',
    'Esperá el pitido o el cartel. No hace falta “acercar y sacar”: el lector trabaja solo.',
    'Si no lee: bajá un poco el celular, limpiá el vidrio, o pedí búsqueda por DNI / apellido / número.',
  ]);
  m.h2('Buenas prácticas del socio');
  m.bullets([
    'No mandes tu QR por WhatsApp ni lo dejes en capturas compartidas: alguien más podría usarlo.',
    'No uses una foto vieja guardada en el álbum si renovaste la app: abrí de nuevo Inicio.',
    'Si estás en mora de cuota en temporada de pileta (desde el 10, dic–mar), regularizá en Mi cuenta o en Caja antes de ir a la puerta.',
    'Vitalicio, fundador y comisión no abonan cuota: no quedan en mora de cuota por ese motivo.',
    'Si sos adherente, la cuenta la lleva el titular: la mora del titular te afecta en temporada.',
  ]);
  m.box(
    'warn',
    'Sin celular',
    'Decile a portería tu DNI o número de socio. Te buscan a mano con las mismas reglas. No hace falta “inventar” un pase.'
  );

  /* ------------------------------------------------------------------ 10 */
  m.h1('10.  Del lado del socio: deuda, mora y Mi cuenta', { n: '10' });
  m.p(
    'La puerta y la cuenta corriente hablan el mismo idioma, pero no son lo mismo. Entender la diferencia evita discusiones en el molinete.'
  );
  m.table(
    ['Situación', 'En la puerta', 'Qué puede hacer el socio'],
    [
      ['Al día', 'ACCESO AUTORIZADO', 'Entrar con normalidad'],
      ['Deuda fuera de temporada pileta', 'ACCESO CON DEUDA (pasa)', 'Pagar en Mi cuenta o Caja cuando pueda'],
      ['Mora en temporada (dic–mar, desde el 10)', 'ACCESO DENEGADO · MORA', 'Pagar la cuota; al acreditarse, entra'],
      ['Cuenta suspendida', 'ACCESO DENEGADO', 'Hablar con Secretaría / Administración'],
      ['Exento (vitalicio, fundador, comisión)', 'Sin mora de cuota', 'Credencial normal; no paga cuota social'],
    ],
    [52, 52, 74]
  );
  m.box(
    'ok',
    'Link útil',
    'Mi cuenta: https://www.jockeyclubsj.com.ar/cuenta — estado de cuota, medios de pago y avisos. No uses dominios viejos ni links de terceros.'
  );

  /* ------------------------------------------------------------------ 11 */
  m.h1('11.  Tabla rápida de carteles', { n: '11' });
  m.p('Resumen para tener a mano en el mostrador o para explicar al socio en una frase.');
  m.table(
    ['Color / tono', 'Título típico', 'Acción'],
    [
      ['Verde', 'ACCESO AUTORIZADO', 'Abrir el paso'],
      ['Verde con aviso amarillo', 'Autorizado + Ya ingresó hace N min', 'Abrir, pero confirmar identidad'],
      ['Ámbar / deuda', 'ACCESO CON DEUDA', 'Abrir e invitar a regularizar'],
      ['Rojo · mora', 'ACCESO DENEGADO · MORA', 'No abrir; orientar a pago'],
      ['Rojo', 'ACCESO DENEGADO', 'No abrir; ver suspensión'],
      ['Amarillo', 'NO SE PUDO VERIFICAR', 'Buscar a mano; no acusar'],
    ],
    [48, 72, 58]
  );

  /* ------------------------------------------------------------------ 12 */
  m.h1('12.  Problemas frecuentes', { n: '12' });
  m.h2('No lee el QR');
  m.bullets([
    'Brillo bajo, reflejo del sol o funda que tapa el borde del código.',
    'Carnet impreso anterior a la firma digital: que abra la app.',
    'Cámara del club sin permiso o pestaña en segundo plano: reabrir /acceso y Abrir cámara.',
    'Solución inmediata: Código manual con DNI, apellido o número.',
  ]);
  m.h2('Dice denegado y el socio se enoja');
  m.bullets([
    'Leé el título completo del cartel en voz alta: mora, suspendido o no verificado no son lo mismo.',
    'En mora de temporada: el camino es pagar; no “pasar por esta vez” si la regla está activa.',
    'En adherente: la mora es del titular.',
    'El detalle queda en Operación > Ingresos si hace falta revisar después.',
  ]);
  m.h2('Qué no hacer');
  m.bullets([
    'No dejes pasar un DENEGADO · MORA “solo hoy” si la regla de temporada está prendida.',
    'No uses la pantalla de Pileta como molinete de la sede, ni al revés.',
    'No inventes un pase si el número no está en el padrón.',
    'No pidas al socio que te mande el QR por WhatsApp para “probar”.',
    'No fotografíes el padrón ni compartas capturas de fichas.',
  ]);
  m.box(
    'tip',
    'Si algo no está en este manual',
    'Preguntale a Jev (IA > Consulta) con el número de socio o la duda (“¿por qué no lo deja pasar?”). Jev lee las mismas reglas que la puerta; no inventa excepciones. Si hace falta cambiar una regla de mora de temporada, eso se configura en Sistema > Configuración > Pileta, no en /acceso.'
  );
}
