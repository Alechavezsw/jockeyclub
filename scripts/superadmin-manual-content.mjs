/**
 * Contenido del Manual del Superadministrador (PDF).
 * Lo dibuja scripts/generate-superadmin-manual.mjs con la misma clase que el manual general.
 *
 * Para quién: quien tiene el rol Superadministrador (superadmin). Ve las 25 secciones del
 * panel y es el único que crea usuarios, da roles, cambia montos de categorías, carga
 * bonificaciones, reabre una liquidación, carga notas de crédito o débito y borra un
 * recargo cobrado (roles.js: canManageProfiles, canEditFeePackAmounts, canReopenFeePeriod,
 * canRemoveDuesSurcharge; supabase/migrations 20261103*).
 *
 * Reglas de redacción:
 * - El PDF usa Helvetica estándar: nada de flechas ni símbolos fuera de Latin-1.
 *   Los caminos de menú se escriben con " > ".
 * - Cada dato sale del código del portal (pantallas, botones y reglas). Si cambia una
 *   pantalla o un permiso, se cambia acá.
 */

export const CHAPTER_COUNT = 18;

export const SUPERADMIN_MANUAL_TEXTS = {
  chromeRight: 'Manual del Superadministrador',
  coverTitle: 'Superadministrador',
  coverSubtitle: 'Manual del control total del portal del club',
  coverBlurb: 'Cómo se maneja el sistema con el rol que lo ve todo y lo puede todo: usuarios y permisos, configuración, Mercado Pago, montos y bonificaciones, las correcciones de plata, contabilidad, débitos, migración y respaldos. Qué hace solo el superadministrador, paso a paso y con sus cuidados.',
  coverEdition: 'Versión 1.0',
  coverNote: 'Uso reservado  ·  No compartir claves',
  tocIntro: 'Este manual es para quien tiene el rol Superadministrador. Empezá por el capítulo 1: resume lo que solo vos podés hacer. Los capítulos 3 al 8 son el corazón del cargo (usuarios, permisos, configuración y las correcciones de plata). El 16 reúne las reglas de cuidado y el 17 dice qué hacer si algo no anda.',
};

export function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  /* ------------------------------------------------------------------ 1 */
  m.h1('1.  Antes de empezar', { n: '01' });
  m.p('El Superadministrador es el único rol que ve todo el panel (25 secciones) y el único que puede crear usuarios, dar roles, corregir una liquidación ya procesada o borrar un recargo ya cobrado. Es un cargo de confianza: casi todo lo que cambiás queda registrado con tu nombre y, en las correcciones de plata, con un motivo escrito.');
  m.h2('Lo que solo vos podés hacer');
  m.table(
    ['Tarea', 'Dónde', 'Capítulo'],
    [
      ['Crear y editar usuarios, darles roles y cargos, desactivarlos', 'Administración > Usuarios y altas', '3'],
      ['Cargar los planes de tarjeta', 'Sistema > Configuración', '5'],
      ['Cambiar los montos de las categorías de cuota antes de liquidar', 'Cuotas > Cuotas de [año] > Editar', '7'],
      ['Cargar descuentos y bonificaciones de socios (con motivo)', 'Gestión > Contabilidad > Padrón', '7'],
      ['Reabrir una liquidación, volverla a borrador o cargar una nota de crédito o débito', 'Cuotas > Cuotas de [año]', '8'],
      ['Borrar un recargo ya cobrado (con motivo)', 'Ficha del socio > Movimientos', '8'],
    ],
    [96, 62, 20]
  );
  m.h2('Lo que compartís con otros roles');
  m.bullets([
    'Contabilidad, Libros, Informes, Caja y Operación (tesorería): con el Contador.',
    'Editar fichas, dar altas, bajas y suspensiones: con el Administrador.',
    'Configuración y Migración: las ve también el Administrador, y la base le deja guardar los ajustes del club. Los planes de tarjeta, no.',
    'Anular un cobro: con caja, Tesorería y el Contador.',
  ]);
  m.box('warn', 'Poder no es costumbre', 'Para el trabajo diario del mostrador (cobrar, atender la puerta, responder reclamos) usá una persona con el rol que corresponde, no el superadministrador. Cuantas menos cosas se hagan con este usuario, más fácil es entender qué pasó cuando algo sale mal.');

  /* ------------------------------------------------------------------ 2 */
  m.h1('2.  Entrar, cuidar la cuenta y mapa del panel', { n: '02' });
  m.h2('Ingresar');
  m.steps([
    'Abrí el portal del club (www.jockeyclubsj.com.ar) en Chrome o Safari.',
    'Escribí tu correo y tu contraseña. Es tu usuario personal: no se presta ni se anota en un papel.',
    'Tocá Ingresar al portal.',
    'Si además sos socio o socia, el sistema te pide elegir la puerta: Portal de socio o Administración. Para trabajar elegí Administración.',
  ]);
  m.h2('Moverte');
  m.bullets([
    'El menú de la izquierda se agrupa en Operación, Club, Gestión, Comunicación, Administración y Sistema.',
    'El buscador de arriba (Ctrl + /) lleva directo a una sección o a un socio.',
    'Jev (menú IA) lee el club entero y contesta con Gemini. Tiene Consulta, Revisión, Predicciones y el Manual por oficio. Solo lee: no escribe en el libro.',
    'Entrada pileta, Acceso QR y Pileta son pantallas propias, sin menú. Para volver al panel usá el botón Panel.',
    'Al terminar, usá Salir, sobre todo en una computadora compartida.',
  ]);
  m.h2('El mapa del panel');
  m.table(
    ['Grupo', 'Secciones', 'Para qué'],
    [
      ['Inicio', 'Tablero del día', 'Vencimiento, agenda, alertas, recaudado del mes y padrón'],
      ['IA', 'Jev', 'Consultas, revisión del padrón y de la plata, manual'],
      ['Operación', 'Socios, Cuotas, Reservas, Ingresos, Acceso QR, Entrada pileta, Pileta', 'El día a día de la sede'],
      ['Club', 'Disciplinas, Fiestas', 'Deportes y eventos con inscripción'],
      ['Gestión', 'Concesiones, Contabilidad, Libros, Informes, Caja, Operación, Reportes', 'Contratos, libros, tesorería, débitos y respaldos'],
      ['Comunicación', 'Novedades, Encuestas, Alertas, Reclamos, Mensajería', 'Hablar con el padrón y atender pedidos'],
      ['Administración', 'Personal, Profesores, Usuarios y altas', 'Legajos, docentes y accesos'],
      ['Sistema', 'Configuración, Migración', 'Reglas del club, Mercado Pago, importaciones'],
    ],
    [30, 80, 68]
  );
  m.box('warn', 'El padrón es sensible', 'Ves DNI, domicilios, teléfonos, saldos y datos de pago de miles de socios. No los fotografíes, no los mandes por WhatsApp y no los exportes a un celular. Los PDF y Excel son de uso interno del club.');

  /* ------------------------------------------------------------------ 3 */
  m.h1('3.  Usuarios y altas', { n: '03' });
  m.p('En Administración > Usuarios y altas creás a las personas que trabajan en el sistema y les das sus roles. Arriba dice “Administradores” con la cantidad, un buscador (nombre, DNI, email, usuario o #) y el botón Agregar. La tabla muestra #, Nombre, Acceso (el mail de contacto y el usuario), Roles, Estado (Activo o Inactivo) y Funciones.');
  m.box('warn', 'Esta lista solo muestra administradores', 'La lista trae únicamente a quienes tienen el rol Administrador o Superadministrador. Un usuario cuyo único rol es Cajero, Contador, Portería u otro de personal se crea desde acá, pero no vuelve a aparecer en la lista. Por eso, al crearlo, copiá su clave en el cartel “Credenciales generadas”. Para cambiarle después el rol o la clave no hay otra pantalla del panel: se hace en Supabase. Los profesores se manejan desde Profesores y los socios desde su ficha.');
  m.h2('Crear un usuario');
  m.steps([
    'Tocá Agregar. Se abre el formulario.',
    'Escribí el Nombre. Si la persona es socia, buscala en “Ficha de socio” (por número o nombre) y el formulario toma sus datos. Completá Apellido, Documento (tipo y número), Género, Fecha de nacimiento, Domicilio, Teléfono de contacto y Email de contacto. Grupo sanguíneo, Obra social y datos de emergencia son opcionales.',
    '“Usuario (login)”: se arma solo con el nombre y el DNI y termina en @jockey.sj. Podés tocar Regenerar o escribirlo vos; si lo editás a mano, queda marcado “editado manualmente”.',
    '“Contraseña”: mínimo 6 caracteres. Escribila o tocá Regenerar. Con el ojo la mostrás u ocultás y con el botón de al lado la copiás.',
    '“Roles”: marcá uno o varios de Sistema. Los permisos se suman. Abajo, “Cargos / figuras del club” también se acumulan (capítulo 4).',
    '“Autorizaciones” (opcional): “+ Administrador” (rol Superadministrador o Administrador, con fecha de vencimiento) y “+ Operador portería” (con un PIN de hasta 8 caracteres; se recomiendan los últimos 4 dígitos del documento). Sin fecha de vencimiento la autorización es indefinida.',
    '“Números de identificación” (opcional): un tipo y un identificador por fila.',
    'Tocá “Crear usuario”. Aparece el cartel “Credenciales generadas” con el Usuario, el Login y la Contraseña. Tocá “Copiar clave” y pasásela a la persona antes de cerrarlo.',
  ]);
  m.h2('Editar, desactivar y regenerar la clave');
  m.p('En cada fila, el menú de los tres puntos (Acciones) ofrece:');
  m.bullets([
    'Editar ficha y roles: cambia los datos y los roles. La clave solo se actualiza si escribís una nueva o tocás Regenerar.',
    'Historial: la trazabilidad de la cuenta, quién cambió qué y cuándo, con un “Detalle técnico” desplegable.',
    'Desactivar / Activar: la persona deja de poder entrar (queda Inactivo) sin perder su historial.',
    'Regenerar clave: genera una contraseña nueva para que se la pases.',
  ]);
  m.box('tip', 'Cuando alguien deja el puesto', 'Desactivalo ese mismo día. No alcanza con “esconder” su mail: mientras el usuario esté activo, puede entrar.');
  m.box('warn', 'Nunca por la pantalla pública', 'El sistema jamás entrega una clave por la pantalla pública: la entrega el personal. No crees un usuario con el correo de otra persona, no uses tu usuario para “probar” una cuenta y no le asignes el rol de superadministrador a nadie “por las dudas”.');

  /* ------------------------------------------------------------------ 4 */
  m.h1('4.  Roles y permisos', { n: '04' });
  m.p('Un usuario puede tener más de un rol y los permisos se suman. Hay dos candados: el menú esconde lo que el rol no abre, y la base de datos vuelve a pedir el permiso en las tablas sensibles (por ejemplo, ver los pagos exige “payments.read”; los legajos, “hr.read”; guardar ajustes del club, “settings.write”). Una pantalla visible no alcanza: también hace falta el permiso en la base.');
  m.table(
    ['Rol', 'Entra a', 'Particularidades'],
    [
      ['Socio', 'Portal del socio', 'Credencial, reservas, Mi Cuenta. El adherente no paga ni reserva'],
      ['Profesor', 'Asistencia (/asistencia)', 'Toma presente y ve si el alumno tiene la cuota al día'],
      ['Personal', 'Inicio, Jev, Reservas, Disciplinas, Pileta, Ingresos, Personal, Fiestas, Alertas, Reclamos, Novedades', 'Opera el Acceso QR. No cobra cuotas'],
      ['Recursos humanos', 'Inicio, Personal, Alertas', 'Legajos y novedades del staff'],
      ['Operador de portería', 'Inicio, Jev, Socios (consulta), Pileta, Ingresos, Caja', 'Acceso QR. Cobra cuotas'],
      ['Operario de pileta', 'Las 13 secciones del mostrador', 'Abre en Entrada pileta. Cobra. Saldos solo de consulta'],
      ['Cajero', 'Inicio, Jev, Socios, Saldos, Ingresos, Caja, Fiestas', 'Cobra y anula con motivo. Acceso QR. Solo registra cobros por el registro de cobro'],
      ['Empleado de administración', 'Las 13 del mostrador, más Débitos', 'Cobra, liquida y arma débitos. No edita fichas'],
      ['Contador', 'Inicio, Jev, Cuotas, Contabilidad, Libros, Informes, Caja, Operación, Reportes, Fiestas', 'Liquida y anula cobros. Ve el padrón solo desde Contabilidad, sin editarlo. Entra a Concesiones'],
      ['Administrador', 'Todo menos Contabilidad, Libros, Informes y Caja; en Operación solo Débitos', 'Edita fichas, liquida, ve Configuración y Migración y da el rol Profesor'],
      ['Superadministrador', 'Todo', 'Único que crea usuarios y da roles'],
    ],
    [34, 78, 66]
  );
  m.h2('Cargos del club');
  m.p('Presidente, Vicepresidente, Secretario, Tesorero, Vocal, Socio titular y Socio adherente son cargos. No cambian las pantallas que ve la persona. La única excepción es el cargo Tesorero, que habilita a anular un cobro.');
  m.h2('Un rol que sale mal');
  m.bullets([
    'El administrador solo puede dar o quitar el rol Profesor (desde Profesores). No puede darse a sí mismo otro rol por ninguna vía.',
    'El rol principal de un perfil solo lo cambia el superadministrador.',
    'Cambiar lo que puede hacer un rol no se hace desde una pantalla: es un cambio de código (roles.js) y de la base (tabla de capacidades por rol). Las dos listas tienen que coincidir.',
  ]);

  /* ------------------------------------------------------------------ 5 */
  m.h1('5.  Configuración del club', { n: '05' });
  m.p('Sistema > Configuración guarda en el libro las reglas que leen la pileta, las cuotas, el portal y Mercado Pago. Arriba dice “Libro conectado”; si dice “Libro no responde”, no hay conexión con la base y nada de lo que cargues se guarda. Cada tarjeta tiene su propio botón de guardar: lo que cambiás en una no se guarda con el botón de otra.');
  m.table(
    ['Tarjeta', 'Qué se ajusta', 'Cuidado'],
    [
      ['Sede', 'Nombre, Razón social, Domicilio, Ciudad, Código postal, CUIT, Teléfono y Correo. Botón “Guardar sede”', 'Salen en el pie del portal y en el libre deuda'],
      ['Cuotas', 'Vence el día (1 al 28; hoy el 10), Tolerancia de pago, Gracia de la credencial, Deuda máxima, Cuenta protegida hasta y “Los socios pueden ver su cuenta corriente”. Botón “Guardar vencimiento”', 'AMET vence el 18 por regla de su categoría, no por este campo. La tolerancia también se usa para avisar cuando el comprobante no coincide con el cobro'],
      ['Regla de avisos', 'Informativa: mensaje y mail el día 5 (por vencer), el 10 (vence) y el 11 (mora), con las consecuencias de la mora', 'Se mueve con “Vence el día”'],
      ['Pileta', 'Canon socio, Canon invitado, Apto médico (días), Invitados por socio, Nombre de la temporada, “El socio carga el apto médico” y “Mora desde el 10 bloquea el ingreso”. Botón “Guardar pileta”', 'El bloqueo por mora rige en temporada (diciembre a marzo) y vale para la sede y la pileta'],
      ['Mercado Pago', 'Cobros habilitados y Caja QR. Botón “Guardar Mercado Pago”', 'Capítulo 6'],
      ['Reglas del club', 'Tutores por grupo, Recordatorio, Portería autoriza pileta, Titular en comunicaciones, boleto de pago (mostrar, nombre, recargos), Avisos de pago con aprobación, Elegir débito familiar, Teléfonos útiles, Motivos de comunicación con su plazo y Categorías de gastos', '“Portería autoriza pileta” en Sí deja pasar sin inscripción o apto'],
      ['Planes con tarjetas', 'Etiqueta, Marca, Cuotas y Activo u Off de cada plan. Botones “Agregar plan” y “Guardar planes”', 'Solo el superadministrador los edita; los demás los ven en solo lectura'],
      ['Zonda', 'Botón “Declarar Zonda” o “Desactivar”', 'Cierra las canchas al aire libre y Alertas avisa'],
    ],
    [30, 94, 54]
  );
  m.h2('Cuenta protegida');
  m.p('“Cuenta protegida hasta” es una fecha: hasta ella no se reescriben movimientos ya cerrados. Sirve para no tocar por error lo que viene de los cortes de LILA. Cambiala solo si Tesorería te lo pide y sabés por qué.');
  m.h2('Planes con tarjetas');
  m.steps([
    'Entrá a Configuración y buscá la tarjeta “Planes con tarjetas”.',
    'Tocá “Agregar plan” y completá la Etiqueta (por ejemplo, “Visa 3 cuotas”), la Marca y la cantidad de Cuotas.',
    'Dejalo Activo. Con Off el plan deja de ofrecerse sin borrarse.',
    'Tocá “Guardar planes”.',
  ]);
  m.p('En la ventana Cobrar cuota, el método Tarjeta ofrece los planes activos. Un plan es el acuerdo del socio con su tarjeta: no financia la deuda del club y el club cobra la cuota completa. Si no hay planes activos, el cobro con tarjeta se registra igual.');
  m.box('tip', 'Zonda', 'Declarala cuando el viento obligue a cerrar y desactivala apenas pase. Una alerta de Zonda olvidada sigue cerrando las canchas al aire libre para todos.');

  /* ------------------------------------------------------------------ 6 */
  m.h1('6.  Mercado Pago', { n: '06' });
  m.p('Mercado Pago tiene tres productos: el cobro online en Mi Cuenta (Checkout Pro), el QR de mostrador en caja y pileta, y la suscripción mensual (el débito de la cuota del mes, el día 10).');
  m.h2('Activarlo');
  m.steps([
    'El token de la cuenta del club va en las secretas de Supabase (MP_ACCESS_TOKEN), nunca en esta pantalla. Opcionalmente, MP_WEBHOOK_SECRET para validar la firma de los avisos.',
    'En Mercado Pago, configurá el webhook con la dirección que muestra la tarjeta (termina en /functions/v1/mp-webhook) y los tópicos payment, merchant_order, order, subscription_preapproval y subscription_authorized_payment.',
    'En Sistema > Configuración > Mercado Pago, poné “Cobros habilitados” en Sí.',
    '“Caja QR” es el identificador de la caja en Mercado Pago. Se crea sola la primera vez que se usa.',
    'Tocá “Guardar Mercado Pago”.',
    'Probá con un cobro de importe chico en caja y verificá que diga “Pago acreditado”.',
  ]);
  m.h2('Cómo lo usa cada uno');
  m.bullets([
    'Online: el socio toca Pagar ahora en Mi Cuenta, aparece el código para escanear (o el botón Abrir pago) y vuelve a www.jockeyclubsj.com.ar/cuenta. Se acredita cuando Mercado Pago confirma.',
    'En el lugar: en Cobrar cuota, en Entrada pileta y en Pileta aparece Mercado Pago (QR). Cuando Mercado Pago aprueba, el cobro se imputa solo. No tiene botón de confirmar a mano.',
    'Suscripción: Débito cada mes cobra la cuota del mes el día de vencimiento. La deuda anterior se paga aparte, con Pagar ahora. Solo cuenta como adherido el que Mercado Pago confirmó: escribir “débito” en la ficha no alcanza.',
    'Al aprobarse un pago, el socio recibe el comprobante por mensaje y mail, solo.',
    'Vitalicio, fundador y comisión no pagan cuota con Mercado Pago ni pueden adherirse. Un adherente tampoco: paga el titular.',
  ]);
  m.box('warn', 'No lo apagues con socios pagando', 'Con “Cobros habilitados” en No se cae el checkout, el QR y la adhesión de todos a la vez. Y si el QR ya quedó aprobado, el cobro está imputado: no lo cargues también a mano.');

  /* ------------------------------------------------------------------ 7 */
  m.h1('7.  Montos, descuentos y bonificaciones', { n: '07' });
  m.h2('Cambiar los montos de las categorías');
  m.p('Los montos de cada categoría de cuota se fijan al armar la liquidación del mes. Cambiarlos es solo del superadministrador.');
  m.steps([
    'Entrá a Operación > Cuotas y abrí “Cuotas de [año]”.',
    'En el mes que vas a liquidar, tocá Editar (el lápiz). Se puede editar hasta que el período pasa a Procesada.',
    'En la tabla, cambiá el Valor de la categoría. La tabla muestra Identificador, Socios titulares activos, Valor y Total, y abajo el total de las cuotas.',
    'Si hace falta, ajustá Gastos de la liquidación, Recargos (fecha, tipo, categorías y valor) y Alertas de vencimiento, con los botones “Agregar gasto…”, “Agregar recargo” y “Agregar alerta”.',
    'Tocá “Guardar y liquidar después”. El período no se liquida todavía: se genera el día 1 o a mano con Generar (capítulo 8).',
  ]);
  m.h2('Descuentos y bonificaciones');
  m.p('Están en Gestión > Contabilidad > Padrón: “Descuentos extras” (las reglas que se cargan) y “Bonificaciones” (a quién le bajan la cuota viva este mes). Cargar o cambiar un descuento es solo del superadministrador; la base lo exige y pide un motivo de al menos 8 caracteres. El contador los consulta.');
  m.table(
    ['Tipo de descuento', 'A quién se aplica'],
    [
      ['Descuentos por socios', 'A uno o varios socios, sobre el total de sus cuotas'],
      ['Descuentos por categoría de cuota', 'A todos los socios de una categoría, automáticamente'],
      ['Descuentos a cuota de un socio', 'A una cuota puntual de un socio, no a todas'],
      ['Descuentos a grupo familiar', 'A un grupo familiar'],
      ['Descuentos generales', 'A todo el padrón'],
    ],
    [60, 118]
  );
  m.bullets([
    'El valor es un Porcentaje (%) o un Importe fijo ($).',
    'Para elegir a los socios se busca por nombre, DNI o número y se agregan como etiquetas.',
    'El descuento se aplica sobre la cuota antes del recargo. Cobrar y liquidar ya lo toman: la liquidación vigente aplica los descuentos cargados.',
  ]);
  m.box('warn', 'Siempre con motivo', 'Un descuento sin motivo escrito (mínimo 8 caracteres) no se guarda. Escribí quién lo pidió y por qué: dentro de seis meses nadie se va a acordar.');

  /* ------------------------------------------------------------------ 8 */
  m.h1('8.  Corregir: anular, recargo, reabrir y notas', { n: '08' });
  m.p('Nada de lo contable se borra: se corrige con una herramienta que deja el rastro (contraasiento, historial y motivo). Elegí la más chica que resuelve el problema.');
  m.table(
    ['Qué hay que corregir', 'Herramienta', 'Quién'],
    [
      ['Un cobro mal cargado (importe o medio equivocado)', 'Anular, en Movimientos de la ficha', 'Caja, Tesorería, contador y superadmin'],
      ['Un recargo cobrado que no correspondía', 'Borrar recargo, en Movimientos', 'Solo superadmin'],
      ['Un socio con un cargo de más o de menos en un mes ya procesado', 'Nota de crédito o débito', 'Solo superadmin'],
      ['Una liquidación pendiente que todavía no imputó', 'Volver a borrador', 'Solo superadmin'],
      ['Una liquidación procesada con un error grave', 'Reabrir', 'Solo superadmin'],
    ],
    [78, 60, 40]
  );
  m.h2('Anular un cobro');
  m.steps([
    'En la ficha del socio, abrí Movimientos y buscá el cobro.',
    'Tocá Anular y escribí el motivo (mínimo 8 caracteres).',
    'El cobro queda tachado con la marca “Anulado” y quién lo anuló. Vuelven el saldo, el último pago y el próximo vencimiento que había antes, y se genera el contraasiento en caja.',
    'Cobrá de nuevo con el importe y el medio correctos.',
  ]);
  m.h2('Borrar un recargo ya cobrado');
  m.p('El recargo se cobra siempre: ya nadie lo perdona al cobrar, y la base rechaza un cobro que intente perdonarlo (“El recargo no se perdona al cobrar”). Si hubo que quitar uno ya cobrado, en Movimientos tocá “Borrar recargo” en ese cobro, confirmá y escribí el motivo (mínimo 8 caracteres). El importe cobrado queda y el recargo pasa a saldo a favor del socio, que se descuenta solo en su próximo cobro. No funciona sobre un cobro anulado ni sobre uno sin recargo.');
  m.h2('Nota de crédito o débito');
  m.p('Corrige el saldo de un socio sin tocar la liquidación del mes. Aparece como un ícono de billetera en la fila de un período Procesado.');
  m.steps([
    'En Cuotas > “Cuotas de [año]”, buscá el mes y tocá el ícono “Nota de crédito o débito”.',
    'Escribí el Número de socio y elegí el Tipo: Crédito (baja el saldo) o Débito (sube el saldo).',
    'Escribí el Importe (mayor a cero) y el Motivo (mínimo 8 caracteres).',
    'Tocá “Registrar nota”. Dice “La liquidación no se modificó”: solo se movió el saldo de ese socio.',
  ]);
  m.p('No se puede cargar una nota a quien no abona cuota (vitalicio, fundador o comisión).');
  m.h2('Reabrir una liquidación');
  m.steps([
    'En Cuotas > “Cuotas de [año]”, buscá el período y tocá el ícono “Reabrir (solo superadmin)”. Si el período está Pendiente y todavía no imputó, el ícono dice “Volver a borrador”.',
    'Escribí qué salió mal. El aviso dice “Se anulan las deudas de esa liquidación y el mes vuelve a borrador”.',
    'Confirmá. La base calcula qué deuda devolver a cada socio y lo audita. El período queda en Borrador.',
    'Corregí lo que haga falta (montos, padrón) y generá de nuevo.',
  ]);
  m.box('warn', 'Reglas que no se saltean', 'Una liquidación procesada no se modifica: se corrige con una nota. Solo se reabre un período ya generado, y hasta octubre de 2026 la liquidación quedó en LILA, así que esos meses no se reabren. Si una liquidación no guardó el detalle por socio, tampoco se puede anular. El historial del período (ícono del reloj) muestra quién generó o revirtió.');

  /* ------------------------------------------------------------------ 9 */
  m.h1('9.  Padrón: altas, bajas, solicitudes y claves', { n: '09' });
  m.p('Editar fichas, dar altas, suspender, dar de baja, resolver solicitudes y entregar claves del portal son tareas del administrador y tuyas. El resto del personal solo consulta el padrón y cobra.');
  m.h2('Alta de un socio titular');
  m.p('Antes de empezar, buscá por DNI y por apellido: si la persona ya figura, no la cargues otra vez.');
  m.steps([
    'En Operación > Socios tocá el botón verde “Registrar Socio”. Se abre “Alta de socio titular”. Los campos con asterisco son obligatorios.',
    '1. Datos personales: Nombre completo, tipo y número de documento, fecha de nacimiento, género, estado civil y nacionalidad. Podés subir la foto de la credencial.',
    '2. Contacto y domicilio: Celular WhatsApp (obligatorio), email, teléfono alternativo y domicilio completo.',
    '3. Datos de emergencia: grupo sanguíneo, obra social, contacto, número y clínica.',
    '4. Membresía y disciplinas: Categoría club (obligatoria), estado, fecha de ingreso, hora y próximo vencimiento. Marcá al menos una disciplina.',
    '5. Facturación y cobranza: razón social, CUIT o CUIL, condición de IVA y medio de pago habitual, si hace falta.',
    '6. Grupo familiar: los adherentes son opcionales y se pueden sumar después. Cada uno lleva nombre completo, vínculo, DNI, nacimiento, categoría y al menos una disciplina.',
    'Tocá “Registrar socio” (o “Registrar socio + N familiares”). “Cancelar” descarta el formulario.',
  ]);
  m.h2('Sumar un adherente después');
  m.steps([
    'Buscá al titular en Socios y abrí su grupo familiar (la fila se expande).',
    'Tocá “Agregar Adherente”, completá Nombre completo, Parentesco, Categoría y al menos una disciplina, y tocá “Cargar”.',
  ]);
  m.h2('Editar la ficha');
  m.p('Abrí la ficha con el lápiz de la fila. Solo tu perfil y el del administrador ven las secciones Editar y Grupo familiar. Cada cambio queda en Trazabilidad con quién lo hizo.');
  m.h2('Solicitudes que llegan por internet');
  m.p('Las personas que usan la pantalla pública /registro dejan pedidos que se atienden en Socios, en la sección plegable “Solicitudes”, con tres solapas: Acceso al portal, Quiero asociarme y Listos. Arriba a la derecha hay un “Link público” y una “Placa” con el QR para pegar en el club.');
  m.steps([
    'Acceso al portal: verificá que la persona es quien dice ser (nombre, DNI y celular contra la ficha). Tocá “Entregar acceso”: el sistema crea el acceso y manda el mail.',
    'La ventana muestra Usuario, Email de ingreso, Contraseña y el link. Dice “Anotá la contraseña: solo se muestra ahora”: pasásela al socio antes de cerrar.',
    'Si el mail no salió, “Enviar por WhatsApp” (solo si la ficha tiene celular válido) o “Abrir mail”. “Descargar PDF” guarda el comprobante de la entrega.',
    'Quiero asociarme: tocá el nombre para ver el detalle. “Dar de alta y enviar usuario” da el alta, genera el acceso y lo manda; “Dar de alta” abre el formulario con los datos cargados para revisarlos.',
    '“Rechazar” pide una nota o el motivo del rechazo; “Ya contactado” cierra el pedido si lo resolviste por otro camino.',
  ]);
  m.h2('Suspender, reactivar y dar de baja');
  m.p('Las tres acciones piden un motivo y quedan en la ficha (Trazabilidad) y en la auditoría. Se usan desde el menú de los tres puntos de la fila.');
  m.table(
    ['Acción', 'Botón', 'Motivos que ofrece'],
    [
      ['Suspender', 'Suspender', 'Mora o deuda de cuotas · Conducta o reglamento · Documentación incompleta · Pedido del socio · Otro motivo'],
      ['Reactivar', 'Activar', 'Regularizó situación · Revisión administrativa · Alta o suspensión por error · Otro motivo'],
      ['Dar de baja', 'Eliminar', 'Renuncia o baja voluntaria · Fallecimiento · Mora irrecuperable · Registro duplicado · Corrección o migración de padrón · Otro motivo'],
    ],
    [30, 28, 120]
  );
  m.bullets([
    'Suspendido: no ingresa a la sede y su cuota queda en pausa.',
    'Baja: rige el día 1.º del mes. Si se presenta otro día, queda para el 1.º del mes siguiente; hasta entonces el socio sigue activo y se le cobra el mes.',
    'Mora no es suspensión: un socio en mora no queda suspendido solo. No des de baja un registro duplicado sin comparar antes cuál es la ficha buena.',
  ]);
  m.h2('Credenciales y tarjeta del socio');
  m.p('En la fila del socio, menú de los tres puntos > Credenciales > “Generar acceso” arma el usuario (su email) y la contraseña, que se entrega con “Enviar por email” o por WhatsApp. Tarjeta muestra la credencial digital con el QR firmado. El socio entra con el correo de su ficha: si está mal, corregilo antes en Editar.');

  /* ----------------------------------------------------------------- 10 */
  m.h1('10.  Contabilidad, libros e informes', { n: '10' });
  m.p('La contabilidad vive en tres módulos de Gestión: Contabilidad (padrón y catálogo), Libros (partida doble) e Informes. Comparten los datos con el Contador.');
  m.h2('Tres mundos que no se suman entre sí');
  m.bullets([
    'Saldo del socio: la ficha viva, lo que se cobra hoy.',
    'Cortes LILA: planillas importadas de un día anterior al empalme del 1 de octubre de 2026. El sistema las muestra con la leyenda “Corte LILA” y su fecha, y no pisan el saldo del socio.',
    'Libro vivo del club: cuotas, caja y cobros de hoy. Lo usan el Diario, el Mayor, el asiento legal, Informes, Tesorería e Impuestos.',
  ]);
  m.table(
    ['Módulo', 'Pantallas', 'Para qué sirve'],
    [
      ['Libros', 'Libro Diario, Libro Mayor, Crear asiento legal', 'Contabilidad de partida doble del club'],
      ['Informes', 'Balance (mensual, resumido, cuenta corriente, patrimonial), Estado de resultados, Reportes y gráficos, Reportes', 'Resultados, balances y el informe de cierre'],
      ['Contabilidad', 'Padrón (Libre deuda, Grupo familiar, Descuentos extras, Bonificaciones, SIAP, Impuestos) y Catálogo (Plan de cuentas)', 'Certificados, saldos por familia, descuentos e impuestos del mes'],
    ],
    [30, 90, 58]
  );
  m.h2('El informe de cierre del mes');
  m.steps([
    'Entrá a Gestión > Informes > Reportes y abrí “Informe de cierre”.',
    'Elegí el Mes. Cada uno dice si está Cerrado o En curso.',
    'Descargá el PDF. Sigue este orden: fecha de corte, imputar pagos pendientes, cajas y medios de cobro, cuentas corrientes, resumen mensual y saldos al mes siguiente, con un espacio para las firmas.',
  ]);
  m.box('tip', 'Si los totales no cierran', 'Es esperable que el mensual LILA, la caja de otro corte y la liquidación den números distintos: son fotos de días distintos. No los ajustes entre sí a mano. Anotá la fecha de cada reporte, y recordá que el saldo vivo es el de la ficha.');
  m.box('warn', 'Asientos', 'Un cobro habitual de socio se carga en la ficha, no como asiento suelto. No edites un asiento cerrado de LILA. Un cobro anulado deja su contraasiento: el original no se borra.');

  /* ----------------------------------------------------------------- 11 */
  m.h1('11.  Caja y tesorería', { n: '11' });
  m.p('La caja está siempre abierta: no se abre ni se cierra por turno. En Gestión > Caja (y en Operación) se registran ingresos, egresos y traspasos cuando haga falta. Efectivo más bancos más cheques es el total al día.');
  m.table(
    ['Pantalla', 'Para qué sirve'],
    [
      ['Cajas', 'Efectivo, bancos y arqueo. Es distinta de la caja de la pileta, que se ve en Pileta'],
      ['Otros ingresos', 'Rendición de portería y de estacionamiento: la carga el portero o caja. Entra a Caja General como otro ingreso; no es cuota ni suma al recaudado'],
      ['Gastos', 'Se pide, se aprueba y al pagar baja caja o banco. Las categorías se definen en Configuración'],
      ['Proveedores', 'Cuenta corriente: saldo de apertura más entradas y pagos. Positivo es deuda del club'],
      ['Retenciones', 'Se registran sobre la orden de pago y entran en Impuestos del mes'],
      ['Intereses', 'El contador los genera a mano. No corren solos y no quedan en la deuda de cuota, que es cuota y recargo'],
      ['Sin identificar', 'Cobranzas sin socio o con un número que no existe: se imputan o se rechazan. Jev avisa las pendientes'],
      ['Órdenes y Gastos fijos', 'Órdenes de pago, y los gastos recurrentes (no los cargues dos veces como gasto suelto)'],
      ['Saldos y Créditos socios', 'Resumen de tesorería, deuda de socios y de proveedores al mismo corte'],
    ],
    [42, 136]
  );
  m.box('warn', 'Reglas de la caja', 'No cierres la caja. No arquees la pileta desde Tesorería. No cargues portería como cobro de cuota en la ficha. Una factura de socio no es un gasto: va a la ficha. Una transferencia de un socio conocido entra directo como cuota, no como ingreso suelto para imputar después.');

  /* ----------------------------------------------------------------- 12 */
  m.h1('12.  Débitos automáticos', { n: '12' });
  m.p('Un débito automático cobra la cuota todos los meses de la tarjeta o la cuenta del socio. Se arma en Gestión > Operación, con tres pestañas: Listados débitos, Galicia y Prisma. Administración y el Administrador entran solo a esta parte de Operación, desde el menú Gestión > Débitos. El paso a paso completo está en el Manual de Administración y Pileta, capítulo 9.');
  m.bullets([
    'Listados débitos: la planilla mensual de crédito y débito. Se copia el mes anterior, se sube o baja el Excel y se registran altas y bajas en ficha (N° de tarjeta, tipo de tarjeta, titular). El código de seguridad no se guarda.',
    'Prisma: genera el archivo de Visa Crédito (DEBLIQC), Visa Débito (DEBLIQD) o Mastercard Crédito (DEBLIMC) con el identificador de Prisma de cada marca. El importe es el saldo de la cuenta corriente y los exentos no entran. La rendición se carga en “Archivo de respuesta”.',
    'Galicia: el lote mensual por CBU, con su estado (Programado, Enviado, Acreditado).',
  ]);
  m.box('warn', 'Prisma imputa de nuevo', 'No se genera dos veces el mismo mes. Y sin identificador el archivo sale solo con encabezado y cierre, sin socios. No dejes un débito Galicia sin socio si ya sabés el número.');
  m.box('tip', 'Datos de pago', 'Los números de tarjeta y los CBU son datos de pago. Se cargan solo en estas pantallas, nunca en papeles, WhatsApp ni planillas sueltas.');

  /* ----------------------------------------------------------------- 13 */
  m.h1('13.  Migración y cortes de LILA', { n: '13' });
  m.p('Sistema > Migración de datos es la herramienta con la que se subieron los datos del sistema anterior. El empalme con el portal fue el 1 de octubre de 2026: desde esa fecha el portal es el libro vivo y lo anterior son cortes de LILA. Usala con mucho cuidado: escribe sobre la base.');
  m.table(
    ['Bloque', 'Qué hace'],
    [
      ['Subir localStorage > BD', 'Importa a Supabase los datos de prueba que hay en el navegador'],
      ['Semilla demo local', 'Carga datos de demostración solo en el navegador'],
      ['Importar padrón datita', 'Elegís socios.csv y socio_cuotas.csv, y un Límite (vacío o “all” es completo). Dry-run no escribe. “Ejecutar lote > members” carga por número de socio. Estado muestra las cantidades'],
      ['Importar reservas datita', 'Elegís reservas.csv. Dry-run no escribe; “Cargar en local” lo deja en el navegador; “Subir a BD” lo escribe'],
    ],
    [50, 128]
  );
  m.steps([
    'Elegí los archivos y poné un Límite chico (por ejemplo, 50) para una primera prueba.',
    'Tocá Dry-run. Leé el resumen en el cuadro de abajo: cantidad de socios, categorías y socios sin cuota.',
    'Solo si el resumen es el esperado, tocá “Ejecutar lote” (o “Subir a BD”) y volvé a mirar el cuadro de actividad.',
    'Tocá Estado para comparar las cantidades de la base con las del archivo.',
  ]);
  m.box('warn', 'No reimportes lo que ya está en el libro', 'Un lote vuelve a escribir sobre socios que ya fueron corregidos a mano o cobrados desde el portal. Antes de correr uno, hacé un backup (capítulo 14) y avisá a quien cobra. Octubre de 2026 ya liquidó: no reimportes cuotas de ese mes.');

  /* ----------------------------------------------------------------- 14 */
  m.h1('14.  Reportes y backup', { n: '14' });
  m.p('Gestión > Reportes tiene cinco secciones: Resumen, Económico, Operativo, Todos los reportes y Backup. “Todos los reportes” junta los módulos (Socios, Contabilidad, Reservas, Portería y otros) para bajar en PDF o Excel. El padrón también sale desde Socios y el Excel de una liquidación, desde Cuotas.');
  m.h2('Backup');
  m.bullets([
    'Exportar: guarda el backup del día en el historial y descarga un archivo .json (JCSJ-ERP-Backup-fecha).',
    'Backups diarios: si lo activás, se guarda uno automáticamente al ingresar al panel. Se puede desactivar.',
    'Historial: cada backup se puede descargar o Restaurar, y “Restaurar archivo” sube un .json.',
  ]);
  m.box('warn', 'Restaurar reemplaza datos', 'El aviso lo dice: “Se reemplazarán los datos actuales del navegador”. El backup trabaja sobre los datos del navegador y no guarda domicilios ni el historial completo de pagos: es a propósito, para no acumular datos sensibles en una computadora. No reemplaza al respaldo de la base en Supabase ni a Migración.');

  /* ----------------------------------------------------------------- 15 */
  m.h1('15.  Comunicación, Zonda, personal, profesores y concesiones', { n: '15' });
  m.bullets([
    'Comunicación: Novedades (con portada, borrador o programada), Encuestas (consulta al padrón), Alertas (Informativa, Advertencia o Crítica; Todos, Socios, Personal o Administración), Reclamos y Mensajería (Mail, MD y WhatsApp). Un mensaje a “Todos los socios” llega a todo el padrón y no se puede retirar. Los pasos están en el Manual de Administración y Pileta, capítulo 14.',
    'Zonda: se declara al pie de Configuración. Suspende las actividades al aire libre y Alertas avisa. Desactivala cuando pase.',
    'Fiestas: eventos con inscripción (cena, torneo), con cupo y precio de entrada. Cargar el cobro a la cuenta del socio es “Imputar eventos”, en Cuotas.',
    'Personal: legajos y RR.HH. de los empleados. Están en Administración, junto a Profesores y Usuarios. Un socio no se da de alta acá.',
    'Profesores: el alta, la disciplina y la clave del profesor las hace el administrador o vos. El profesor entra a /asistencia, marca presentes y ve si el alumno tiene la cuota al día.',
    'Disciplinas: el catálogo de deportes, con su ranking, la inscripción de socios y el padrón de cada disciplina.',
    'Concesiones: bares y servicios del predio, con contrato, vigencia, canon, documentos y cierre. Muestra los vencimientos del mes y la deuda de canon por concesión. El concesionario tiene un portal aparte, con un código.',
  ]);

  /* ----------------------------------------------------------------- 16 */
  m.h1('16.  Seguridad y buenas prácticas', { n: '16' });
  m.bullets([
    'Un usuario por persona. Nunca prestes la clave ni la anotes en un papel. No uses este usuario en un lugar público.',
    'Dar el rol mínimo: cada persona con lo que necesita para su trabajo. El rol de superadministrador no se da por las dudas.',
    'Revisá la lista de usuarios cada tanto y desactivá a quien ya no trabaja en el club.',
    'Las autorizaciones de Administrador o de Portería conviene darlas con fecha de vencimiento.',
    'Toda corrección de plata lleva motivo. Escribilo como si lo fuera a leer alguien que no estuvo: socio, qué pasó, quién lo pidió.',
    'Nada se borra: se anula, se reabre o se carga una nota. Antes de corregir, anotá cuál es el estado actual.',
    'Para cobrar, anular o corregir un saldo, el sistema pide permisos distintos a propósito. No cambies ese reparto para resolver un apuro.',
    'Si hay que cambiar lo que puede hacer un rol, es un cambio de código y de la base. No se improvisa desde una pantalla ni a mano en la base.',
    'Antes de una importación grande o de reabrir una liquidación, hacé un backup y avisá a Tesorería y a Administración.',
    'No expongas el padrón: nada de fotos, capturas con DNI ni listas por WhatsApp.',
  ]);

  /* ----------------------------------------------------------------- 17 */
  m.h1('17.  Si algo no anda', { n: '17' });
  m.table(
    ['Qué ves', 'Qué suele ser', 'Qué probar'],
    [
      ['“Solo superadministrador puede modificar perfiles”', 'Tu sesión no tiene el rol Superadministrador', 'Salí y entrá de nuevo. Si sigue, revisá tus roles en Supabase'],
      ['Un usuario recién creado no aparece en la lista', 'La lista solo trae administradores y superadministradores', 'Es lo esperado (capítulo 3). Fijate que hayas copiado su clave'],
      ['“Solo administración puede crear o modificar perfiles”', 'Quien lo intentó no es administrador ni superadmin', 'Hacelo vos, o pasá el pedido'],
      ['“El administrador solo puede dar de alta profesores”', 'El administrador intentó dar otro rol', 'Es la regla: los demás roles los das vos'],
      ['Configuración dice “Libro no responde”', 'No hay conexión con la base', 'Recargá. No cargues cambios hasta que diga “Libro conectado”'],
      ['Los planes de tarjeta están grisados', 'Tu usuario no es superadministrador', 'Entrá con el usuario correcto'],
      ['Mercado Pago no acredita', 'Falta el token, está mal el webhook o Cobros habilitados está en No', 'Capítulo 6. Revisá en ese orden'],
      ['“El recargo no se perdona al cobrar”', 'Alguien intentó cobrar sin el recargo', 'El recargo se cobra siempre. Para quitar uno ya cobrado, usá Borrar recargo'],
      ['“Falta el motivo… (mínimo 8 caracteres)”', 'Anulación, recargo, nota o bonificación sin motivo', 'Escribí un motivo de al menos 8 caracteres'],
      ['“Una liquidación procesada no se modifica”', 'Intento de editar un período Procesado', 'Corregí con una nota de crédito o débito, o reabrí'],
      ['“Hasta octubre de 2026 la liquidación quedó en LILA”', 'Intento de reabrir un mes anterior al empalme', 'Esos meses no se reabren. Usá una nota'],
      ['“Ese socio no abona cuota”', 'Nota a un vitalicio, fundador o comisión', 'No corresponde: los exentos no tienen cuota'],
      ['“Ese cobro está anulado” o “Ese recargo ya se borró”', 'La corrección ya se hizo antes', 'Mirá Movimientos y el Historial'],
      ['El archivo de Prisma sale sin socios', 'Falta el Identificador de Prisma', 'Cargalo en la pestaña Prisma y generá de nuevo'],
      ['Números distintos en reportes', 'Cortes LILA de distintas fechas contra el libro vivo', 'Mirá la fecha del corte. El saldo vivo está en la ficha'],
      ['Una persona no ve una pantalla', 'Su rol no la abre', 'Capítulo 4. Revisá sus roles'],
      ['Un lote de Migración no cambió nada', 'Estaba en Dry-run o Supabase no está configurado', 'Mirá el cuadro de actividad y el aviso de abajo'],
    ],
    [56, 54, 68]
  );

  /* ----------------------------------------------------------------- 18 */
  m.h1('18.  Palabras que vas a ver', { n: '18' });
  m.table(
    ['Palabra', 'En criollo'],
    [
      ['Rol', 'El permiso de un usuario (socio, cajero, contador, administrador…). Se suman'],
      ['Cargo', 'Presidente, Tesorero, Vocal… No cambia las pantallas; el de Tesorero habilita a anular un cobro'],
      ['Autorización', 'Un permiso extra de Administrador o de Portería (con PIN), con o sin vencimiento'],
      ['Capacidad', 'Un permiso fino que la base le exige a un rol (por ejemplo, ver pagos o guardar ajustes)'],
      ['Libro', 'La base del club: Configuración, caja y cuotas se guardan ahí'],
      ['Empalme', 'El 1 de octubre de 2026, cuando el portal pasó a ser el libro vivo'],
      ['Corte LILA', 'Foto de un Excel de un día anterior al empalme; no es el estado de hoy'],
      ['Cuenta protegida', 'Fecha hasta la cual no se reescriben movimientos ya cerrados'],
      ['Borrador / Pendiente / Procesada', 'Estados de una liquidación mensual. Procesada ya no se edita'],
      ['Reabrir', 'Anular las deudas de una liquidación con error grave y volver el mes a borrador. Solo superadmin'],
      ['Nota de crédito o débito', 'Ajuste del saldo de un socio sin tocar la liquidación. Solo superadmin'],
      ['Contraasiento', 'El asiento inverso que deja una anulación. El original no se borra'],
      ['Bonificación', 'Rebaja de la cuota de un socio o de un grupo, con motivo. Solo la carga el superadmin'],
      ['Plan de tarjeta', 'El acuerdo del socio con su tarjeta (por ejemplo, 3 cuotas); no financia la deuda del club'],
      ['Cobros habilitados', 'El interruptor general de Mercado Pago: checkout, QR y adhesión'],
      ['Webhook', 'El aviso que Mercado Pago le manda al sistema cuando un pago se aprueba'],
      ['Secreta', 'Un dato privado guardado en Supabase (por ejemplo, MP_ACCESS_TOKEN), nunca en una pantalla'],
      ['Dry-run', 'Ensayo de una importación: muestra qué haría y no escribe nada'],
      ['Trazabilidad / Historial', 'El registro de quién cambió qué y cuándo, en la ficha o en la cuenta de un usuario'],
    ],
    [46, 132]
  );
  m.p('El portal funciona bien cuando cada uno usa su rol, cobra con el medio real y deja siempre el motivo de lo que cambia. Con este cargo, esa regla pesa el doble: gracias por cuidarla.');
}
