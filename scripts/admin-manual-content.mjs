/**
 * Contenido del Manual de Administración y Pileta (PDF).
 * Lo dibuja scripts/generate-admin-manual.mjs con la misma clase que el manual general.
 *
 * Para quién: Empleado/a de administración (admin_employee) y Operario/a de pileta
 * (pool_operator). Comparten el mostrador (roles.js, FRONT_DESK_TABS); administración suma
 * Cuotas con liquidación y los Débitos.
 *
 * Reglas de redacción:
 * - El PDF usa Helvetica estándar: nada de flechas ni símbolos fuera de Latin-1.
 *   Los caminos de menú se escriben con " > ".
 * - Cada dato sale del código del portal (pantallas, botones y reglas). Si cambia una
 *   pantalla, se cambia acá.
 */

export const CHAPTER_COUNT = 18;

export const ADMIN_MANUAL_TEXTS = {
  chromeRight: 'Manual de Administración y Pileta',
  coverTitle: 'Administración y Pileta',
  coverSubtitle: 'Manual paso a paso del mostrador del club',
  coverBlurb: 'Cómo trabajan el Empleado de administración y el Operario de pileta: buscar y cobrar a un socio con efectivo, transferencia, tarjeta, pago mixto o Mercado Pago; las cuotas y los débitos automáticos; reservas, la puerta y la caja de la pileta. Cada tarea, en el orden en que se hace.',
  coverEdition: 'Versión 1.2',
  coverNote: 'Uso interno del club  ·  No compartir claves',
  tocIntro: 'Los dos puestos comparten el mostrador; Administración suma las Cuotas con liquidación y los Débitos. Si trabajás en la pileta, empezá por el capítulo 12; si trabajás en administración, por el 3 y el 5. El capítulo 15 dice qué cosas NO se pueden hacer con este perfil y a quién pedirlas, y el 18 resume lo que cambió en esta edición.',
};

export function buildBody(m) {
  m.doc.addPage();
  m.drawChrome();
  m.y = 22;

  /* ------------------------------------------------------------------ 1 */
  m.h1('1.  Antes de empezar', { n: '01' });
  m.p('Este manual es para dos puestos del club: el Empleado o Empleada de administración y el Operario u Operaria de pileta. Los dos entran al panel del personal, consultan el padrón, cobran cuotas, atienden reservas y trabajan en la pileta. Lo que cambia es por dónde arrancan el día y que Administración, además, liquida las cuotas del mes y arma los débitos automáticos.');
  m.table(
    ['Puesto', 'Al entrar abre en…', 'Para qué se lo usa sobre todo'],
    [
      ['Empleado/a de administración', 'Inicio (Panel de administración)', 'Cobro de cuotas, liquidación del mes (Cuotas), débitos automáticos (Débitos), reservas y atención al socio'],
      ['Operario/a de pileta', 'Entrada pileta (la puerta de la pileta)', 'Controlar el ingreso, cobrar el canon, invitados y apto médico; cobrar cuotas; consultar Saldos'],
    ],
    [50, 56, 72]
  );
  m.p('Cualquiera de los dos puede ir a las secciones que le muestra el menú. El operario de pileta vuelve al resto del panel con el botón Panel, que está arriba a la derecha de la puerta y de la caja de la pileta.');
  m.h2('Qué secciones ves');
  m.table(
    ['Grupo del menú', 'Secciones', 'Capítulo'],
    [
      ['Inicio', 'Tablero del día: vencimiento, accesos rápidos, agenda, alertas', '3'],
      ['IA', 'Jev, el asistente que contesta dudas y lleva a la pantalla', '2'],
      ['Operación', 'Socios (consulta y cobro), Cuotas (Administración) o Saldos (Pileta), Reservas, Entrada pileta, Pileta', '4 al 8, 11 al 13'],
      ['Gestión', 'Débitos (solo Administración): Prisma, Galicia y Listados de débitos', '9'],
      ['Club', 'Fiestas', '14'],
      ['Comunicación', 'Novedades, Encuestas, Alertas, Reclamos, Mensajería', '14'],
      ['Administración', 'Profesores (solo para mirar)', '14'],
    ],
    [40, 110, 28]
  );
  m.box('tip', 'Si una pantalla no aparece', 'No está rota: tu perfil no la abre. Ingresos, Acceso QR, Disciplinas, Personal, Contabilidad, Libros, Informes, Caja, Reportes, Concesiones, Usuarios y altas, Configuración y Migración no son de este perfil. Y quien trabaja en la pileta no ve Cuotas ni Débitos. El capítulo 15 lo lista con el motivo.');

  /* ------------------------------------------------------------------ 2 */
  m.h1('2.  Entrar y moverse por el panel', { n: '02' });
  m.h2('Ingresar');
  m.steps([
    'Abrí el portal del club (www.jockeyclubsj.com.ar) en Chrome o Safari.',
    'Escribí tu correo y tu contraseña. Es tu usuario personal: no se presta ni se anota en un papel pegado en el escritorio.',
    'Tocá Ingresar al portal.',
    'Si además sos socio o socia del club, el sistema te pide elegir la puerta: Portal de socio o Administración. Para trabajar elegí Administración.',
  ]);
  m.h2('Moverte');
  m.bullets([
    'El menú de la izquierda se agrupa en Operación, Gestión, Club, Comunicación y Administración. Solo muestra lo que tu perfil abre.',
    'El buscador de arriba (Ctrl + /) lleva directo a una sección o a un socio: escribí “pileta”, “reservas” o el apellido.',
    'Inicio muestra el día. Al tocar el nombre de una sección en un acceso rápido, vas directo.',
    'Las pantallas Entrada pileta y Pileta son páginas propias, sin menú. Para volver al panel usá el botón Panel de arriba.',
  ]);
  m.h2('Jev, el asistente');
  m.p('En el menú IA está Jev. Le podés escribir el número de socio, su DNI o su nombre y apellido y te explica el caso con las mismas reglas que usan la caja y la puerta: categoría, titular o adherente, mora, si entra hoy y si puede pagar pileta. También sirve para saber cómo se hace una tarea. Jev solo lee: no cobra ni cambia nada.');
  m.h2('Salir');
  m.p('Usá siempre el botón Salir al terminar el turno, sobre todo en computadoras compartidas (mostrador, puerta de pileta). Quien se siente después vería el padrón con tu usuario.');
  m.box('warn', 'El padrón es sensible', 'Ves DNI, domicilios, teléfonos y saldos de miles de socios. No los fotografíes, no los mandes por WhatsApp y no los exportes a tu celular. Los PDF y Excel del padrón son para uso interno del club. Lo mismo vale para los comprobantes de pago y los números de tarjeta.');

  /* ------------------------------------------------------------------ 3 */
  m.h1('3.  Abrir el día', { n: '03' });
  m.p('Una rutina corta al llegar evita la mayoría de los problemas del resto del turno.');
  m.steps([
    'Entrá a Inicio. Arriba está el título Panel de administración con tu nombre y la fecha.',
    'Mirá la franja del vencimiento. La cuota social vence el 10 de cada mes y la categoría AMET, el 18. La franja dice cuántos días faltan o cuántos pasaron.',
    'Revisá los accesos rápidos. Muestran lo que hoy tiene algo para atender (por ejemplo Reclamos con pendientes, o Puerta pileta).',
    'Leé Agenda del día: las reservas de hoy y de la semana. Un clic te lleva a Reservas.',
    'Mirá el cuadro Alertas. Si hay una alerta viva (por ejemplo viento Zonda), avisá a quien corresponda.',
    'Si trabajás en administración, abrí Cuotas y mirá la franja de socios en mora. El día 1 la liquidación del mes se genera sola: confirmá que figure (capítulo 8).',
    'Si trabajás en la pileta, no hay caja que abrir: está siempre abierta. Entrá a Pileta y fijate que diga Caja abierta (capítulo 13).',
  ]);
  m.box('tip', 'Zonda', 'Con alerta Zonda declarada se suspenden las actividades al aire libre; lo cubierto sigue. Si un socio pregunta por qué no puede reservar una cancha exterior, mirá las alertas antes de buscar otra causa.');

  /* ------------------------------------------------------------------ 4 */
  m.h1('4.  Buscar a un socio y leer su ficha', { n: '04' });
  m.p('Casi todo empieza buscando a la persona. El padrón se abre en Operación > Socios y arranca con los socios activos.');
  m.steps([
    'En Socios, escribí en “Buscar en el padrón” un nombre, un Nº de socio, un DNI, un email o un teléfono. Mientras escribís, la lista se filtra y arriba dice cuántos socios y familias encontró.',
    'Si hace falta, filtrá por categoría con el desplegable “Todas las categorías”.',
    'Las tarjetas de arriba son atajos: Titulares, Grupo familiar, Altas y Bajas filtran la lista; Inactivos te lleva a la lista de socios inactivos.',
    'Para abrir la ficha completa tocá el lápiz de la fila.',
    'Los tres puntos (más acciones) abren un menú. Del menú usás Tarjeta (capítulo 10) y Cobrar. El resto de las opciones no son de este perfil (capítulo 10).',
  ]);
  m.p('El padrón carga de a poco porque son miles de fichas. Mientras carga, podés buscar igual; si alguien no aparece, esperá a que termine.');
  m.h2('La ficha');
  m.p('La cabecera de la ficha dice el estado de la cuenta y si el socio puede pagar pileta. Los estados son:');
  m.table(
    ['Estado', 'Significa'],
    [
      ['Cuenta habilitada', 'Puede ingresar y usar las instalaciones'],
      ['Pendiente de aprobación', 'El alta está en revisión de Secretaría'],
      ['Cuenta suspendida', 'Acceso restringido hasta regularizar'],
      ['Baja del padrón', 'Registro inactivo, con motivo auditado'],
    ],
    [56, 122]
  );
  m.p('Debajo hay secciones para moverse: Ficha, Tarjeta, Invitados, Documentos, Movimientos, Entradas, Asistencia, Reclamos, Mensajes y Trazabilidad. Con este perfil no ves Editar ni Grupo familiar: son del administrador. Movimientos muestra cada cobro con su Cuota y su Recargo, y permite abrir el comprobante que se adjuntó. Trazabilidad guarda quién cambió qué y con qué motivo.');
  m.box('ok', 'No borres lo que no ves', 'La lista del padrón es liviana a propósito: no muestra domicilio ni datos médicos. Están en la ficha. Si no ves un dato en la lista, no está perdido.');

  /* ------------------------------------------------------------------ 5 */
  m.h1('5.  Cobrar una cuota', { n: '05' });
  m.p('Cobrar es lo que más se hace en el mostrador. Los dos puestos cobran de la misma manera. Las modalidades de pago (tarjeta, pago mixto, comprobante) se explican una por una en el capítulo 6.');
  m.steps([
    'Buscá al socio (capítulo 4) y abrí su ficha. Si debe, aparece el botón Cobrar. También se cobra desde el menú de los tres puntos de la fila, opción Cobrar, que solo aparece si el socio debe y no es exento ni adherente.',
    'Se abre la ventana “Cobrar cuota”. Arriba dice el nombre del titular y el importe.',
    'Si el socio debe más de un mes, aparece “Meses del recibo”: cada mes dice si está Atrasada o es la Próxima, y su recargo. Marcá los meses que entran en este cobro. Siempre queda al menos uno marcado, y lo que no marques sigue pendiente.',
    'Mirá los recuadros: Cuota, Recargo, A favor (solo si el socio tiene saldo a favor) y Total. El Total es lo que hay que cobrar.',
    'Elegí el Método de pago: Efectivo, Transferencia, Tarjeta, Mixto o Mercado Pago.',
    'Completá lo que pide el método elegido (capítulo 6).',
    'Confirmá con el botón de abajo: “Acreditar efectivo”, “Registrar con comprobante” o “Registrar pago mixto”. Mercado Pago no tiene botón: se acredita solo cuando el pago se aprueba.',
    'Al terminar, el saldo de la ficha se actualiza, queda el ingreso en caja y el socio recibe solo el comprobante en PDF (capítulo 6).',
  ]);
  m.h2('Casos especiales');
  m.bullets([
    'Adherente: la cuenta es del titular. Si abrís la ficha de un adherente y cobrás, la ventana avisa “El pago de [nombre] entra en la cuenta del titular”. Si el titular no está en el padrón, el sistema no deja cobrar.',
    'Vitalicio, fundador y comisión no abonan cuota. El sistema no deja cobrarles (“Esta categoría no abona cuota social”) y no ofrece Mercado Pago.',
    'AMET vence el 18 y no lleva recargo. Su cuota ya viene con 2,5 % menos: es tarifa, no un descuento que tengas que aplicar.',
    'Recargo: es el 10 % de la cuota de cada mes vencido, por separado, desde el día siguiente al vencimiento y solo en socio familiar e individual. El recargo se cobra siempre, junto con la cuota.',
    'Saldo a favor: se descuenta solo en el próximo cobro y aparece en el recuadro A favor. Si cubre la cuota entera, lo que sobra queda para el cobro siguiente.',
    'Cuota vencida: el cobro posterior de una cuota vencida se imputa a esa deuda, y la caja anota el día en que realmente se cobró.',
  ]);
  m.box('warn', 'Lo que este perfil no hace al cobrar', 'No perdonás el recargo: en el mostrador nadie lo perdona. Borrar un recargo ya cobrado es solo del superadministrador, con motivo. Tampoco ves el botón Anular en Movimientos: anular un cobro, siempre con motivo, lo hacen caja, Tesorería, el contador y el superadministrador. Si un cobro salió mal, anotá número de socio, importe, medio y motivo, y pasalo a Tesorería. No lo arregles cargando otro cobro: queda duplicado.');
  m.box('tip', 'No re-liquides', 'Para cobrarle a un solo socio se cobra desde su ficha. No se vuelve a liquidar el mes para eso.');

  /* ------------------------------------------------------------------ 6 */
  m.h1('6.  Modalidades de pago: tarjeta, mixto y comprobante', { n: '06' });
  m.p('La ventana Cobrar cuota ofrece cinco métodos. Esta tabla dice qué pide cada uno y dónde queda el dinero.');
  m.table(
    ['Método', 'Qué pide', 'Dónde queda', 'Comprobante'],
    [
      ['Efectivo', 'Solo confirmar', 'Caja General', 'No'],
      ['Transferencia', 'Elegir el banco del club', 'La cuenta del banco elegido', 'Obligatorio'],
      ['Tarjeta', 'Elegir el plan con la tarjeta', 'Caja General', 'Obligatorio (voucher)'],
      ['Mixto', 'Dos o más medios que sumen el total', 'Cada medio en lo suyo', 'Uno por cada transferencia o tarjeta'],
      ['Mercado Pago', 'Mostrar el QR al socio', 'Se acredita solo al aprobarse', 'No'],
    ],
    [30, 54, 50, 44]
  );
  m.h2('Efectivo');
  m.p('Confirmá con “Acreditar efectivo”. El cobro se registra en Caja General.');
  m.h2('Transferencia');
  m.steps([
    'Elegí el “Banco del club” donde entró la plata. La ventana muestra el titular, el CBU y el alias, cada uno con un botón Copiar.',
    'Adjuntá el comprobante (foto o PDF). Es obligatorio: sin archivo no confirma.',
    'Revisá el desglose que arma el sistema (más abajo) y tocá “Registrar con comprobante”.',
  ]);
  m.h2('Tarjeta (POS)');
  m.steps([
    'Cobrá en el POS (la terminal) y guardá el voucher.',
    'En Cobrar cuota elegí Tarjeta.',
    'En “Plan con la tarjeta” elegí el plan (por ejemplo, de una o tres cuotas). La lista trae los planes activos que cargó el superadministrador en Configuración. Si dice “No hay planes activos”, el cobro se puede registrar igual.',
    'Adjuntá la foto o el PDF del voucher. Es obligatorio.',
    'Revisá el desglose y tocá “Registrar con comprobante”. El cobro se registra en Caja General.',
  ]);
  m.box('tip', 'El plan no es un préstamo del club', 'El plan es el acuerdo entre el socio y su tarjeta. No financia la deuda del club: el club cobra la cuota completa y la anota. No le prometas al socio cuotas sin interés ni intereses distintos.');
  m.h2('Pago mixto');
  m.p('Sirve cuando el socio paga una parte en un medio y el resto en otro (por ejemplo, la mitad en efectivo y la mitad por transferencia).');
  m.steps([
    'En Cobrar cuota elegí Mixto. Aparecen dos líneas, Medio 1 (efectivo) y Medio 2 (transferencia), cada una con la mitad del total.',
    'En cada línea elegí el Medio (Efectivo, Transferencia o Tarjeta) y escribí el Importe.',
    'Si el medio es Transferencia, elegí el Banco. Si es Tarjeta, elegí el Plan. En ambos casos adjuntá el Comprobante de esa línea.',
    '“Agregar medio” suma otra línea; “Quitar” saca una (a partir de la tercera).',
    'Mirá el cartel de abajo a la derecha: “Suma $… · ok” en verde cuando cierra con el total; en rojo dice cuánto falta.',
    'Tocá “Registrar pago mixto”. Hacen falta al menos dos medios con importe.',
  ]);
  m.box('warn', 'Mercado Pago no entra en el mixto', 'El QR de Mercado Pago es un cobro aparte. Si el socio quiere pagar una parte con Mercado Pago, cobrá esa parte por el QR y el resto en otro cobro.');
  m.h2('Mercado Pago (QR)');
  m.steps([
    'En Cobrar cuota elegí Mercado Pago y tocá “Cobrar $… con QR”.',
    'Aparece el QR de mostrador (y un botón “Abrir pago”). El socio paga desde su teléfono.',
    'El cobro se acredita solo cuando Mercado Pago lo aprueba y la ventana dice “Pago acreditado”. No hay botón para confirmar a mano.',
  ]);
  m.h2('El comprobante: lo lee Gemini');
  m.p('Cuando adjuntás una transferencia o un voucher, el sistema lo lee con Gemini y arma el “Desglose del comprobante” con cuatro datos: Importe, Fecha, Banco / tarjeta y Referencia (y, si figura, el titular).');
  m.bullets([
    'Los datos se pueden corregir a mano: si Gemini leyó mal un número, escribilo bien antes de registrar.',
    'Si el importe del comprobante difiere del cobro en más de la tolerancia (hoy $1.000, la fija Configuración), el cuadro se pone en rojo y dice “El comprobante marca $… ; el cobro es $…”. Revisá que sea el comprobante correcto antes de seguir.',
    'Si la lectura falla o tarda, el cobro no se bloquea: se registra igual con el archivo adjunto.',
    'El archivo queda guardado en la ficha. Se abre desde Movimientos, con el enlace Abrir.',
  ]);
  m.h2('Qué pasa cuando el cobro se acredita');
  m.p('Apenas el cobro queda acreditado, el sistema manda solo el comprobante en PDF al mail real del socio y un mensaje interno en su portal. No hay que apretar nada y no hay botón para reenviarlo. Si el socio no tiene un mail real en la ficha, igual recibe el mensaje en el portal. Vitalicio, fundador y comisión nunca reciben comprobante de cuota.');

  /* ------------------------------------------------------------------ 7 */
  m.h1('7.  Registrar una transferencia que avisó el socio', { n: '07' });
  m.p('Un socio puede pagar por transferencia desde su cuenta y avisar adjuntando el comprobante. Ese aviso llega a la bandeja de administración. El aviso solo avisa: no cobra ni cambia el saldo.');
  m.steps([
    'Entrá a Comunicación > Mensajería y abrí la sala MD. Ahí están los mensajes internos hacia administración, con el comprobante adjunto.',
    'Abrí el aviso y anotá el número de socio y el importe.',
    'Verificá en el banco que la plata esté acreditada. Si todavía no está, no cobres.',
    'Abrí la ficha del socio y tocá Cobrar. Elegí Transferencia, el banco del club donde entró la plata y adjuntá el comprobante.',
    'Tocá “Registrar con comprobante”. La transferencia entra directo como cuota: baja el saldo del socio, queda el ingreso en caja y el recibo le llega solo.',
    'Si el socio no es el titular, el cobro entra en la cuenta del titular.',
  ]);
  m.box('warn', 'Primero el banco', 'No cobres solo porque llegó el aviso. El comprobante puede estar mal, ser de otro día o de otro socio. La plata tiene que estar en la cuenta del club.');
  m.box('tip', 'Transferencia sin socio', 'Si el aviso no trae número de socio, o trae uno que no existe, no la cargues como un ingreso suelto de caja para imputar después. Esas cobranzas quedan en “Sin identificar”, que es de Tesorería y del contador: pasales el comprobante, el importe y la fecha.');

  /* ------------------------------------------------------------------ 8 */
  m.h1('8.  Cuotas, mora y Saldos', { n: '08' });
  m.p('Operación > Cuotas es la vista viva de la cuota social sobre el padrón. En el menú se llama Cuotas para el puesto de Administración, que liquida, y Saldos para el de Pileta, que solo consulta. Las dos muestran la franja de socios en mora: el 10 vence sin recargo y desde el 11 está en mora (AMET vence el 18).');
  m.h2('Consultar (los dos puestos)');
  m.table(
    ['Vista', 'Qué muestra'],
    [
      ['Saldos', 'La cuenta de cada socio'],
      ['CC detalladas', 'Cargos y pagos de la cuenta corriente'],
      ['Créditos comprados', 'Compras a crédito de los socios'],
      ['Deudas mes a mes', 'El saldo por mes'],
      ['Cuentas contables', 'Lo pendiente por categoría de cuota'],
    ],
    [50, 128]
  );
  m.steps([
    'Entrá a Saldos. En “Buscar por” completá lo que sepas: Nombre del socio, Apellido, DNI, Número de socio o Identificador de grupo familiar.',
    'Si hace falta, elegí el Estado (Habilitado o Deshabilitado) y la Categoría de cuota.',
    'Tocá Buscar y abrí al socio de la lista para ver el detalle. Para cobrar se usa la ficha (capítulo 5).',
  ]);
  m.box('warn', 'Corte LILA no es el saldo de hoy', 'Muchas cifras de estas pantallas vienen de los cortes de LILA y llevan la leyenda “Corte LILA” con su fecha. Son fotos de un día anterior al 1 de octubre de 2026. El saldo vivo del socio es el que figura en su ficha. Si un número no coincide con lo que dice la ficha, prevalece la ficha.');
  m.h2('Operar (solo Administración)');
  m.p('El puesto de Administración ve además una franja Operar con tres herramientas:');
  m.bullets([
    'Control de mora: quién venció, cuántos meses debe y cuánto. Desde ahí se manda el WhatsApp de vencimiento con el teléfono de la ficha.',
    'Importar cobranzas: se sube el Excel de cobros vivos y se procesa. Abajo queda el historial de importaciones, y cada una se puede revertir.',
    'Imputar eventos: carga a la cuenta del socio el cobro de un evento o de un alquiler (por ejemplo, una cena del club). Ese importe no entra en la deuda de cuota: la deuda de cuota es solo cuota y recargo.',
  ]);
  m.h2('Liquidar el mes');
  m.p('Debajo, el desplegable “Cuotas de [año]” lista un período por mes con su monto, la fecha de generación y el estado: Borrador, Pendiente, Procesada o Anulada. El día 1 de cada mes la liquidación se genera sola desde el padrón (entran las altas, no las bajas), y eso queda marcado “Generada el día 1”. Los botones a mano siguen disponibles.');
  m.steps([
    'Abrí “Cuotas de [año]” y buscá el mes en curso.',
    'Tocá Ver liquidación y revisá la cantidad de socios y el monto por categoría. La liquidación cobra una sola cuota por grupo familiar, la del titular, más los abonos de tenis de los integrantes. Vitalicio, fundador y comisión quedan en cero. Los descuentos y bonificaciones ya cargados se aplican en la liquidación vigente.',
    'Si hace falta rearmar el mes, tocá Cargar borrador, que lo actualiza desde el padrón.',
    'Tocá Generar. El diálogo “Generar cuotas” avisa que las cuotas no estarán disponibles hasta las 00 h de mañana y que quedan Pendiente. Mientras no pasen a Procesada se pueden editar; una vez Procesada no se editan ni se eliminan.',
    'Bajá el Excel y el PDF del período con los botones de la fila. El ícono del reloj abre el historial de quién generó o revirtió.',
  ]);
  m.box('warn', 'Si la liquidación salió mal', 'No la rehagas por tu cuenta. Reabrir una liquidación, volver un mes a borrador, cargar una nota de crédito o de débito y cambiar los montos de las categorías son del superadministrador. Avisale con el mes y el motivo.');
  m.box('tip', 'Una cuota por grupo, no por persona', 'La cuenta es del titular. Un adherente no suma cuota propia. Si un socio reclama porque “le cobraron dos veces”, mirá primero si en la liquidación figuran dos titulares en el mismo grupo.');
  m.p('Al pie de la pantalla hay un botón para activar o desactivar que los socios vean su cuenta corriente. Dejalo como está salvo que te lo indiquen.');
  m.p('Para el puesto de Pileta, Importar cobranzas, Imputar eventos, Control de mora y la liquidación no aparecen: la pantalla es solo de consulta.');

  /* ------------------------------------------------------------------ 9 */
  m.h1('9.  Débitos automáticos (solo Administración)', { n: '09' });
  m.p('Un débito automático cobra la cuota todos los meses de la tarjeta o de la cuenta del socio, sin que venga al mostrador. Hay tres circuitos: tarjeta con archivo a Prisma (Visa y Mastercard), cuentas con débito Galicia y Mercado Pago. Se trabajan en Gestión > Débitos, que tiene tres pestañas: Listados débitos, Galicia y Prisma.');
  m.h2('Listados de débitos');
  m.p('Es la planilla mensual de altas, bajas y cambios de tarjetas. Arriba muestra el total de la hoja del mes, crédito más débito, y las cantidades de Altas, Bajas y Padrón.');
  m.bullets([
    'Filtros: Mes, Hoja (Crédito o Débito), Sección (Padrón, Altas de tarjetas, Bajas de tarjetas, Cambios de tarjetas, Débitos para aplicación) y un buscador por socio, titular, tarjeta o nota.',
    'Botones: “Copiar mes anterior” arma el mes en curso a partir del anterior; “Subir Excel” importa la planilla de Listados de Débitos; “Excel” baja la hoja que estás mirando.',
    'Solapas: Listado, Alta en ficha, Baja en ficha e Historial.',
  ]);
  m.h2('Dar de alta un débito');
  m.steps([
    'En la solapa “Alta en ficha” elegí el Mes y buscá al titular por nombre, número de socio o DNI.',
    'Elegí el Tipo: Crédito automático o Débito automático.',
    'Completá N° tarjeta (13 a 19 dígitos, obligatorio), Tipo de tarjeta, Vto tarjeta (MM/AA, opcional), Titular y Nota si hace falta. El código de seguridad no se guarda.',
    'Tocá “Registrar alta”. Se anota en la ficha del socio y en la sección Altas de tarjetas del mes.',
  ]);
  m.p('Si el socio ya tiene débito automático, el botón queda desactivado y el aviso dice “ya tiene automático”: usá primero Baja en ficha.');
  m.h2('Dar de baja un débito');
  m.steps([
    'En la solapa “Baja en ficha” buscá al socio que sale del automático (la lista trae solo a quienes lo tienen).',
    'Revisá la fila de la planilla y tocá “Registrar baja en planilla”.',
    'Los movimientos del mes quedan en el Historial, con quién los hizo y cuándo.',
  ]);
  m.h2('Prisma: el archivo de la tarjeta');
  m.steps([
    'Entrá a la pestaña Prisma y elegí la marca: Visa Crédito, Visa Débito o Mastercard Crédito. Cada una muestra su identificador o dice “Sin identificador”.',
    'Si falta, completá el “Identificador de Prisma” (hasta 10 dígitos) y la “Cuenta bancaria”.',
    'Revisá “Débitos de esta marca” y “Monto”, y la vista previa de débitos. El importe de cada uno es el saldo de la cuenta corriente. Vitalicio, fundador y comisión no entran.',
    'Tocá “Generar archivo”. Se baja el .txt (DEBLIQC, DEBLIQD o DEBLIMC según la marca) y queda en la tabla, donde se puede volver a descargar.',
    'Cuando Prisma devuelve la rendición, cargala en “Archivo de respuesta”: la lista muestra el nombre, la cantidad de registros y la fecha.',
  ]);
  m.box('warn', 'Prisma imputa de nuevo', 'No generes dos veces el mismo mes: Prisma vuelve a imputar. Y sin identificador el archivo sale solo con encabezado y cierre, sin socios: completá el identificador antes de generar.');
  m.h2('Galicia: débito por CBU');
  m.p('La pestaña Galicia arma el lote del mes. Arriba cuenta Programados, Enviados y Acreditados, con el importe del mes. Para sumar un débito elegí el Socio, escribí el Importe y tocá “Agregar al lote”. La tabla muestra Período, Socio, CBU, Importe y Estado, y la columna Gestión cambia el estado.');
  m.box('warn', 'Datos de tarjetas y cuentas', 'El número de tarjeta y el CBU son datos de pago. Cargalos solo en estas pantallas, nunca los anotes en papeles, WhatsApp ni planillas sueltas, y no los leas en voz alta en el mostrador.');

  /* ----------------------------------------------------------------- 10 */
  m.h1('10.  Altas, bajas, claves y tarjeta virtual', { n: '10' });
  m.p('Antes este perfil daba de alta y de baja a los socios. Ya no: esas tareas son del administrador y del superadministrador. Vos buscás, cobrás y atendés; cuando el trámite es de ellos, pasás los datos.');
  m.table(
    ['Tarea', 'Quién la hace', 'Qué hacés vos'],
    [
      ['Alta de un socio titular o de un adherente', 'Administrador, superadministrador', 'Anotar nombre completo, DNI, celular, categoría y disciplinas, y pasarlos'],
      ['Solicitudes de internet (Quiero asociarme, Acceso al portal)', 'Administrador, superadministrador', 'Avisar que hay pedidos pendientes. No des ninguna clave por tu cuenta'],
      ['Usuario y contraseña del portal (Credenciales)', 'Administrador, superadministrador', 'Pedirlo. El sistema responde que solo administración puede crear o modificar perfiles'],
      ['Editar la ficha, la categoría o el grupo familiar', 'Administrador, superadministrador', 'Pasar el dato correcto y el motivo'],
      ['Suspender, reactivar o dar de baja', 'Administrador, superadministrador', 'Pasar el pedido con el motivo. La baja rige el 1.º del mes siguiente'],
    ],
    [60, 46, 72]
  );
  m.box('warn', 'Botones que ves pero no son tuyos', 'En el menú de los tres puntos de cada fila aparecen Credenciales, Suspender o Activar, y Eliminar. Con este perfil no hacen nada o el sistema los rechaza. No insistas ni pruebes con el usuario de otra persona.');
  m.h2('Ver la tarjeta virtual');
  m.p('En la fila del socio, menú de los tres puntos > Tarjeta. Muestra la credencial digital con nombre, número de socio y el código QR firmado. En la ficha, la solapa Tarjeta muestra lo mismo. Si un socio no puede abrir su celular, podés mostrarla desde acá.');
  m.box('tip', 'Si la persona no está en el padrón', 'Antes de pasarle un alta al administrador, buscá por DNI y por apellido: si ya figura, la ficha existe y no hay que cargarla otra vez. Puede estar de baja o suspendida.');

  /* ----------------------------------------------------------------- 11 */
  m.h1('11.  Reservas', { n: '11' });
  m.p('Operación > Reservas es el “Libro de Reservas” del club. A diferencia del socio, que solo ve si un turno está libre u ocupado, acá ves quién reservó, cuánto y en qué estado está.');
  m.steps([
    'Elegí el día en el calendario del mes. Con las flechas pasás de mes y con “Hoy” volvés a la fecha actual.',
    'La tabla lista las reservas de ese día con Socio, Instalación, Fecha, Horario, Importe y Estado.',
    'Los estados son Confirmada, Pendiente y Cancelada.',
    'En la columna Gestión: “Aprobar” confirma una reserva pendiente, “Anular” cancela una que no está cancelada y “Reactivar” vuelve a confirmar una cancelada.',
  ]);
  m.h2('La seña del 50 %');
  m.p('Toda reserva de una instalación (salón, Espacio Verde, canchas con precio) se confirma con una seña del 50 % del precio total. El socio ve el total, la seña obligatoria y el resto que queda en su cuenta. Si paga con Mercado Pago o por transferencia, el importe es el de la seña, no el total.');
  m.bullets([
    'La reserva es aparte de la cuota social: no es mora de cuota, no mezcla la liquidación ni lleva el recargo del 10 %.',
    'La seña es siempre del 50 %. No inventes otro porcentaje por espacio ni por socio.',
    'El resto queda pendiente en la cuenta del titular hasta saldarlo. El alquiler se carga a esa cuenta desde Cuotas > Imputar eventos (capítulo 8).',
  ]);
  m.h2('Reglas que el socio puede chocar');
  m.bullets([
    '“Las reservas las hace el titular de la cuenta”: es un adherente. Que reserve el titular.',
    '“Ese turno ya está reservado” o “ya empezó”: elegir otro horario.',
    'Cada espacio fija hasta cuántos días antes se reserva, las horas mínimas de anticipación, el máximo de invitados y qué categorías pueden. Si un socio no puede reservar, la causa suele estar en la regla del espacio.',
    'Con Zonda declarado se suspende lo que está al aire libre.',
  ]);
  m.box('tip', 'No fuerces una reserva', 'No cargues una reserva a mano para saltarte una regla. Si la regla del espacio está mal, avisá a quien administra el espacio. Y una fiesta o una cena del club no va acá: es un evento con inscripción (capítulo 14).');

  /* ----------------------------------------------------------------- 12 */
  m.h1('12.  Pileta: la puerta (Entrada pileta)', { n: '12' });
  m.p('Entrada pileta es la pantalla de la puerta. No es el molinete de la sede. Tiene un buscador grande y devuelve un cartel claro: puede entrar o no, y por qué. Se abre desde Operación > Entrada pileta (o directamente en /entrada-pileta). Arriba dice cuántos socios asistieron hoy.');
  m.h2('Cada ingreso, paso a paso');
  m.steps([
    'Escribí en “Buscar socio” el nombre, el DNI o el número. No hace falta esperar a que cargue todo el padrón.',
    'En la lista cada socio trae etiquetas: “Canon pago” o “Canon impago”, “Apto médico” o “Sin apto”, “Cuota al día” o “Debe $…”, y “En mora · no paga pileta” si corresponde. Tocá al socio.',
    'Mirá el cartel grande. Hay tres: PUEDE INGRESAR (canon pago y apto médico vigente), ASISTIÓ (ya quedó anotado hoy) y NO INGRESA, que trae debajo el primer motivo.',
    'Abajo se ve el resumen: Cuenta, Cuota social, Canon pileta, Apto médico, Hoy en pileta e Invitados hoy.',
    'Ojo: un socio que todavía no pagó el canon ve NO INGRESA con el motivo “No pagó el canon de pileta”. No es un rechazo, es que falta cobrar. Si no hay otro obstáculo, debajo aparecen los medios de pago.',
    'Elegí Efectivo o Mercado Pago. En efectivo tocá “Cobrar canon e ingresar” con el importe del día. Con Mercado Pago tocá “Cobrar $… con QR”: el socio paga con el QR y el ingreso se anota cuando se aprueba.',
    'Cuando el cobro entra, el cartel pasa a ASISTIÓ y dice “Anotado en ingresos de hoy”.',
    'Tocá Cerrar (o la tecla Esc) para limpiar la búsqueda y atender al siguiente.',
  ]);
  m.p('Cada canon cobrado se anota en dos lugares: en la caja y en la cuenta del socio. En la cuenta es solo un registro del pase: no suma ni resta de lo que debe de cuota.');
  m.h2('Cuándo NO ingresa');
  m.table(
    ['Cartel o motivo', 'Qué hacer'],
    [
      ['El socio está de baja o suspendido', 'No ingresa. Que lo resuelva el administrador'],
      ['La cuenta del socio no está habilitada', 'No ingresa. Derivalo a Administración'],
      ['Sin apto médico o vencido', 'Se carga el apto (capítulo 13). Sin apto no se habilita'],
      ['En mora · no abonó la cuota del mes', 'No ingresa ni paga pileta hasta regularizar la cuota. Que pase por Administración o pague en Mi Cuenta'],
      ['Ya ingresó', 'No se cobra dos veces. Aparece “Anotado en ingresos de hoy”'],
    ],
    [78, 100]
  );
  m.p('Importante: estar en mora impide pagar pileta en cualquier época del año. Además, en temporada de pileta (de diciembre a marzo), desde el día 10, quien no pagó la cuota del mes tampoco ingresa al club. En un grupo familiar vale la mora del titular. Vitalicio, fundador y comisión no deben cuota, así que nunca aparecen con deuda.');
  m.box('ok', 'La caja ya no se abre a mano', 'La caja está siempre abierta: se asegura sola al entrar a la pantalla. Si aparece “Asegurando la caja para cobrar el canon…”, esperá unos segundos; si no sigue, tocá Reintentar. Ya no existe el aviso “La caja del día está cerrada”.');
  m.box('tip', 'El botón Asistió', 'Anota que el socio estuvo hoy sin cobrar canon: queda como “Asistió” en Ingresos de hoy, con importe cero. No sirve para cobrar. Usalo solo cuando tu responsable lo indique y no lo uses para saltar un NO INGRESA.');

  /* ----------------------------------------------------------------- 13 */
  m.h1('13.  Pileta: la caja, el apto y los invitados', { n: '13' });
  m.p('Operación > Pileta (/pileta) es la caja de la pileta: el canon cobrado, los ingresos del día, el apto médico y los invitados. Arriba dice “Sede Rivadavia · Canon, apto médico y socios” y muestra tres números: Socios hoy, Invitados y Canon cobrado.');
  m.h2('1. La caja siempre abierta');
  m.steps([
    'Al entrar a Pileta, el botón de arriba dice “Caja abierta”: no hay nada que abrir ni cerrar por turno.',
    'Si dice “Asegurando caja…”, esperá unos segundos. Si queda así, tocá “Asegurar caja”.',
    'Cada Habilitar cobra el canon en la caja y lo anota en la cuenta del socio. La caja de pileta es distinta de la de Tesorería: no las mezcles.',
  ]);
  m.h2('2. Habilitar a un socio');
  m.steps([
    'En “Apellido, nombre, DNI o Nº de socio…” buscá al socio. Las etiquetas de la lista (“Hoy”, “Mora”) te adelantan el estado. Tocá al socio.',
    'Se abre su ficha con cuatro controles: Estado del socio, Cuota social, Canon pileta de hoy y Revisación médica.',
    'Si el socio está en mora aparece “En mora. No puede pagar pileta hasta regularizar la cuota social” y no se ofrece el cobro.',
    'Si no hay obstáculos, elegí Efectivo o Mercado Pago.',
    'Efectivo: tocá “Habilitar” con el importe del día. Queda el asiento en Caja General, el ingreso a tu nombre y el registro en la cuenta del socio. Mercado Pago: tocá “Cobrar $… con QR”; el socio paga con el QR y, cuando Mercado Pago confirma, entra el canon y el ingreso.',
  ]);
  m.h2('3. Apto médico');
  m.steps([
    'En el control “Revisación médica” se ve si está vigente y cuándo vence. La validez la fija la Configuración del club (hoy 365 días).',
    'Si falta o está vencido, tocá “Subir revisación”, elegí la foto o el PDF del certificado y esperá a que se cargue. El control pasa a verde y ya se puede habilitar.',
  ]);
  m.h2('4. Invitados del socio');
  m.p('Después de habilitar al socio aparece “Invitados del socio”, con el tope por día y lo que cuesta cada uno (hoy hasta 3 por día).');
  m.steps([
    'Escribí el “Nombre del invitado” (apellido y nombre).',
    'Elegí Efectivo o Mercado Pago.',
    'Tocá “Sumar invitado” con el importe. Si llegaste al tope, el botón se desactiva.',
  ]);
  m.h2('5. Corregir un error');
  m.p('A la derecha, “Ingresos de hoy” lista a todos los que entraron, con el importe y el medio. Si cargaste a alguien por error, usá el botón Revocar de esa fila. Queda como “revocado” en el historial.');
  m.box('warn', 'No inventes el pase', 'Si falta el apto y tu responsable no te autorizó a pasar sin él, no se habilita. Y si el socio paga con Mercado Pago y el QR ya quedó aprobado, el cobro está registrado: no lo cargues también a mano.');
  m.box('ok', 'Lo mismo en las dos pantallas', 'Entrada pileta y Pileta usan las mismas reglas. La puerta es más rápida para el ingreso; la caja es la que tiene el apto, los invitados y las revocaciones.');

  /* ----------------------------------------------------------------- 14 */
  m.h1('14.  Atención al socio: reclamos, mensajes, novedades, encuestas, alertas y fiestas', { n: '14' });
  m.h2('Reclamos');
  m.p('Comunicación > Reclamos es el buzón de pedidos, solicitudes y reclamos. Cada uno tiene un estado: Pendiente, En Proceso o Resuelto.');
  m.steps([
    'Abrí el reclamo y leé el pedido.',
    'Si corresponde, elegí a quién se lo asignás en “Asignar Tarea a Empleado de Guardia”.',
    'Tocá “Marcar En Proceso” mientras se trabaja en el tema.',
    'Escribí la “Respuesta Oficial del Club” y tocá “Resolver e Informar”: el socio recibe la respuesta por mensaje.',
  ]);
  m.p('Los reclamos de un socio también se ven en la solapa Reclamos de su ficha.');
  m.h2('Mensajería');
  m.bullets([
    'Mail: Recibidos (lo que llega a socios@jockeyclubsj.com.ar) y Enviados (lo que salió desde el sistema).',
    'MD: los mensajes internos hacia administración. Ahí llegan los avisos de transferencia con comprobante (capítulo 7).',
    'WhatsApp: “Cobranza vía WhatsApp”. Elegí la “Plantilla de WhatsApp” y mirá la lista “Socios con cuotas pendientes”; el mensaje sale con el teléfono de la ficha.',
  ]);
  m.p('Para escribirle a un socio o a todo el padrón usá Mensajes > Redactar: elegí el Destinatario (buscá un socio por nombre, credencial o teléfono, o “Todos los socios”), el Asunto, escribí el Mensaje y tocá “Enviar mensaje”. La IA puede redactar el texto, y se envía por mensaje interno, por mail o por los dos.');
  m.box('warn', 'Releé antes de enviar', 'Un mensaje a “Todos los socios” llega a todo el padrón y no se puede retirar. Releé el texto, el asunto y los importes antes de enviar.');
  m.h2('Novedades, Encuestas y Alertas');
  m.bullets([
    'Novedades: “Nueva noticia”. Cargá Título, Categoría, Autor, Bajada, Cuerpo y la portada. Podés guardar un borrador, programar la publicación o usar “Publicar ahora”. El socio la ve en Novedades.',
    'Encuestas: “Nueva encuesta”. Escribí la Pregunta, elegí la Categoría y cargá las Opciones de respuesta (las dos primeras son obligatorias); después tocá “Publicar encuesta”. Con “Cerrar Consulta” o “Abrir Consulta” se cierra o se reabre la votación. Es una consulta al padrón, no un formulario interno.',
    'Alertas: completá Título, Mensaje, Severidad (Informativa, Advertencia o Crítica) y Audiencia (Todos, Socios, Personal o Administración) y tocá “Publicar alerta”. Una alerta viva aparece como ACTIVA y se ve en Inicio. No dejes una alerta de Zonda publicada cuando el viento ya pasó.',
  ]);
  m.h2('Fiestas');
  m.p('Club > Fiestas es para eventos con inscripción (una cena del club, un torneo), no para reservar una cancha. Con “Nuevo evento” cargás Título, Categoría (Fiesta, Deportes, Institucional o Hípica), Inicio, Cupo, Precio de entrada y Descripción, y tocás “Crear evento”. Para inscribir a un socio, buscalo por nombre, número o DNI. Cargar el cobro del evento en la cuenta del socio es “Imputar eventos”: lo hace el puesto de Administración desde Cuotas (capítulo 8); en la pileta no aparece.');
  m.h2('Profesores');
  m.p('Administración > Profesores es solo para mirar. Ves quién dicta cada disciplina, pero el alta, la edición y las claves de los profesores las hacen el administrador y el superadministrador. El profesor toma asistencia en su propia pantalla, no en el panel.');

  /* ----------------------------------------------------------------- 15 */
  m.h1('15.  Lo que este perfil no puede hacer', { n: '15' });
  m.p('Estas restricciones son parte del diseño: separan el mostrador de la tesorería y de la seguridad. Si te piden algo de esta lista, no es que el sistema falle: derivalo.');
  m.table(
    ['Tarea', 'Quién la hace', 'Qué hacer vos'],
    [
      ['Alta, edición, suspensión y baja de socios; solicitudes de internet; usuario y clave del portal', 'Administrador, superadmin', 'Pasar los datos y el motivo (capítulo 10)'],
      ['Perdonar el recargo del 10 %', 'Nadie en el mostrador: el recargo se cobra siempre', 'Explicarle al socio que se cobra con la cuota'],
      ['Borrar un recargo ya cobrado', 'Superadmin, con motivo', 'Anotar socio, cobro y motivo y pasarlo'],
      ['Anular un cobro mal cargado', 'Caja, Tesorería, contador, superadmin, con motivo', 'No cargar otro cobro. Pasar socio, importe, medio y motivo'],
      ['Reabrir una liquidación, volver un mes a borrador, notas de crédito o débito, cambiar montos de categorías', 'Superadmin', 'Avisar el mes y el motivo (capítulo 8)'],
      ['Liquidar, Importar cobranzas, Imputar eventos, Control de mora', 'Administración, contador, superadmin. Pileta solo consulta Saldos', 'Si sos de pileta, pedirlo a Administración'],
      ['Débitos (Prisma, Galicia, Listados)', 'Administración, administrador, contador, superadmin', 'Si sos de pileta, pedirlo a Administración'],
      ['Bonificaciones y descuentos de socios', 'Superadmin', 'Pasar el pedido'],
      ['Planes de tarjeta, tolerancia de pago, Mercado Pago, tarifas y Zonda', 'Superadmin y administrador (Configuración)', 'Pedirlo a quien administra el sistema'],
      ['Contabilidad, libros, caja general, gastos, proveedores, Sin identificar', 'Contador, superadmin', 'Ninguna'],
      ['Ingresos y Acceso QR (la puerta de la sede)', 'Portería, caja, personal, administrador', 'La puerta de la pileta sí es tuya (capítulo 12)'],
      ['Crear o editar usuarios y perfiles; dar o quitar roles', 'Superadmin (el administrador solo da el rol Profesor)', 'Pedirlo al superadmin'],
      ['Alta o edición de profesores', 'Administrador, superadmin', 'Pedirlo al administrador'],
    ],
    [62, 52, 64]
  );
  m.box('tip', 'Cuando no sepas a quién preguntar', 'Socios y trámites: Secretaría. Caja y números: Tesorería. Usuarios que no entran: el superadministrador. Dudas de “cómo se hace”: Jev, o IA > Manual en el panel.');

  /* ----------------------------------------------------------------- 16 */
  m.h1('16.  Si algo no anda', { n: '16' });
  m.table(
    ['Qué ves', 'Qué suele ser', 'Qué probar'],
    [
      ['“Marcá al menos un mes a cobrar”', 'Ningún mes quedó tildado en Meses del recibo', 'Tildá al menos un mes'],
      ['“Adjunte el comprobante de la transferencia” o “de la tarjeta”', 'Falta el archivo', 'Adjuntá la foto o el PDF'],
      ['“Elegí el plan con la tarjeta”', 'Hay planes activos y no elegiste uno', 'Elegí el plan en el desplegable'],
      ['“No hay planes activos”', 'El superadmin no cargó planes de tarjeta', 'Se puede registrar igual. Avisá que se carguen en Configuración'],
      ['“El pago mixto necesita al menos dos medios con importe”', 'Una línea del mixto quedó en cero', 'Cargá importe en dos medios, o cobrá con un solo método'],
      ['La suma del mixto sale en rojo (“falta $…”)', 'Los importes no dan el total', 'Corregí hasta que diga “ok”'],
      ['Desglose del comprobante en rojo', 'El importe leído difiere del cobro más que la tolerancia', 'Revisá que sea el comprobante correcto y corregí el dato si Gemini leyó mal'],
      ['No aparece el botón Cobrar', 'No tiene saldo, es exento o es adherente sin titular', 'Revisá la categoría y la cabecera de la ficha'],
      ['“Esta categoría no abona cuota social”', 'Vitalicio, fundador o comisión', 'Es lo normal: no se les cobra'],
      ['No ves el botón Anular ni “Borrar recargo” en Movimientos', 'No son de este perfil', 'Capítulo 15'],
      ['Mercado Pago no acredita', 'Mercado Pago todavía no confirmó', 'Esperá la confirmación. No cobres de nuevo. Avisá a Tesorería si pasan los minutos'],
      ['Credenciales, Suspender o Eliminar no funcionan', 'Son del administrador', 'Capítulo 10. Pasá el pedido'],
      ['“Asegurando la caja para cobrar el canon…”', 'La pantalla de pileta está dejando la caja lista', 'Esperá unos segundos o tocá Reintentar / Asegurar caja'],
      ['El botón Habilitar está gris', 'Esperando caja, socio en mora, sin apto o ya ingresó hoy', 'Mirá los motivos que aparecen debajo del botón'],
      ['El archivo de Prisma sale sin socios', 'Falta el Identificador de Prisma', 'Cargalo y generá de nuevo'],
      ['El socio no aparece en la búsqueda', 'El padrón sigue cargando o el dato está mal escrito', 'Esperá a que termine, probá con DNI o número y revisá la ortografía'],
      ['El número de un saldo no coincide', 'Es un Corte LILA de otra fecha', 'Mirá la fecha del corte. El saldo vivo está en la ficha'],
      ['Entrás al panel y caés en la puerta de la pileta', 'Es el comportamiento del Operario de pileta', 'Tocá Panel o usá el menú para ir a otra sección'],
      ['Una pantalla no aparece en el menú', 'Tu perfil no la abre', 'Capítulo 15. Pedí el permiso a quien corresponda; no uses el usuario de otra persona'],
      ['La pantalla queda “Cargando…”', 'Internet o sesión colgada', 'Recargá. Si sigue, Salir y volver a entrar'],
    ],
    [56, 52, 70]
  );

  /* ----------------------------------------------------------------- 17 */
  m.h1('17.  Jornada tipo y palabras que vas a ver', { n: '17' });
  m.h2('Administración: un día');
  m.bullets([
    'Al llegar: Inicio, franja del vencimiento, alertas y agenda del día. En Cuotas, la franja de socios en mora y que el mes esté generado.',
    'Durante el día: buscar, cobrar desde la ficha con el medio real (efectivo, transferencia, tarjeta, mixto o Mercado Pago), aprobar o anular reservas, responder reclamos y mensajes.',
    'Cuando toca: Control de mora, Importar cobranzas, Imputar eventos y, a mes vencido, los Listados y el archivo de Débitos.',
    'Antes de irte: revisá que no queden reclamos sin atender y los trámites que le debés al administrador. Salí del sistema.',
  ]);
  m.h2('Pileta: un día');
  m.bullets([
    'Al llegar: Pileta y verificar que diga Caja abierta. No hay nada que abrir.',
    'En la puerta: buscar, mirar el cartel, cobrar canon, cargar apto si falta y sumar invitados.',
    'Errores: Revocar en Ingresos de hoy.',
    'Antes de irte: mirá los tres números de arriba (Socios hoy, Invitados, Canon cobrado) y comparalos con lo que cobraste. Salí del sistema.',
  ]);
  m.h2('Palabras del club');
  m.table(
    ['Palabra', 'En criollo'],
    [
      ['Padrón', 'La lista oficial de socios'],
      ['Ficha', 'La pantalla completa de una persona'],
      ['Titular / adherente', 'El titular lleva la cuenta del grupo; el adherente es el familiar a su cargo y no paga ni reserva por su cuenta'],
      ['Exento', 'Vitalicio, fundador o comisión: no abona cuota social'],
      ['AMET', 'Categoría con vencimiento el 18 y tarifa con 2,5 % menos; no lleva recargo'],
      ['Mora', 'Cuota vencida y sin pagar, desde el día siguiente al vencimiento (el 11; AMET, el 19)'],
      ['Recargo', '10 % sobre la cuota de cada mes en mora, solo familiar e individual. Se cobra siempre'],
      ['Saldo a favor', 'Plata del socio que quedó de más; se descuenta sola en el próximo cobro'],
      ['Meses del recibo', 'Los meses atrasados que entran en un mismo cobro'],
      ['Plan de tarjeta', 'El acuerdo del socio con su tarjeta (por ejemplo, 3 cuotas). No financia la deuda del club'],
      ['Pago mixto', 'Un cobro dividido en dos o más medios: efectivo, transferencia y tarjeta'],
      ['Desglose del comprobante', 'Importe, fecha, banco o tarjeta y referencia que Gemini lee del archivo adjunto'],
      ['Comprobante automático', 'El PDF que el sistema manda solo al socio apenas el cobro se acredita'],
      ['Borrador / Pendiente / Procesada', 'Los estados de una liquidación mensual. Procesada ya no se edita'],
      ['Débito automático', 'Cuota que se cobra sola de la tarjeta (Prisma), de la cuenta (Galicia) o de Mercado Pago'],
      ['Prisma', 'El procesador de tarjetas Visa y Mastercard: el club le manda un archivo .txt de débitos'],
      ['Seña', 'El 50 % del precio de una reserva; el resto queda en cuenta, aparte de la cuota'],
      ['Canon', 'Lo que se paga por usar la pileta ese día'],
      ['Apto', 'La revisación médica para usar la pileta'],
      ['Caja', 'La caja general: está siempre abierta, no se abre ni se cierra por turno'],
      ['Temporada', 'De diciembre a marzo, cuando rige el bloqueo de ingreso por mora'],
      ['Corte LILA', 'Foto de un Excel de un día anterior al 1 de octubre de 2026, no el estado de hoy'],
      ['Trazabilidad', 'El historial de quién cambió qué en la ficha y con qué motivo'],
    ],
    [46, 132]
  );
  m.p('Gracias por cuidar los datos de los socios. El mostrador funciona bien cuando cada uno usa su perfil, cobra con el medio real y deja siempre el motivo de lo que cambia.');

  /* ----------------------------------------------------------------- 18 */
  m.h1('18.  Qué cambió en esta edición', { n: '18' });
  m.p('Si leíste la edición 1.1 (21 de octubre de 2026), esto es lo nuevo:');
  m.table(
    ['Tema', 'Antes', 'Ahora'],
    [
      ['Medios de cobro', 'Efectivo, transferencia y Mercado Pago', 'Se suman Tarjeta (con plan) y Pago mixto (efectivo, transferencia y tarjeta en un mismo cobro)'],
      ['Meses a cobrar', 'Un solo importe', 'Meses del recibo: se tildan los meses atrasados que entran en el cobro'],
      ['Saldo a favor', 'No se mostraba', 'Recuadro A favor; se descuenta solo en el próximo cobro'],
      ['Comprobante', 'Foto o PDF obligatorio', 'Gemini lo lee y arma el desglose (importe, fecha, banco o tarjeta, referencia); se puede corregir'],
      ['Recibo', 'PDF por mensaje interno', 'PDF por mail real y mensaje al portal, solo y apenas se acredita el cobro'],
      ['Recargo', 'Lo perdonaba Tesorería', 'Se cobra siempre. Borrarlo ya cobrado es solo del superadmin, con motivo'],
      ['Anular un cobro', 'Tesorería, contador y superadmin', 'Caja, Tesorería, contador y superadmin, siempre con motivo'],
      ['Transferencias', 'Cobro desde la ficha', 'Entra directo como cuota; sin socio identificado va a “Sin identificar” (Tesorería)'],
      ['Puestos', 'Administración y Pileta veían lo mismo', 'Administración suma Cuotas con liquidación y Débitos; Pileta ve Saldos de consulta'],
      ['Liquidación del mes', 'Solo contador y superadmin', 'Administración la ve, la genera y baja el Excel y el PDF; el día 1 se genera sola'],
      ['Débitos automáticos', 'No estaban en este manual', 'Listados de débitos (altas y bajas), archivo de Prisma y lote de Galicia'],
      ['Alta, baja y claves', 'Las hacía este perfil', 'Solo administrador y superadmin; este perfil consulta y cobra'],
      ['Caja', 'Había que abrir la caja del día en Pileta', 'Siempre abierta: se asegura sola y no se cierra'],
      ['Canon de pileta', 'Solo en caja', 'En caja y en la cuenta del socio, sin tocar su deuda de cuota'],
      ['Reservas', 'Se pagaba el precio completo', 'Seña obligatoria del 50 %; el resto queda en cuenta, aparte de la cuota'],
    ],
    [32, 54, 92]
  );
}
