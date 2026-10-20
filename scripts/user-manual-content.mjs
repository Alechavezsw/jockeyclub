/**
 * Contenido del Manual de uso (PDF). Lo dibuja scripts/generate-user-manual.mjs.
 * Edición 2.0 · octubre de 2026.
 *
 * Reglas de redacción:
 * - El PDF usa Helvetica estándar: nada de flechas ni símbolos fuera de Latin-1.
 *   Los caminos de menú se escriben con " > ".
 * - Cada dato sale del código del portal; si cambia una regla, se cambia acá.
 */

export const CHAPTER_COUNT = 22;

export function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  /* ------------------------------------------------------------------ 1 */
  m.h1('1.  Antes de empezar', { n: '01' });
  m.p('Este portal es el sistema del Jockey Club San Juan, Sede Rivadavia. Reemplaza papeles sueltos, planillas y credenciales viejas por una sola herramienta: la misma para socios, portería, pileta, caja, secretaría y tesorería.');
  m.p('No hace falta instalar nada. Se abre en el celular, la tablet o la computadora, con internet, en www.jockeyclubsj.com.ar. Pedile al club tus datos de ingreso (ver capítulo 2 si todavía no tenés usuario).');
  m.h2('Cómo está organizado');
  m.bullets([
    'Portal del socio: Inicio, Reservar Canchas, Mi Cuenta, Novedades, Perfil y Mensajes.',
    'Panel del personal: el menú de la izquierda se agrupa en Operación, Club, Gestión, Comunicación, Administración y Sistema. Arriba hay un buscador (Ctrl + /) para ir directo a una sección o a un socio.',
    'Pantallas de puerta y de aula: Acceso QR (la puerta de la sede), Entrada pileta (la puerta de la pileta) y Asistencia (para profesores).',
    'Jev: el asistente del panel. Contesta preguntas sobre el club y tiene este mismo manual, resumido por oficio (capítulo 16).',
  ]);
  m.h2('Quién usa qué');
  m.p('Al entrar, el sistema te muestra solo lo que te corresponde. Un socio no ve la contabilidad. Un administrador no ve los libros contables (eso es de tesorería). Un profesor ve asistencia. Así nadie se pierde ni toca lo que no le toca.');
  m.table(
    ['Si sos…', 'Entrás a…', 'Para…'],
    [
      ['Socio o socia', 'Inicio, Reservar Canchas, Mi Cuenta, Novedades, Perfil, Mensajes', 'Credencial, turnos, pagar la cuota, invitados'],
      ['Adherente (grupo familiar)', 'Inicio y credencial', 'Tu cuenta y tus reservas las lleva el titular'],
      ['Profesor/a', 'Asistencia', 'Tomar presente y ver si el alumno tiene la cuota al día'],
      ['Operador/a de portería', 'Acceso QR + panel: Socios, Pileta, Ingresos, Caja', 'Controlar el ingreso y cobrar en caja'],
      ['Operario/a de pileta', 'Entrada pileta y Pileta', 'Controlar la puerta de la pileta y cobrar el canon'],
      ['Cajero/a', 'Acceso QR + panel: Socios, Saldos, Pileta, Ingresos, Fiestas, Caja', 'Cobrar cuotas y registrar ingresos de caja'],
      ['Personal', 'Acceso QR + panel: Reservas, Disciplinas, Pileta, Ingresos, Personal, Fiestas, Alertas, Reclamos, Novedades', 'Operación diaria de la sede'],
      ['Empleado/a de administración', 'Panel: Socios, Saldos, Reservas, Pileta, Profesores, Fiestas y atención al socio', 'Padrón, saldos y atención. No liquida cuotas'],
      ['Recursos humanos', 'Panel: Personal y Alertas', 'Legajos y novedades del staff'],
      ['Contador/a', 'Panel: Cuotas, Contabilidad, Reportes, Fiestas', 'Liquidar cuotas, libros, balances'],
      ['Administrador/a', 'Todo el panel operativo, sin Contabilidad', 'Padrón, reservas, atención y profesores'],
      ['Superadministrador/a', 'Todo el panel', 'Usuarios, perfiles, configuración'],
      ['Concesionario', 'Portal de concesión, con su código', 'Ver su contrato y su canon'],
    ],
    [40, 78, 60]
  );
  m.box('tip', 'Consejo', 'Si no ves una pantalla que “deberías” ver, no es un error tuyo: tu usuario no tiene ese permiso. Pedile al Superadministrador que revise tu rol. Puede ser más de uno: los permisos se suman.');

  /* ------------------------------------------------------------------ 2 */
  m.h1('2.  Cómo entrar, asociarse y recuperar la clave', { n: '02' });
  m.h2('Ingreso');
  m.steps([
    'Abrí el enlace del portal que te dio el club (preferible en Chrome o Safari).',
    'Escribí tu correo electrónico. Tiene que ser el mismo que figura en tu ficha.',
    'Escribí tu contraseña. Nadie del club debería pedirte que se la dictes por WhatsApp.',
    'Tocá Ingresar al portal. Si algo falla, el sistema te dice el motivo (clave incorrecta, usuario inexistente, etc.).',
  ]);
  m.h2('Ya soy socio y no tengo usuario, o olvidé la clave');
  m.p('En la pantalla de ingreso, debajo del botón, está el enlace “Ya soy socio y no tengo usuario / olvidé la contraseña”.');
  m.steps([
    'Escribí tu nombre y apellido. El sistema busca tu ficha en el padrón: elegila de la lista.',
    'Completá tu DNI, tu celular de WhatsApp y, si querés, tu mail.',
    'Elegí el motivo. Si tu ficha todavía no tiene usuario, el motivo es “No tengo usuario”. Si ya lo tiene, el sistema lo avisa (“ya tiene usuario”) y solo queda “Olvidé la contraseña”.',
    'Enviá el pedido. Secretaría verifica tu ficha y te contacta. Por esa pantalla nunca se entrega un usuario ni una clave nueva.',
  ]);
  m.h2('Quiero asociarme al club');
  m.p('El otro enlace de la pantalla de ingreso es “Quiero asociarme al club”. Completás nombre y apellido, documento, celular de WhatsApp y email (obligatorios) y, si querés, fecha de nacimiento, domicilio, ciudad, provincia, la categoría que te interesa y un comentario.');
  m.bullets([
    'Si el documento, el celular o el nombre ya figuran en el padrón, el formulario te lo marca y te sugiere usar “Ya soy socio”.',
    'Al enviar, te llega un mail de bienvenida. La solicitud queda pendiente hasta que Secretaría la apruebe.',
    'Cuando te dan de alta, te llega otro mail con tu usuario y tu contraseña.',
  ]);
  m.h2('Salir');
  m.p('Arriba a la derecha aparece tu nombre (por ejemplo “Hola, Ana”). Ahí está el botón Salir. Usalo siempre si estás en una computadora compartida (caja, portería, sala de profesores).');
  m.box('warn', 'Importante', 'Nunca dejes la sesión abierta en un celular o PC que no es tuyo. Quien esté sentado ahí podría ver tu cuenta, tu saldo o, si sos personal, el padrón.');

  /* ------------------------------------------------------------------ 3 */
  m.h1('3.  Guía del socio', { n: '03' });
  m.p('Cuando entrás como socio ves un menú simple. Esas son tus puertas:');
  m.bullets([
    'Inicio: tu resumen, la credencial digital, el estado de tu cuota, tus reservas, los invitados del día, los mensajes nuevos y los accesos rápidos.',
    'Reservar Canchas: turnos de tenis, pádel, pileta, salones y demás espacios.',
    'Mi Cuenta: tu situación, los pagos, el historial y los recibos (capítulo 7).',
    'Novedades: noticias y avisos del club.',
    'Perfil: tu ficha. Ahí podés ver tus datos y cargar tus documentos, por ejemplo el apto médico para la pileta (si el club lo permite).',
    'Mensajes: la bandeja interna del club (capítulo 9).',
  ]);
  m.h2('Qué ves en Inicio');
  m.p('Arriba está tu credencial con el código QR. Más abajo, el estado de la cuota (“Al día”, el atraso en meses o el monto que debés), tus próximas reservas, el pase de invitados del día, tus mensajes nuevos, tus pedidos y reclamos, las encuestas activas y el clima de la sede con el aviso de Zonda.');
  m.h2('Qué significa “al día”, “con deuda” o “en mora”');
  m.bullets([
    'Al día: no tenés saldo pendiente. Mi Cuenta te muestra el próximo cobro y su fecha.',
    'Con deuda: tenés un saldo de cuota. El monto aparece en pesos.',
    'En mora: pasó el vencimiento sin pagar (el 10 de cada mes; el 18 si tu categoría es AMET). Ves cuántos meses de atraso tenés. Desde el día siguiente al vencimiento corre un recargo del 10 % en socio familiar e individual (capítulo 8).',
  ]);
  m.p('Fuera de la temporada de pileta (diciembre a marzo), la deuda se informa pero no te deja afuera de la sede. En temporada, desde el día 10, quien no pagó la cuota del mes no ingresa al club hasta regularizar. Y en cualquier época, estando en mora no se puede pagar la pileta.');
  m.h2('Grupo familiar: titular y adherentes');
  m.p('Si tu categoría es familiar, en Inicio aparece tu grupo. El titular lleva la cuenta: paga la cuota del grupo, hace las reservas y genera los invitados. Un adherente (cónyuge, hijos, etc.) ve su inicio y su credencial, pero no paga ni reserva por su cuenta: si lo intenta, el sistema le avisa que “las reservas las hace el titular de la cuenta”.');
  m.h2('Categorías que no pagan cuota');
  m.p('Vitalicio, fundador y comisión no abonan cuota social. Si sos de esas categorías, Mi Cuenta te lo dice, no te muestra botones de pago y no recibís avisos de vencimiento ni de mora. Nunca vas a ver una deuda de cuota.');
  m.box('ok', 'Tu ficha es tuya', 'Nadie más, como socio, puede ver el domicilio, el DNI o los pagos de otra persona. En las canchas tampoco ves quién reservó: solo ves si el turno está libre u ocupado.');

  /* ------------------------------------------------------------------ 4 */
  m.h1('4.  Credencial digital y entrada a la sede', { n: '04' });
  m.p('Tu “carnet” vive en el celular. En Inicio está la tarjeta virtual con tu nombre, número de socio y un código QR. Ese QR es la llave del molinete.');
  m.h2('Cómo pasar el QR');
  m.steps([
    'Entrá al portal con tu usuario (no alcanza una captura vieja de hace meses).',
    'Abrí Inicio y dejá la tarjeta a pantalla completa, con el brillo alto.',
    'Acercá el celular al lector de portería, o mostráselo al personal.',
    'Esperá la luz o el mensaje: ACCESO AUTORIZADO, ACCESO CON DEUDA, o ACCESO DENEGADO.',
  ]);
  m.h2('Por qué a veces no anda');
  m.bullets([
    'Un carnet impreso de antes de la firma no vale: el sistema exige el QR firmado de la app.',
    'Pantalla sucia, brillo bajo o el protector tapando el código.',
    'Cuenta suspendida: el ingreso se deniega hasta que Administración rehabilite.',
    'En temporada de pileta, cuota del mes sin pagar desde el día 10: aparece ACCESO DENEGADO por mora. En un grupo familiar, la mora del titular alcanza a todos.',
    'Sin internet en portería: el cartel dice NO SE PUDO VERIFICAR y el personal busca tu número o tu DNI a mano. No es un rechazo.',
  ]);
  m.p('El QR ahora tiene menos puntos que antes: se lee más rápido y desde más lejos. Si tenés el anterior guardado, también funciona.');
  m.box('tip', 'Si el lector no toma tu QR', 'Subí el brillo del celular, acercalo un poco o abrí la app de nuevo. Si no lo toma, decile a portería tu número de socio o tu DNI: ellos lo cargan a mano y el sistema te reconoce igual.');
  m.box('warn', 'No mandes tu QR por WhatsApp', 'Nadie puede inventar tu QR con tu número, pero una captura se puede copiar y usar. Por eso, si tu credencial entra dos veces en poco rato, portería ve un aviso amarillo: “Ya ingresó hace N min”. Tu credencial es personal.');

  /* ------------------------------------------------------------------ 5 */
  m.h1('5.  Cómo reservar un turno', { n: '05' });
  m.steps([
    'Andá a Reservar Canchas (o al calendario desde Inicio).',
    'Elegí el espacio: cancha, salón, pileta, etc.',
    'Elegí el día. Los días con más verde suelen tener más huecos libres.',
    'Elegí un horario libre y confirmá. El turno queda a tu nombre.',
    'Si te arrepentís, cancelalo desde tus reservas (si el reglamento del espacio lo permite).',
  ]);
  m.h2('Las reglas de cada espacio');
  m.p('Cada espacio tiene su propia regla, y el sistema te avisa con un mensaje claro cuando no la cumplís. Las que más vas a ver:');
  m.bullets([
    '“Se puede reservar hasta N días antes” y “Hay que reservar con al menos N horas de anticipación”.',
    '“Ese turno ya está reservado” o “ya empezó”.',
    '“El máximo de invitados es N” para ese espacio.',
    '“Tu categoría de cuota no puede reservar este espacio”.',
    '“Ya tenés una reserva vigente en este espacio”.',
    '“Las reservas las hace el titular de la cuenta”, si sos adherente.',
  ]);
  m.p('Según el espacio, la reserva queda confirmada al instante o pendiente de aprobación del club, y puede cargarse a tu cuenta corriente.');
  m.h2('Turno ocupado');
  m.p('Si el horario ya está tomado, ves “ocupado”, pero no el nombre de la otra persona. Podés anotarte en lista de espera: si se libera, el club te tiene en cuenta.');
  m.h2('Viento Zonda');
  m.p('Cuando el club activa alerta Zonda, las actividades al aire libre se suspenden. Las cubiertas (gimnasio, salones, etc.) siguen. El aviso aparece en tu Inicio y en la pantalla de reservas.');
  m.h2('Salones y eventos');
  m.p('Los salones de fiestas, parrilla y espacios sociales se reservan igual, a veces con importe. Si tenés dudas de precio o de horario de cierre, preguntá en Secretaría antes de confirmar un evento grande.');
  m.box('warn', 'Respetá el turno', 'Una reserva confirmada ocupa el espacio para todo el club. Si no vas a usarla, cancelala con tiempo para que otro socio pueda tomarla.');

  /* ------------------------------------------------------------------ 6 */
  m.h1('6.  Invitados del día', { n: '06' });
  m.steps([
    'En Inicio, buscá “Invitados del día”.',
    'Escribí el nombre y apellido de la persona.',
    'Tocá Generar QR. Aparece un código para ese invitado.',
    'Mostralo en portería el mismo día (o que el invitado lo muestre en su celular).',
    'Si te equivocaste, podés anular el pase.',
  ]);
  m.bullets([
    'Tope: 3 invitados activos por día y por socio.',
    'Vence a medianoche: al día siguiente hay que generar otro.',
    'El invitado muestra su propio QR; no usa el del socio.',
    'Si el socio anfitrión está suspendido o en mora (en temporada), el invitado no entra.',
  ]);
  m.p('Aparte de este pase, la pileta tiene su propio cupo de invitados por socio y un canon por invitado. Eso lo fija y cobra la pileta (capítulo 11).');

  /* ------------------------------------------------------------------ 7 */
  m.h1('7.  Mi Cuenta: cuota, pagos y recibos', { n: '07' });
  m.p('Mi Cuenta (“Estado contable”) muestra lo que el club tiene registrado como tu situación. Ese número es el mismo que ve Caja cuando cobra. Si el club apagó la vista de cuentas corrientes para socios, la pantalla te indica que consultes en administración.');
  m.h2('Qué muestra');
  m.table(
    ['Recuadro', 'Qué dice'],
    [
      ['Situación actual', '“Al día” con el próximo cobro y su monto; o el atraso en meses y el saldo, con la fecha en que venció'],
      ['Total abonado', 'Suma de lo pagado y cantidad de pagos registrados'],
      ['Último pago', 'Fecha, importe y medio. Si estás atrasado, repite que la cuota vence el 10 de cada mes'],
      ['Pagar cuota pendiente / anticipada', 'Los botones de pago. Si estás al día, podés adelantar la cuota del mes siguiente'],
      ['Historial de pagos', 'Cada pago con su recibo en PDF para descargar'],
    ],
    [46, 132]
  );
  m.h2('Cómo pagar');
  m.bullets([
    'Pagar ahora (Mercado Pago): se genera un código en la misma pantalla. Lo escaneás o abrís Mercado Pago con el botón Abrir pago. Regulariza el total en un solo cobro y se acredita cuando Mercado Pago confirma.',
    'Débito cada mes: te adherís una vez y Mercado Pago cobra la cuota del mes el día de vencimiento. La deuda anterior no entra en el débito: se paga aparte con Pagar ahora. Figurás como adherido recién cuando Mercado Pago lo confirma.',
    'Transferencia al club: usá el CBU o el alias que muestra la pantalla, adjuntá el comprobante (JPG, PNG o PDF) y tocá Enviar comprobante. Administración lo recibe como aviso y lo imputa a tu cuenta.',
    'En caja: también podés pagar en efectivo, transferencia o Mercado Pago (QR) con el personal de caja. Pedí siempre el comprobante.',
  ]);
  m.p('Si estás en mora, la pantalla separa el monto en cuota + recargo y te muestra el total a abonar. Si ya pagaste, el pago aparece en tu historial con fecha, importe y concepto.');
  m.h2('Cuándo no aparecen los botones de pago');
  m.bullets([
    'Sos vitalicio, fundador o comisión: no abonás cuota.',
    'Sos adherente: la cuenta la paga el titular.',
    'El estado de tu cuota todavía se está confirmando (la pantalla lo avisa).',
  ]);
  m.h2('No mezcles números');
  m.p('En Contabilidad hay reportes que dicen “Corte LILA”. Son fotos de un Excel de un día puntual (por ejemplo, fin de un mes). No son tu saldo de hoy. Si un número de un reporte no coincide con Mi Cuenta, prevalece lo que dice tu ficha y lo que te confirme Caja.');
  m.box('tip', 'Regla de oro', 'Tu saldo real es el de tu ficha de socio. Los reportes mensuales, cajas históricas y liquidaciones son copias de un momento, útiles para tesorería, no para discutir un peso de ayer contra hoy.');

  /* ------------------------------------------------------------------ 8 */
  m.h1('8.  Reglas de la cuota social', { n: '08' });
  m.p('Estas reglas valen para todo el padrón y las aplica el sistema solo. Conviene que las conozca todo el que cobra, atiende o explica una cuota.');
  m.table(
    ['Tema', 'Regla'],
    [
      ['Vencimiento', 'La cuota social vence el día 10 de cada mes. El día se fija en Sistema > Configuración.'],
      ['Mora', 'Desde el día siguiente al vencimiento (el 11) el socio está en mora.'],
      ['Recargo', '10 % sobre la cuota, desde el día siguiente al vencimiento. Solo en socio familiar y socio individual.'],
      ['AMET', 'Socio familiar (AMET) y socio individual (AMET) vencen el 18, su mora empieza el 19 y no llevan recargo. Su cuota es la base menos 2,5 %; ese 2,5 % es tarifa, no mora.'],
      ['Exentos', 'Vitalicio, fundador y comisión no abonan cuota: sin mora, sin saldo, sin avisos, sin Mercado Pago y sin cobro en caja ni en el portal.'],
      ['Grupo familiar', 'Una sola cuota por grupo, la del titular. El adherente no tiene cuenta propia. Un abono de tenis de un integrante sí se suma a la cuenta del titular. La mora del titular alcanza al grupo: en temporada, el adherente no ingresa ni paga pileta.'],
      ['Un pago cubre el mes', 'El pago cubre el mes en que se hizo. Último pago en agosto: el próximo vencimiento es el 10 de septiembre.'],
      ['Descuentos', 'Los descuentos y bonificaciones se aplican sobre la cuota antes del recargo.'],
      ['Perdonar el recargo', 'Lo pueden hacer, al cobrar, Tesorería (cargo de Tesorero), el contador y el superadministrador. Se cobra solo la cuota y queda anotado el recargo perdonado.'],
    ],
    [38, 140]
  );
  m.h2('Avisos de vencimiento y de mora');
  m.p('El sistema manda avisos reales, una vez por etapa y por socio, por mensaje interno y por mail. Cada aviso trae el link a Mi Cuenta (www.jockeyclubsj.com.ar/cuenta) y las consecuencias de la mora.');
  m.table(
    ['Etapa', 'Cuándo (casi todos)', 'Cuándo (AMET)', 'Qué dice'],
    [
      ['Por vencer', 'Desde el 5', 'Desde el 13', 'La cuota está por vencer y qué pasa si entra en mora'],
      ['Vence hoy', 'El 10', 'El 18', 'Hoy vence; sin recargo si se abona hoy'],
      ['Mora', 'Desde el 11', 'Desde el 19', 'Ya está en mora'],
    ],
    [28, 40, 34, 76]
  );
  m.bullets([
    'Solo reciben aviso los socios que deben. Los exentos nunca, ni tampoco quien apagó el aviso en su ficha.',
    'Consecuencias que dicen los avisos: recargo del 10 % (familiar e individual), no se ingresa al club hasta regularizar y no se puede pagar la pileta hasta estar al día.',
    'La regla de avisos queda guardada en el libro y se ve en Sistema > Configuración.',
  ]);
  m.box('warn', 'Ojo con la puerta', 'La puerta cierra por mora solo en temporada de pileta (diciembre a marzo) y mientras la opción “Mora desde el 10 bloquea el ingreso” esté prendida en Configuración. Fuera de temporada, un socio con deuda pasa y portería solo lo invita a regularizar.');

  /* ------------------------------------------------------------------ 9 */
  m.h1('9.  Mensajes, reclamos, novedades y encuestas', { n: '09' });
  m.h2('Mensajes');
  m.p('En Mensajes (o en el cuadro de Inicio) ves la bandeja del club: Bandeja, Enviados y Redactar. Ahí llegan los avisos de cuota, los recibos de tus pagos en PDF, los comunicados y las respuestas a tus reclamos. Abrilos y marcalos como leídos. Si pagás por transferencia, el aviso con tu comprobante le llega a administración como un mensaje.');
  m.h2('Reclamos');
  m.p('Si hay algo roto, un problema de mantenimiento o una queja, desde Inicio tocá Enviar Reclamo: tipo, título y descripción. Administración lo asigna y te responde por el mismo canal. Tus pedidos y reclamos quedan listados en Inicio.');
  m.h2('Novedades');
  m.p('Es el mural de noticias del club: deportes, fiestas, obras, institucional. Solo se publican las notas que Secretaría o Comunicación cargaron. No es una red social: no hay comentarios públicos.');
  m.h2('Encuestas');
  m.p('Cuando hay una encuesta activa, votás una sola vez. El resultado lo ve el club para decidir (horarios, actividades, etc.).');

  /* ----------------------------------------------------------------- 10 */
  m.h1('10.  Portería y personal de sede', { n: '10' });
  m.p('Si tu rol es Personal, Operador de portería, Cajero, Administrador o Superadministrador, podés abrir Acceso QR (también desde Operación en el panel). Esa pantalla es el molinete de la sede. No es la entrada de la pileta (capítulo 11).');
  m.h2('Rutina recomendada');
  m.steps([
    'Entrá con tu usuario de personal (no el de un socio).',
    'Andá a Acceso QR. Permití la cámara cuando el navegador lo pida. En celulares hace falta HTTPS (el enlace seguro del club).',
    'Pedile al socio que abra su tarjeta en la app, a pantalla completa.',
    'Si la cámara falla: usá “Leer QR desde foto” o escribí DNI, apellido, número de socio o código JCSJ en “Código manual” y tocá Leer.',
    'Mirá el resultado grande: autorizado, con deuda, denegado, invitado o QR inválido. No hace falta esperar a que se vaya el cartel: la credencial siguiente lo reemplaza al instante.',
    'Si aparece un aviso amarillo “Ya ingresó hace N min”, esa misma credencial entró hace poco. Puede haber salido y vuelto, pero también puede ser un QR prestado: mirá que la persona sea el socio. El aviso no bloquea; decidís vos.',
    'Si dice QR no válido o no firmado: pedí que abra la app, o cargá el número a mano.',
    'Si dice NO SE PUDO VERIFICAR (cartel amarillo): se cortó la conexión. No es un rechazo: buscá al socio por DNI o número y dejalo pasar a mano. Queda anotado como “Sin verificar”.',
  ]);
  m.p('La pantalla de la tablet no se apaga mientras Acceso QR está abierto. Si se corta internet, las lecturas se guardan en la tablet y se envían solas cuando vuelve la conexión. Cada lectura guarda también quién la hizo.');
  m.h2('Qué hacer en cada caso');
  m.table(
    ['Pantalla', 'Significa', 'Qué hacer'],
    [
      ['ACCESO AUTORIZADO', 'Socio activo, sin deuda', 'Dejar pasar'],
      ['ACCESO CON DEUDA', 'Socio activo con saldo, sin bloqueo por mora', 'Dejar pasar e invitar a regularizar en Caja'],
      ['ACCESO DENEGADO · MORA', 'En temporada de pileta, desde el 10, sin cuota del mes (o el titular del grupo, si es adherente)', 'No dejar pasar; que regularice en Caja o en Mi Cuenta'],
      ['NO SE PUDO VERIFICAR', 'Sin conexión: no se pudo comprobar la firma del QR', 'No es un rechazo: buscar al socio por DNI o número y dejarlo pasar a mano'],
      ['ACCESO DENEGADO', 'Cuenta suspendida u otro bloqueo', 'No dejar pasar; derivar a Administración'],
      ['INVITADO AUTORIZADO', 'Pase del día válido', 'Dejar pasar al invitado'],
      ['ANFITRIÓN EN MORA', 'El pase es del día, pero el socio anfitrión está bloqueado por mora (en temporada)', 'No dejar pasar al invitado; que el socio regularice'],
      ['PASE INVÁLIDO', 'Vencido, anulado, falso, o anfitrión suspendido', 'No dejar pasar'],
      ['QR no válido / adulterado', 'Código viejo o inventado', 'Pedir app nueva o número a mano'],
      ['Socio no encontrado', 'El número no está en el padrón', 'No improvisar: avisar a Secretaría'],
    ],
    [48, 62, 68]
  );
  m.box('ok', 'Deuda no es rechazo', 'La deuda se informa pero no cierra la puerta, salvo en temporada de pileta desde el día 10. Suspendido siempre cierra la puerta. No discutas el monto en el molinete: eso es de Caja.');
  m.h2('Ingresos (historial)');
  m.p('En el panel, Operación > Ingresos es el libro de la puerta: las lecturas del día (quién pasó, a qué hora, quién la leyó, si fue invitado, con deuda o denegado y por qué). Sirve si hay una duda o un incidente. Ingresos solo lee lo que ya pasó; no escanea.');

  /* ----------------------------------------------------------------- 11 */
  m.h1('11.  Pileta', { n: '11' });
  m.p('La pileta tiene dos pantallas, distintas de la puerta de la sede: Entrada pileta (la puerta de la pileta) y Pileta (la caja del día y el canon). La temporada oficial va de diciembre a marzo; los montos y las reglas se editan en Sistema > Configuración > Pileta.');
  m.h2('Abrir el día');
  m.steps([
    'Entrá a Pileta y tocá Abrir caja del día. La caja de pileta se abre una vez por día; sin caja abierta no se habilita el ingreso ni se cobra.',
    'Buscá al socio. La ficha dice si puede pagar pileta (“Puede pagar pileta” o “No puede pagar pileta”) y por qué.',
    'Controlá el apto médico. Vale la cantidad de días que fije Configuración (hoy 365). El socio puede subirlo desde su Perfil si el club lo permite; si no, lo carga Administración.',
    'Cobrá el canon en efectivo o con Mercado Pago (QR en el lugar).',
    'Habilitá el ingreso de hoy.',
  ]);
  m.h2('Invitados de pileta');
  m.p('Cada socio puede llevar invitados hasta el tope configurado (hoy 3 por día), con un canon por invitado. Cargá el nombre del invitado después de habilitar al socio anfitrión.');
  m.h2('Quién no puede pagar pileta');
  m.bullets([
    'Un socio en mora: desde el día 10 sin la cuota del mes, o con saldo, hasta regularizar. Vale aunque no sea temporada.',
    'Cuenta suspendida, dada de baja o no habilitada.',
    'Vitalicio, fundador y comisión no tienen cuota, así que nunca quedan en mora por este motivo.',
  ]);
  m.box('warn', 'Dos cajas distintas', 'La caja de pileta no se mezcla con Tesorería. No arquees pileta desde Contabilidad ni uses esta pantalla como molinete de la sede. Si falta el apto y portería no está autorizada a pasar sin él, no se inventa el pase.');

  /* ----------------------------------------------------------------- 12 */
  m.h1('12.  Caja y cobranzas', { n: '12' });
  m.p('Cajeros, portería con caja y tesorería usan el panel. Lo más usado: Socios, Saldos (o Cuotas) y Caja.');
  m.h2('Cobrarle la cuota a un socio');
  m.steps([
    'Abrí Socios. Buscá por nombre, número, DNI, mail o teléfono.',
    'Entrá a la ficha (Ver perfil). El saldo y el vencimiento están en la cabecera.',
    'Tocá Cobrar. El cobro muestra tres recuadros: Cuota, Recargo y Total. El recargo aparece solo si pasó el vencimiento y la categoría lo lleva.',
    'Elegí el medio: Efectivo, Transferencia o Mercado Pago (QR). En transferencia el comprobante es obligatorio y se elige el banco del club.',
    'Confirmá. El saldo de la ficha se actualiza, queda el asiento en caja y el recibo en PDF le llega al socio por mensaje interno.',
  ]);
  m.h2('Perdonar el recargo');
  m.p('Tesorería (cargo de Tesorero), el contador y el superadministrador ven una casilla “Perdonar recargo. Tesorería cobra solo la cuota”. Si la tildan, el total baja a la cuota y el recargo perdonado queda anotado en el cobro. Para los demás roles esa casilla no existe.');
  m.h2('Cobrarle a un adherente');
  m.p('La cuenta es del titular. Si abrís la ficha de un adherente y cobrás, el modal te avisa “El pago de [nombre] entra en la cuenta del titular” y el cobro impacta en el titular. Si el titular no está en el padrón, el sistema no deja cobrar.');
  m.h2('Anular un cobro mal cargado');
  m.steps([
    'En la ficha del socio, abrí Movimientos.',
    'Buscá el cobro y tocá Anular. Confirmá el aviso.',
    'El cobro queda tachado con la marca “Anulado” y quién lo anuló. No se borra: queda el rastro.',
    'Vuelven el saldo, el último pago y el próximo vencimiento que había antes, y se genera el contraasiento en caja.',
    'Cobrá de nuevo con el importe y el medio correctos.',
  ]);
  m.box('warn', 'No inventes datos', 'El padrón de la lista es liviano a propósito (para que cargue rápido). La ficha completa se pide al abrir el socio. No borres domicilio ni datos médicos: si no los ves en la lista, es normal; están en el perfil. Y a un vitalicio, fundador o comisión no se les cobra cuota: la ficha no lo permite.');
  m.h2('Caja del día');
  m.p('En Contabilidad > Operación > Tesorería > Cajas (o el atajo Caja si tu rol es cajero) registrás movimientos de efectivo y bancos. Ojo: en los reportes LILA, “Ingresos en caja” de un período no es el dinero que hay ahora en el cajón. Es lo que entró en ese recorte de fechas.');

  /* ----------------------------------------------------------------- 13 */
  m.h1('13.  Cuotas, saldos y liquidación', { n: '13' });
  m.p('La pestaña se llama Cuotas si tu perfil liquida (contador y superadministrador) y Saldos si no. Es la vista viva de la cuota social sobre el padrón: el 10 vence sin recargo, desde el 11 está en mora, con recargo del 10 % en familiar e individual. AMET vence el 18.');
  m.h2('Qué podés hacer');
  m.bullets([
    'Consultar: Saldos, cuentas corrientes detalladas, Créditos y Deudas mes a mes.',
    'Control de mora: quién venció, cuántos meses debe y cuánto. Desde ahí se manda el WhatsApp de vencimiento con el teléfono de la ficha.',
    'Cobrar: usa el mismo cobro de la ficha, con Cuota, Recargo, Total y Perdonar recargo para Tesorería.',
    'Importar cobranzas (Excel) e Imputar eventos (por ejemplo, una cena del club) a la cuenta del socio.',
    'Excel y PDF del período salen de esta misma pantalla.',
  ]);
  m.h2('En Inicio: el recaudado del mes');
  m.p('Arriba de Inicio está la franja del vencimiento (“Hoy vencen las cuotas”, “Vencieron el 10”, con los días que faltan o pasaron). Recaudado del mes es solo la cuota del mes sobre lo liquidado, con el porcentaje de cobrabilidad y lo que falta. Aparte, en líneas chicas, van las atrasadas cobradas, los recargos y las reservas, que no suman a esa cobrabilidad.');
  m.h2('Liquidar el mes (contador y superadministrador)');
  m.steps([
    'Entrá a Cuotas. El borrador del mes siguiente se arma durante el mes en curso.',
    'Revisá cantidad de socios y monto unitario por categoría. Si hace falta, Editar y guardá.',
    'Liquidá recién en el mes en curso. El período cerrado no se vuelve a abrir.',
    'La liquidación cobra una sola cuota por grupo familiar, la del titular, más los abonos de tenis de los integrantes. Vitalicio, fundador y comisión quedan en cero.',
    'Bajá el Excel y el PDF del período.',
  ]);
  m.box('tip', 'Quién liquida cada mes', 'Hasta octubre de 2026 la liquidación fue la de LILA. Desde noviembre liquida esta app, siempre el mes en curso. No re-liquides un mes para cobrarle a un solo socio: cobrá desde su ficha.');

  /* ----------------------------------------------------------------- 14 */
  m.h1('14.  Contabilidad (tesorería)', { n: '14' });
  m.p('Esta parte es para Contador y Superadministrador. Cajero y Portería ven solamente Cajas y Otros ingresos. El Administrador operativo no entra a Contabilidad: así se separa la gestión del club de los números patrimoniales.');
  m.h2('Tres mundos que no se suman entre sí');
  m.bullets([
    'Saldo del socio: la ficha viva, lo que se cobra hoy.',
    'Cortes LILA (balance mensual, cuenta corriente, liquidación, créditos): planillas importadas de un día anterior al empalme del 1 de octubre de 2026. El sistema las muestra con la leyenda “Corte LILA” y la fecha. No pisan el saldo del socio.',
    'Libro vivo del club: cuotas, caja y cobros de hoy. El Diario, el Mayor y el asiento legal lo usan, y también Informes, Tesorería e Impuestos.',
  ]);
  m.h2('Dónde está cada cosa');
  m.table(
    ['Grupo', 'Pantallas', 'Para qué sirve'],
    [
      ['Libros', 'Libro Diario, Libro Mayor, Crear asiento legal', 'Contabilidad de partida doble del club'],
      ['Informes', 'Balance (mensual, resumido, cuenta corriente, patrimonial), Estado de resultados, Reportes y gráficos, Reportes', 'Resultados y balances'],
      ['Padrón', 'Libre deuda, Grupo familiar, Descuentos extras, Bonificaciones, SIAP, Impuestos', 'Certificados, saldos por familia, descuentos e impuestos del mes'],
      ['Operación (Tesorería)', 'Cajas, Gastos, Proveedores, Retenciones, Otros ingresos, Intereses, Sin identificar, Galicia, Gastos fijos, Saldos, Órdenes, Créditos socios', 'Efectivo, bancos, cobranzas, egresos y cuentas a pagar'],
      ['Catálogo', 'Plan de cuentas', 'Las cuentas contables'],
    ],
    [32, 86, 60]
  );
  m.h2('Operaciones frecuentes');
  m.bullets([
    'Gastos: se pide, se aprueba y al pagar baja caja o banco. Los gastos fijos son los recurrentes: no los cargues dos veces como gasto suelto.',
    'Proveedores: la cuenta corriente es el saldo de apertura más entradas y pagos. Positivo es deuda del club.',
    'Retenciones: se registran sobre la orden de pago y entran en Impuestos del mes.',
    'Galicia: débitos automáticos. Sin identificar: cobranzas sin socio, que hay que imputar.',
    'Libre deuda: emite el certificado del socio. La ficha familiar se edita en Socios, no acá.',
    'Un cobro de socio habitual se carga en la ficha o en Saldos, no como asiento suelto.',
  ]);
  m.box('tip', 'Si los totales no cierran', 'Es esperable que el mensual LILA, la caja de otro corte y la liquidación den números distintos: son fotos de días distintos. No los “ajustes” entre sí a mano. Anotá la fecha de cada reporte.');

  /* ----------------------------------------------------------------- 15 */
  m.h1('15.  Administración del club', { n: '15' });
  m.p('El Administrador opera el club día a día, sin contabilidad. El menú del panel se agrupa así:');
  m.bullets([
    'Operación: Socios, Cuotas o Saldos, Reservas, Ingresos, Acceso QR, Entrada pileta, Pileta.',
    'Club: Disciplinas y Fiestas.',
    'Gestión: Concesiones, Contabilidad o Caja (según el rol) y Reportes.',
    'Comunicación: Novedades, Encuestas, Alertas, Reclamos y Mensajería.',
    'Administración: Personal, Profesores y Usuarios y altas.',
    'Sistema: Configuración y Migración.',
  ]);
  m.h2('Padrón de socios');
  m.p('Buscá por número, DNI, apellido, mail o teléfono, filtrá por categoría y abrí la ficha. La ficha tiene secciones: Ficha, Editar, Tarjeta, Invitados, Documentos, Grupo familiar, Movimientos, Entradas, Asistencia, Reclamos, Mensajes y Trazabilidad. Desde ahí editás, cobrás, anulás un cobro, emitís la credencial o suspendés. La cabecera dice si la cuenta está habilitada, pendiente, suspendida o dada de baja, y si el socio puede pagar pileta. El padrón carga de a poco (miles de socios): esperá a que termine si no aparece alguien. PDF y Excel del padrón salen de la barra de Socios.');
  m.h2('Reservas (vista del club)');
  m.p('A diferencia del socio, acá sí ves nombres, importes y podés anular o reactivar. Los espacios (salones, canchas, pileta) y sus reglas (anticipación, invitados, categorías, confirmación) se editan en la misma pantalla. Las fiestas no van acá: son eventos con inscripción en Club > Fiestas.');
  m.h2('Disciplinas, profesores y asistencia');
  m.p('Las disciplinas (tenis, pádel, rugby, etc.) son el catálogo de deportes e instalaciones. El Administrador da de alta al profesor en Administración > Profesores, con su disciplina y su clave. El profesor entra a Asistencia (no al panel), marca presentes y el sistema le dice si cada alumno tiene la cuota al día.');
  m.h2('Fiestas');
  m.p('Club > Fiestas: se carga el evento, el cupo y la inscripción. La imputación a la cuenta del socio se hace desde Cuotas > Imputar eventos.');
  m.h2('Concesiones');
  m.p('Bares y servicios del predio: contrato, vigencia, canon, documentos y cierre. El vencimiento de un contrato aparece en Alertas. Hay un portal aparte para el concesionario, con un código, sin ver el resto del club.');
  m.h2('Comunicación');
  m.bullets([
    'Novedades: se publican con foto de portada; el socio las ve en Novedades.',
    'Alertas: Zonda, vencimientos y concesiones. Lo vivo se acusa en Inicio. Declarar Zonda está al pie de Sistema > Configuración; no lo dejes declarado cuando ya pasó el viento.',
    'Reclamos: abiertos y pendientes; también se ven desde la ficha del socio.',
    'Encuestas: consultas al padrón.',
    'Mensajería: Mail (bandeja de Recibidos y Enviados de socios@jockeyclubsj.com.ar), MD (la bandeja interna) y WhatsApp (cobranza con plantilla).',
  ]);
  m.p('Para un comunicado elegís a un socio o a todos y si va por mensaje interno, por mail o por los dos. La IA puede redactar el texto, pero revisalo antes de enviar: un comunicado a todos llega a todo el padrón.');
  m.h2('Personal y RR.HH.');
  m.p('Legajos, bitácora, faltas, permisos y documentación del staff. Recursos humanos ve sobre todo esta zona; no necesita el padrón completo.');
  m.h2('Reportes y resguardo');
  m.p('Podés bajar un informe ejecutivo en PDF, los padrones y copias de seguridad. El resguardo automático no guarda domicilios ni historial de pagos completo: es a propósito, para no acumular datos sensibles en la computadora. El resguardo no reemplaza a Migración, que son los cortes de LILA.');

  /* ----------------------------------------------------------------- 16 */
  m.h1('16.  Jev, el asistente del panel', { n: '16' });
  m.p('Jev está en el menú IA del panel, para el personal con sesión. Lee el club entero (cuotas, portería, reservas, pileta, reclamos) y te dice qué falta o adónde ir. No escribe en el libro: no cobra, no liquida, no publica.');
  m.h2('Qué dudas resuelve');
  m.bullets([
    'Cómo se hace algo: “¿cómo cobro a un socio?”, “¿cómo anulo un cobro?”, “¿cómo liquido el mes?”. Contesta con los pasos del manual y te lleva a la sección.',
    'Por qué algo no anda: “¿por qué no lo deja pasar?”, “¿por qué no puede pagar pileta?”, “¿por qué no veo Contabilidad?”, “¿por qué no coinciden los números?”.',
    'Qué significa una palabra o una regla: “¿qué es AMET?”, “¿cuándo empieza el recargo?”, “¿qué es el empalme?”.',
    'Un socio en particular: escribí su número, su DNI o su nombre y apellido. Jev explica su caso con las mismas reglas que usa la caja y la puerta: categoría, titular o adherente, mora y recargo, si entra hoy y si puede pagar pileta. Podés repreguntar sobre el mismo socio.',
  ]);
  m.p('Si el manual no cubre la duda, Jev lo dice y te manda a Secretaría o al superadministrador: no inventa pantallas, botones ni montos.');
  m.table(
    ['Sala', 'Para qué sirve'],
    [
      ['Consulta', 'Escribí un número de socio, el mes, o cómo se hace algo. Los atajos “El mes”, “Qué conviene”, “La puerta” y “Enseñame” hacen la pregunta por vos'],
      ['Revisión', 'El padrón “sucio”: lo que falta, lo que se repite y lo que no cierra. Se baja a Excel'],
      ['Predicciones', 'Proyecta el cierre del día 10 y la pileta'],
      ['Manual', 'El paso escrito de cada oficio, con captura de pantalla y un botón “Ir a esa sección”'],
    ],
    [34, 144]
  );
  m.box('tip', 'Cuándo usar el Manual', 'Si no sabés cómo se hace algo (cobrar, liquidar, dejar pasar, cobrar pileta), escribilo en el buscador del Manual: “cobrar”, “liquidar”, “qr”, “pileta”, “caja”, “alta”. Cada oficio dice quién lo hace, los pasos y qué no hay que hacer.');

  /* ----------------------------------------------------------------- 17 */
  m.h1('17.  Configuración y Mercado Pago', { n: '17' });
  m.p('Sistema > Configuración reúne las reglas del club. Todo se guarda en el libro. Se maneja con el Superadministrador.');
  m.h2('Qué se configura');
  m.table(
    ['Bloque', 'Campos'],
    [
      ['Sede', 'Nombre, domicilio, CUIT, teléfono y correo. Sale en el pie del portal'],
      ['Cuotas', 'Vence el día (1 al 28; hoy el 10), tolerancia de pago, gracia de la credencial, deuda máxima, cuenta protegida hasta una fecha, y si los socios ven su cuenta corriente'],
      ['Regla de avisos', 'Por vencer, vence y mora, con sus consecuencias. Es fija y queda en el libro'],
      ['Pileta', 'Canon de socio e invitado, apto médico (días), invitados por socio, nombre de la temporada, si el socio carga el apto y “Mora desde el 10 bloquea el ingreso”'],
      ['Mercado Pago', 'Cobros habilitados, Caja QR'],
      ['Reglas del club', 'Tutores por grupo, recordatorio, portería autoriza pileta, titular en comunicaciones, boleto de pago, avisos de pago con aprobación, débito familiar, teléfonos útiles, motivos y categorías de gasto'],
      ['Zonda', 'Se declara al pie de la pantalla'],
    ],
    [36, 142]
  );
  m.h2('Mercado Pago');
  m.p('Tiene tres usos: cobro online en Mi Cuenta, QR en el lugar (caja y pileta) y suscripción mensual. Se prende con Cobros habilitados; si está en No, no se abre ni el cobro online, ni el QR, ni la adhesión. El access token no se guarda en esta pantalla: va en las secretas de Supabase (MP_ACCESS_TOKEN), de la cuenta del club.');
  m.bullets([
    'Cuando Mercado Pago aprueba un pago, el cobro se imputa solo en la cuenta del socio y se le manda el boleto por mensaje y por mail.',
    'La suscripción cobra la cuota del mes el día de vencimiento. La deuda atrasada se paga aparte.',
    'Vitalicio, fundador y comisión no pueden pagar ni adherirse a Mercado Pago por cuota.',
    'Los links de vuelta y de los avisos siempre apuntan a www.jockeyclubsj.com.ar/cuenta.',
  ]);
  m.box('warn', 'Cuidado', 'No apagues Cobros habilitados con socios pagando: se cae el cobro de todos. Y si un QR ya quedó aprobado, el cobro está imputado: no lo cargues también a mano.');

  /* ----------------------------------------------------------------- 18 */
  m.h1('18.  Superadministrador: usuarios y altas', { n: '18' });
  m.p('Es el único rol que ve todo, incluida la contabilidad, y el único que crea y edita perfiles de usuario. Con ese poder viene la responsabilidad: no se comparte la clave, no se usa en un café público y no se le asigna el rol a alguien “por las dudas”.');
  m.h2('Usuarios y altas');
  m.steps([
    'Entrá a Administración > Usuarios y altas.',
    'Crear el usuario con el correo real de la persona.',
    'Asignar el rol correcto (socio, caja, personal, etc.). Se pueden sumar varios y los permisos se suman. Nadie elige su propio rol al registrarse.',
    'Vincular, si corresponde, el número de socio del padrón.',
    'Si es profesor, marcar las disciplinas.',
    'Cuando la persona deja el club o el puesto, revocar el acceso; no alcanza con “esconder” el mail.',
  ]);
  m.h2('Pedidos que llegan desde /registro');
  m.p('Las solicitudes de “Quiero asociarme” y los pedidos de “Ya soy socio” (usuario o recuperar clave) se ven en Usuarios y altas y en Inicio. Secretaría verifica la ficha, da el alta o contacta al socio. Si el mail con el acceso no sale, se le pasa la contraseña por WhatsApp.');
  m.h2('Cargos del club');
  m.p('Además del rol de sistema una persona puede tener un cargo: Presidente, Vicepresidente, Secretario, Tesorero, Vocal. Los cargos no cambian las pantallas que ve, pero el de Tesorero habilita a perdonar el recargo de la cuota al cobrar.');
  m.box('warn', 'Seguridad', 'El sistema no toma el rol desde un dato que el usuario pueda inventar. Solo un superadministrador (o el proceso interno de alta) puede dar roles de personal o administración. Un administrador puede ver la lista de usuarios, pero no crear ni editar perfiles.');

  /* ----------------------------------------------------------------- 19 */
  m.h1('19.  Si algo no funciona', { n: '19' });
  m.table(
    ['Qué ves', 'Qué suele ser', 'Qué probar'],
    [
      ['“Verificando credenciales…” eterno', 'Internet o sesión colgada', 'Recargar. Si sigue, Salir e ingresar de nuevo'],
      ['No carga tu ficha de socio', 'El usuario no está vinculado al padrón', 'Administración debe pegar tu número de socio al perfil'],
      ['No tenés usuario o olvidaste la clave', 'Falta el alta o la recuperación', 'En el ingreso, “Ya soy socio…”. Secretaría te contacta'],
      ['Padrón en 0 y “actualizando”', 'Está bajando los socios', 'Esperar; son miles de fichas'],
      ['La cámara del QR no inicia', 'El navegador bloqueó el permiso o no hay HTTPS', 'Permitir cámara, usar el enlace seguro, o código manual'],
      ['QR rechazado', 'Credencial sin firma, QR cortado o que no es del club', 'Abrir la app de nuevo o tipear el número'],
      ['NO SE PUDO VERIFICAR', 'Se cortó internet y no se puede comprobar la firma', 'Buscar al socio por DNI o número; al volver la conexión todo se sincroniza solo'],
      ['“Ya ingresó hace N min”', 'La misma credencial entró hace poco', 'Mirar que la persona sea el socio. Puede haber salido y vuelto'],
      ['ACCESO DENEGADO · MORA', 'Temporada de pileta, cuota del mes sin pagar desde el 10', 'Pagar en Mi Cuenta o en Caja; al acreditarse, vuelve a pasar'],
      ['“No puede pagar pileta”', 'Mora desde el 10 o saldo pendiente', 'Regularizar la cuota'],
      ['“Las reservas las hace el titular”', 'Sos adherente', 'Que reserve el titular de la cuenta'],
      ['Mi Cuenta sin botones de pago', 'Categoría exenta, adherente, o estado todavía confirmándose', 'Esperar unos segundos. Si sos vitalicio, fundador o comisión, es lo normal'],
      ['Mercado Pago no acredita', 'Mercado Pago todavía no confirmó', 'Esperar la confirmación; no pagar dos veces. Avisar a Caja con el comprobante'],
      ['Cobro mal cargado', 'Importe o medio equivocado', 'Anular desde Movimientos de la ficha y cobrar de nuevo'],
      ['No ves Contabilidad', 'Tu rol es Administrador u otro operativo', 'Normal. Tesorería entra con usuario de contador'],
      ['Números distintos en reportes', 'Cortes LILA de distintas fechas', 'Mirar la fecha del corte; el saldo vivo está en la ficha'],
      ['No podés reservar exterior', 'Alerta Zonda', 'Elegir un espacio cubierto o esperar el aviso'],
    ],
    [50, 56, 72]
  );

  /* ----------------------------------------------------------------- 20 */
  m.h1('20.  Palabras que vas a ver', { n: '20' });
  m.table(
    ['Palabra', 'En criollo'],
    [
      ['Padrón', 'La lista oficial de socios'],
      ['Ficha', 'La pantalla completa de una persona'],
      ['Titular / adherente', 'El titular lleva la cuenta del grupo; el adherente es el familiar a su cargo'],
      ['Categoría / cuota', 'El tipo de socio (familiar, individual, AMET, vitalicio…)'],
      ['AMET', 'Categoría con vencimiento el 18 y tarifa con 2,5 % menos; no lleva recargo'],
      ['Exento', 'Vitalicio, fundador o comisión: no abona cuota social'],
      ['Mora', 'Cuota vencida y sin pagar: desde el día siguiente al vencimiento'],
      ['Recargo', '10 % sobre la cuota en mora, solo familiar e individual; tesorería puede perdonarlo'],
      ['Saldo operativo', 'Lo que debés o tenés al día, ahora'],
      ['Imputar', 'Asignar un cobro o un evento a la cuenta de un socio'],
      ['Liquidar', 'Cerrar el período y generar las cuotas del mes (contador y superadmin)'],
      ['Corte LILA', 'Una foto de un Excel de un día anterior al 1 de octubre de 2026, no el ahora'],
      ['Empalme', 'La fecha en que el portal pasó a ser el libro vivo: 1 de octubre de 2026'],
      ['QR firmado', 'Código de la app que no se puede inventar con el número'],
      ['Molinete / Acceso QR', 'La pantalla para entrar a la sede'],
      ['Apto', 'Revisación médica para usar la pileta'],
      ['Jev', 'El asistente del panel para el personal'],
      ['Rol', 'El permiso de tu usuario (socio, caja, admin…)'],
      ['Panel', 'La oficina digital del personal'],
      ['Asiento', 'Una registración contable (debe y haber)'],
      ['Zonda', 'Viento fuerte: se cierran las canchas al aire libre'],
    ],
    [46, 132]
  );

  /* ----------------------------------------------------------------- 21 */
  m.h1('21.  Buenas prácticas y mapa rápido', { n: '21' });
  m.h2('Buenas prácticas para todos');
  m.bullets([
    'Usá tu propio usuario. Nunca prestes la clave.',
    'En portería y caja, cerrá sesión al terminar el turno.',
    'No fotografíes el padrón ni lo mandes por WhatsApp.',
    'Si ves un dato mal (teléfono, categoría, familiar), avisá: se corrige en la ficha, no “en el Excel de alguien”.',
    'Cobrá siempre desde la ficha o desde Saldos, con el medio real y el comprobante.',
    'Ante la duda, preguntá en Secretaría. El sistema está para ayudar, no para reemplazar el criterio del club.',
  ]);
  m.box('ok', '¿Necesitás ayuda?', 'Socio: Secretaría. Personal de sede: tu responsable de turno. Caja y números: Tesorería. Usuarios que no entran: Superadministrador. Para saber cómo se hace una tarea en el panel: IA > Manual.');
  m.h2('Mapa rápido del portal');
  m.p('Direcciones que vas a ver en el navegador (no hace falta memorizarlas: el menú te lleva):');
  m.table(
    ['Ruta', 'Quién la usa', 'Qué hay'],
    [
      ['Inicio (/)', 'Socio', 'Credencial, resumen, invitados'],
      ['/reservas', 'Socio (titular)', 'Calendario de espacios'],
      ['/cuenta', 'Socio', 'Mi Cuenta: pagos, historial y recibos'],
      ['/perfil', 'Socio', 'Tu ficha y documentos'],
      ['/revista', 'Socio', 'Novedades'],
      ['/mensajes', 'Socio y personal', 'Mensajería interna'],
      ['/registro', 'Cualquiera', 'Quiero asociarme / Ya soy socio'],
      ['/asistencia', 'Profesor', 'Presentes y cuota de los alumnos'],
      ['/acceso', 'Portería y personal', 'Lector QR de la sede'],
      ['/entrada-pileta', 'Pileta', 'Puerta de la pileta'],
      ['/pileta', 'Pileta y caja', 'Caja del día y canon'],
      ['/panel/…', 'Personal y autoridades', 'Oficina del club'],
      ['/concesiones', 'Admin / contador', 'Contratos y canon'],
    ],
    [42, 52, 84]
  );
  m.p('Gracias por cuidar los datos de los socios y el predio. El portal funciona bien cuando cada uno usa su rol, cobra en Caja lo que corresponde y muestra en la puerta un QR de verdad, no una foto vieja.');

  /* ----------------------------------------------------------------- 22 */
  m.h1('22.  Qué cambió en esta edición', { n: '22' });
  m.p('Si leíste la edición 1.0 (septiembre de 2026), esto es lo nuevo:');
  m.table(
    ['Tema', 'Antes', 'Ahora'],
    [
      ['Vencimiento', 'Todas las cuotas el 10', 'El 10, y AMET el 18. La mora empieza el día siguiente'],
      ['Recargo', 'No se explicaba', '10 % en familiar e individual; Tesorería puede perdonarlo al cobrar'],
      ['Cobro', 'Un solo importe', 'Cuota, Recargo y Total; el cobro de un adherente entra en la cuenta del titular'],
      ['Errores de cobro', 'Sin forma de corregir', 'Anular desde Movimientos, con rastro y contraasiento'],
      ['Mercado Pago', 'No existía', 'Pagar ahora, Débito cada mes y QR en caja y pileta'],
      ['Exentos', 'Casos sueltos', 'Vitalicio, fundador y comisión: nunca cuota, aviso ni Mercado Pago'],
      ['Grupo familiar', 'Cada integrante sumaba cuota', 'Una cuota por grupo (titular); el adherente no paga ni reserva'],
      ['Avisos', 'Manuales', 'Mensaje y mail reales: por vencer, vence y mora'],
      ['Puerta y mora', 'La deuda nunca cerraba la puerta', 'En temporada de pileta, desde el 10 sin cuota, cierra; y en mora no se paga pileta. En un grupo, vale la mora del titular'],
      ['Lector de QR', 'Lento sin lector nativo; un corte de internet decía “QR adulterado”', 'Lee en una fracción de segundo; sin conexión dice NO SE PUDO VERIFICAR; la credencial siguiente reemplaza el cartel'],
      ['Credencial QR', 'QR más denso', 'Menos puntos: se lee más rápido y desde más lejos. Los QR viejos siguen valiendo'],
      ['Portería', 'Sin aviso de uso repetido', 'Aviso amarillo si la misma credencial entra dos veces en 20 minutos; cada lectura guarda quién la hizo'],
      ['Alta y clave', 'Solo por Secretaría', 'Pantalla pública /registro: Quiero asociarme y Ya soy socio'],
      ['Pileta', 'Sin capítulo', 'Caja del día, apto, invitados y canon con Mercado Pago'],
      ['Contabilidad', 'Cortes de LILA', 'Libro vivo del club: diario, mayor, informes, tesorería e impuestos'],
      ['Inicio', 'Número de cuotas', 'Recaudado del mes con cobrabilidad y atrasadas, recargos y reservas aparte'],
      ['Mensajería', 'Interna', 'Interna, mail (recibidos y enviados) y WhatsApp; comunicados con IA'],
      ['Jev', 'No existía', 'Consulta, Revisión, Predicciones y Manual con capturas'],
    ],
    [32, 54, 92]
  );
}
