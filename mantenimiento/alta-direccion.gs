/****************************************************************************************
 * ZAPHIRA — Alta manual de un usuario, desde el editor de Apps Script
 * Calcuta Consulting · 07/09/2026
 *
 * ESTE ARCHIVO NO ES DEL FRONTEND. Va pegado en el proyecto Apps Script (el mismo donde
 * viven Code.gs y Accesos.gs). Está versionado acá porque el proyecto Apps Script no tiene
 * repo propio y, si no, esto se pierde.
 *
 * QUÉ RESUELVE. El alta normal se hace desde Configuración en el tablero, pero eso obliga a
 * entrar con un usuario de Dirección — y la clave de 'direccion' es de la clienta. Estas
 * funciones hacen lo mismo que opAlta_() y opReset_() pero SIN token: se corren a mano desde
 * el editor, una vez, y listo. No hay que entrar al tablero ni tocarle la clave a nadie.
 *
 * CÓMO SE USA
 *   1) Editor de Apps Script ▸ Archivos ▸ + ▸ Secuencia de comandos ▸ pegar esto.
 *      Necesita Accesos.gs cargado: reusa tabUsr_, filas_, headIdx_, setCelda_, nuevoSalt_,
 *      hashClave_, CLAVE_GENERICA, COLS_USR y TAB_USR. No duplica nada de eso a propósito:
 *      si mañana cambia el hash o el nombre de una columna, esto lo sigue solo.
 *   2) Completar las constantes de abajo (al menos el apellido de Ariel).
 *   3) Ejecutar ▸ altaDireccion ▸ mirar el Registro de ejecución.
 *
 * CORRERLA DOS VECES NO ROMPE NADA. Si el usuario ya existe, no lo duplica ni le pisa la
 * clave: avisa en el log y corta. Para devolverle la clave inicial está resetearClaveDe().
 *
 * NO HACE FALTA REPUBLICAR EL DEPLOY: esto escribe en la planilla, no cambia la API.
 ****************************************************************************************/

/* Datos del alta. 'usuario' es con lo que entra (minúsculas, 3 a 24 caracteres).
   'nombre' es lo que se muestra en el tablero: ponele el apellido. */
var ALTA_USUARIO = 'ariel';
var ALTA_NOMBRE  = 'Ariel';
var ALTA_ROL     = 'direccion';   // 'direccion' ve todo y administra accesos · 'vendedora' ve lo suyo
var ALTA_ODOO    = '';            // sólo para rol vendedora: nombre EXACTO como figura en Odoo
/* Clave inicial. Vacío = la genérica del sistema (CLAVE_GENERICA). En cualquiera de los dos
   casos queda marcado 'cambiar', así que el tablero se la hace cambiar en el primer ingreso
   y nunca queda como su contraseña real. */
var ALTA_CLAVE   = '';

/* ---------------------------------------------------------------------------------------
   Ejecutar esta. Da de alta a la persona configurada arriba.
   --------------------------------------------------------------------------------------- */
function altaDireccion() {
  return altaManual_(ALTA_USUARIO, ALTA_NOMBRE, ALTA_ROL, ALTA_ODOO, ALTA_CLAVE);
}

/* Alta sin token, con las MISMAS validaciones que opAlta_(). Se replican en vez de llamar a
   opAlta_ porque esa función arranca pidiendo un token de Dirección, que es justamente lo que
   acá no tenemos. Cualquier cambio en las reglas de opAlta_ hay que reflejarlo también acá. */
function altaManual_(usuario, nombre, rol, vendedora, clave) {
  var u   = String(usuario || '').trim().toLowerCase();
  var nom = String(nombre || '').trim();
  var ven = String(vendedora || '').trim();
  var cl  = String(clave || '') || CLAVE_GENERICA;
  var r   = (rol === 'direccion') ? 'direccion' : 'vendedora';

  if (!/^[a-z0-9._-]{3,24}$/.test(u))
    throw new Error('El usuario admite 3 a 24 letras, números, punto, guion o guion bajo. Llegó: "' + u + '".');
  if (!nom) throw new Error('Falta el nombre.');
  // El '|' separa los campos del payload del token: un nombre con '|' rompe el login de esa persona.
  if (nom.indexOf('|') >= 0 || ven.indexOf('|') >= 0)
    throw new Error('Ni el nombre ni el nombre de Odoo pueden contener el carácter "|".');
  if (r === 'vendedora' && !ven)
    throw new Error('Para rol vendedora hay que poner el nombre EXACTO con el que figura en Odoo, ' +
                    'o entra y no ve ninguna venta.');
  if (cl.length < 8) throw new Error('La clave inicial tiene que tener al menos 8 caracteres.');

  // Mismo lock que usa el guardado de objetivos: evita pisar un alta hecha desde el tablero
  // en el mismo momento.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Hay otra escritura en curso. Probá de nuevo en unos segundos.');
  try {
    var sh = tabUsr_(), existe = null;
    filas_(sh).forEach(function (f) {
      if (String(f.usuario).trim().toLowerCase() === u) existe = f;
    });
    if (existe) {
      Logger.log('NO SE HIZO NADA: "' + u + '" ya existe (fila ' + existe._fila + ', rol ' + existe.rol +
                 ', ' + (existe.activo === false ? 'DESACTIVADO' : 'activo') + ').\n' +
                 'Para devolverle la clave inicial: resetearClaveDe("' + u + '").');
      return {ok: false, error: 'El usuario ya existe.'};
    }

    // Se escribe por NOMBRE de columna, nunca por posición: si alguien movió una columna a mano,
    // escribir por índice corrompería las filas en silencio.
    var salt = nuevoSalt_(), idx = headIdx_(sh);
    var ancho = Math.max(sh.getLastColumn(), COLS_USR.length), fila = [];
    for (var i = 0; i < ancho; i++) fila.push('');
    var poner = function (c, v) { if (c in idx) fila[idx[c]] = v; };
    poner('usuario', u);   poner('nombre', nom);  poner('rol', r);   poner('vendedora', ven);
    poner('hash', hashClave_(cl, salt));          poner('salt', salt);
    poner('cambiar', true); poner('activo', true); poner('ultimo_ingreso', '');
    sh.appendRow(fila);

    // Se relee y se valida la clave contra lo que quedó guardado. Es el chequeo que detecta el
    // único modo de falla que importa: que el encabezado no tenga alguna columna y el hash haya
    // ido a parar a otro lado. Sin esto, el error recién aparecería cuando la persona no puede entrar.
    var check = null;
    filas_(tabUsr_()).forEach(function (f) {
      if (String(f.usuario).trim().toLowerCase() === u) check = f;
    });
    if (!check || hashClave_(cl, check.salt) !== String(check.hash)) {
      throw new Error('La fila de "' + u + '" se escribió pero la clave no valida al releerla. ' +
                      'Revisá el encabezado de la pestaña "' + TAB_USR + '" (tiene que tener: ' +
                      COLS_USR.join(' · ') + ') y borrá esa fila antes de reintentar.');
    }

    Logger.log('LISTO ✓  "' + nom + '" (' + u + ') queda con rol ' + r +
               (r === 'direccion' ? ' — ve todo y administra accesos.' : ' — ve sólo "' + ven + '".') +
               '\nEntra con la clave: ' + cl +
               '\nEl tablero se la va a hacer cambiar en el primer ingreso.' +
               (r === 'vendedora' ? '\nCorré verificarUsuarios() para confirmar que el nombre matchea Odoo.' : ''));
    return {ok: true, clave: cl};
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------------------------------
   Devuelve un usuario a la clave genérica, sin entrar al tablero. Mismo efecto que el botón
   "Resetear clave" de Configuración. Sin argumento resetea al de ALTA_USUARIO, así se puede
   ejecutar directo desde el menú del editor (que llama a las funciones sin parámetros).
   --------------------------------------------------------------------------------------- */
function resetearClaveDe(usuario) {
  var u = String(usuario || ALTA_USUARIO || '').trim().toLowerCase();
  var sh = tabUsr_(), fila = null;
  filas_(sh).forEach(function (f) { if (String(f.usuario).trim().toLowerCase() === u) fila = f; });
  if (!fila) { Logger.log('No existe ningún usuario "' + u + '".'); return null; }
  var salt = nuevoSalt_();
  setCelda_(sh, fila._fila, 'salt', salt);
  setCelda_(sh, fila._fila, 'hash', hashClave_(CLAVE_GENERICA, salt));
  setCelda_(sh, fila._fila, 'cambiar', true);
  Logger.log('"' + u + '" vuelve a la clave "' + CLAVE_GENERICA + '" y la tiene que cambiar al entrar.');
  return CLAVE_GENERICA;
}

/* ---------------------------------------------------------------------------------------
   Estado de los accesos en el log, para confirmar cómo quedó todo sin abrir la planilla.
   No muestra hash ni salt.
   --------------------------------------------------------------------------------------- */
function listarAccesos() {
  var out = filas_(tabUsr_()).map(function (f) {
    return (f.activo === false ? '✗ ' : '· ') + f.usuario +
           '  [' + f.rol + ']  ' + f.nombre +
           (f.vendedora ? '  → ' + f.vendedora : '') +
           '  · ' + (f.ultimo_ingreso || 'nunca entró') +
           (f.cambiar === true || String(f.cambiar).toUpperCase() === 'TRUE' ? '  · clave inicial pendiente' : '');
  });
  Logger.log(out.length + ' accesos (✗ = desactivado):\n' + out.join('\n'));
  return out;
}
