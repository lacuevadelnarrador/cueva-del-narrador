// PANEL: ENTREGAS DE LOS RETOS (dentro de admin-retos.html, debajo de cada reto). Solo administradores (Admin.iniciar).
// - Interruptor "Entregas abiertas" (retos.entregas_abiertas), resumen "X de Y socios han entregado" y lista de los socios
//   con ficha y cuenta activa. Las entregas de socios que ya no están activos salen aparte, en "Otras entregas".
// - "Entregado" = fila de entregas con subido = true. Una fila con subido = false es una subida empezada: no cuenta.
// - Los archivos están en el almacén privado "entregas" (<id del reto>/<id del socio>.<ext>) y no se borran con SQL:
//   por eso se borran desde aquí antes que su fila (y antes que el reto, con borrarArchivosReto).
// Privacidad: las descargas se hacen en memoria (Blob) y la dirección blob: se libera con revokeObjectURL (Zip.descargar).
// No se guarda nada en localStorage/sessionStorage y la consola solo recibe errores sin datos (Cueva.registrar).

const Entregas = (function () {
  const esc = Admin.esc;
  const CUBO = 'entregas';
  const nombreReto = r => 'Reto ' + (r.numero != null ? r.numero : r.id);
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

  // Día de Madrid (AAAA-MM-DD) de una fecha con hora de la base de datos.
  function diaMadrid(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return '';
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  // Nombre de archivo seguro dentro del zip (sin carpetas ni caracteres que Windows no admite) y sin repetir:
  // "texto.pdf", "texto-2.pdf", "texto-3.pdf"... (sin distinguir mayúsculas).
  function nombreUnico(nombre, usados, i) {
    let n = String(nombre || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
    if (!n) n = 'entrega-' + (i + 1);
    const m = /^(.*?)(\.[^.]*)?$/.exec(n), base = m[1] || n, ext = m[2] || '';
    let k = 1, prueba = n;
    while (usados.has(prueba.toLocaleLowerCase('es'))) prueba = base + '-' + (++k) + ext;
    usados.add(prueba.toLocaleLowerCase('es'));
    return prueba;
  }

  // ---------- Borrar los archivos de un reto (antes de borrar el reto) ----------
  // Lista la carpeta <id del reto>/ del almacén y la vacía por tandas; después borra las filas de entregas del reto.
  // Si algo falla, lanza el error (el reto no se debe borrar).
  async function borrarArchivosReto(retoId) {
    const sb = Admin.sb(), cubo = sb.storage.from(CUBO), carpeta = String(retoId);
    for (let vuelta = 0; ; vuelta++) {
      if (vuelta >= 50) throw { mensaje: 'No se han podido borrar todos los textos entregados en este reto. Vuelve a intentarlo.' };
      const l = await cubo.list(carpeta, { limit: 100 });
      if (l.error) throw l.error;
      const rutas = (l.data || []).filter(o => o && o.name && o.id !== null).map(o => carpeta + '/' + o.name);
      if (!rutas.length) break;
      const r = await cubo.remove(rutas);
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || !r.data.length) throw { sinFilas: true }; // sin permiso: no se ha borrado nada
    }
    const d = await sb.from('entregas').delete().eq('reto_id', retoId).select('socio_id');
    if (d.error) throw d.error;
  }

  // ---------- Panel de un reto ----------
  // Botón "Entregas" (aria-expanded/aria-controls) que despliega el panel. Cada vez que se abre, se vuelve a leer.
  function alternar(boton, reto) {
    const caja = document.getElementById(boton.getAttribute('aria-controls'));
    if (!caja) return;
    const abrir = boton.getAttribute('aria-expanded') !== 'true';
    boton.setAttribute('aria-expanded', String(abrir));
    caja.hidden = !abrir;
    if (abrir) cargar(caja, reto);
  }

  // Socios con ficha, cuentas activas y entregas del reto. Devuelve { data } o { error }, como una consulta.
  async function leer(reto) {
    const sb = await Admin.iniciar();
    const [so, pe, en] = await Promise.all([
      sb.from('socios').select('id,nombre_completo,nombre_pila'),
      sb.from('perfiles').select('id').eq('activo', true),
      sb.from('entregas').select('socio_id,ruta,nombre_archivo,tamano,subido,entregado').eq('reto_id', reto.id)
    ]);
    const error = so.error || pe.error || en.error;
    return error ? { error } : { data: { socios: so.data || [], activos: pe.data || [], entregas: en.data || [] } };
  }
  function cargar(caja, reto) {
    Cueva.cargar(caja, () => leer(reto), datos => pintar(caja, reto, datos));
  }
  // Vuelve a leer y pintar el panel sin pasar por "Cargando…" (si falla, entonces sí: error con "Reintentar").
  async function recargar(caja, reto) {
    try {
      const r = await leer(reto);
      if (r.error) throw r.error;
      pintar(caja, reto, r.data);
    } catch (e) {
      cargar(caja, reto);
    }
  }

  function pintar(caja, reto, datos) {
    const activos = new Set(datos.activos.map(p => p.id));
    const fichas = new Map(datos.socios.map(s => [s.id, s]));
    const nombre = s => (s && (s.nombre_completo || s.nombre_pila)) || 'Socio sin ficha';
    const porSocio = new Map(datos.entregas.map(e => [e.socio_id, e]));
    const lista = datos.socios.filter(s => activos.has(s.id))
      .map(s => ({ id: s.id, nombre: nombre(s), e: porSocio.get(s.id) || null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const otras = datos.entregas.filter(e => !(fichas.has(e.socio_id) && activos.has(e.socio_id)))
      .map(e => ({ id: e.socio_id, nombre: nombre(fichas.get(e.socio_id)), e }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const hechas = lista.filter(x => x.e && x.e.subido === true).length;
    const enZip = datos.entregas.filter(e => e.subido === true).length;
    const abiertas = reto.entregas_abiertas !== false;
    const idEt = 'ent-et-' + reto.id;
    caja._filas = lista.concat(otras);

    const fila = (x, i) => {
      const e = x.e, ok = !!(e && e.subido === true), empezada = !!(e && !ok);
      const detalle = ok ? [diaMadrid(e.entregado), e.nombre_archivo].filter(Boolean).map(esc).join(' · ')
        : empezada ? 'Subida empezada, sin terminar' : '';
      return '<li class="ent-fila"><div class="ent-datos"><b>' + esc(x.nombre) + '</b>' +
        '<span class="ent-estado' + (ok ? ' ok' : '') + '">' + (ok ? 'Entregado' : 'Pendiente') + '</span>' +
        (detalle ? '<small>' + detalle + '</small>' : '') + '</div>' +
        (e ? '<div class="ent-acciones">' +
          (ok ? '<button type="button" class="chip" data-descargar="' + i + '">Descargar</button>' : '') +
          '<button type="button" class="chip ent-borrar" data-borrar="' + i + '">Borrar entrega</button></div>' : '') +
        '</li>';
    };
    caja.innerHTML =
      '<p class="msg" data-estado hidden></p>' +
      '<div class="ent-cabecera"><span class="perfil-switch-et" id="' + idEt + '">Entregas abiertas</span>' +
      '<button type="button" class="perfil-switch" role="switch" data-interruptor aria-checked="' + abiertas + '" aria-labelledby="' + idEt + '">' +
      '<span class="perfil-switch-pista" aria-hidden="true"><span></span></span><span class="perfil-switch-texto" aria-hidden="true">' + (abiertas ? 'Sí' : 'No') + '</span></button></div>' +
      '<p class="ent-resumen" role="status">' + hechas + ' de ' + plural(lista.length, 'socio', 'socios') + (hechas === 1 ? ' ha entregado' : ' han entregado') + '</p>' +
      '<div class="ent-zip"><button type="button" class="btn sec" data-zip' + (enZip ? '' : ' disabled') + '>Descargar zip del reto</button>' +
      (enZip ? '' : '<p class="pista">Todavía no hay textos entregados.</p>') +
      '<p class="ent-progreso" role="status" hidden></p><progress class="ent-barra" hidden></progress></div>' +
      (lista.length ? '<ul class="ent-lista">' + lista.map(fila).join('') + '</ul>' : '<p class="empty">No hay socios con ficha y cuenta activa.</p>') +
      (otras.length ? '<h3 class="ent-otras">Otras entregas</h3><p class="pista">De socios sin ficha o con la cuenta desactivada. No cuentan en el resumen.</p>' +
        '<ul class="ent-lista">' + otras.map((x, i) => fila(x, lista.length + i)).join('') + '</ul>' : '');
    if (!caja._escucha) {
      caja._escucha = true;
      caja.addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b || b.disabled || caja.getAttribute('aria-busy') === 'true') return;
        if (b.hasAttribute('data-interruptor')) cambiarAbiertas(caja, reto, b);
        else if (b.dataset.descargar != null) descargarUna(caja, caja._filas[+b.dataset.descargar], b);
        else if (b.dataset.borrar != null) borrarUna(caja, reto, caja._filas[+b.dataset.borrar]);
        else if (b.hasAttribute('data-zip')) descargarZip(caja, reto, b);
      });
    }
  }

  // Foco de vuelta tras volver a pintar el panel (el botón anterior ya no existe).
  function enfocar(caja, sel) {
    const b = caja.querySelector(sel) || caja.querySelector('[data-interruptor]');
    if (b) b.focus({ preventScroll: true });
  }

  // ---------- Interruptor ----------
  async function cambiarAbiertas(caja, reto, b) {
    const nuevo = b.getAttribute('aria-checked') !== 'true', id = reto.id;
    const r = await Admin.escribir(caja, () => Admin.sb().from('retos').update({ entregas_abiertas: nuevo }).eq('id', id).select('id,entregas_abiertas'),
      nuevo ? nombreReto(reto) + ': entregas abiertas.' : nombreReto(reto) + ': entregas cerradas.');
    if (!r) { b.focus({ preventScroll: true }); return; }
    reto.entregas_abiertas = r[0].entregas_abiertas !== false;
    const si = reto.entregas_abiertas;
    b.setAttribute('aria-checked', String(si));
    b.querySelector('.perfil-switch-texto').textContent = si ? 'Sí' : 'No';
    b.focus({ preventScroll: true });
  }

  // ---------- Descargar un archivo ----------
  async function descargarUna(caja, x, b) {
    if (!x || !x.e) return;
    const ruta = x.e.ruta, nombre = x.e.nombre_archivo || 'entrega'; // copia antes de esperar
    const soltar = Admin.bloquear(caja);
    Admin.estado(caja, 'Descargando…');
    try {
      const r = await Admin.sb().storage.from(CUBO).download(ruta);
      if (r.error || !r.data) throw r.error || {};
      Zip.descargar(r.data, nombre);
      Admin.estado(caja, '');
    } catch (e) {
      Cueva.registrar('No se ha podido descargar una entrega', e);
      Admin.estado(caja, 'No se ha podido descargar el archivo. ' + Admin.mensajeError(e), true);
    } finally {
      soltar();
      if (b.isConnected) b.focus({ preventScroll: true });
    }
  }

  // ---------- Borrar una entrega ----------
  // Primero el archivo y después la fila: si falla el segundo paso, el archivo ya no está y se puede reintentar.
  async function borrarUna(caja, reto, x) {
    if (!x || !x.e) return;
    const socio = x.id, ruta = x.e.ruta, nombre = x.nombre, retoId = reto.id; // copia antes de esperar
    const si = await Admin.confirmar('Se borrará el archivo y ' + nombre + ' podrá volver a subir su texto.', 'Borrar entrega');
    if (!si) return;
    const sb = Admin.sb(), soltar = Admin.bloquear(caja);
    Admin.estado(caja, 'Borrando…');
    let paso = 'archivo', error = null;
    try {
      if (ruta) {
        const r = await sb.storage.from(CUBO).remove([ruta]);
        if (r.error) throw r.error; // una lista vacía sin error = el archivo ya no estaba: se sigue con la fila
      }
      paso = 'fila';
      const d = await sb.from('entregas').delete().eq('reto_id', retoId).eq('socio_id', socio).select('socio_id');
      if (d.error) throw d.error;
      if (!Array.isArray(d.data) || !d.data.length) throw { sinFilas: true };
    } catch (e) {
      error = e;
      Cueva.registrar('No se ha podido borrar una entrega', e);
    } finally {
      soltar();
    }
    if (error) {
      const m = paso === 'archivo' ? 'No se ha borrado nada. ' + Admin.mensajeError(error)
        : 'El archivo se ha borrado, pero la entrega sigue apuntada. Vuelve a pulsar «Borrar entrega» para terminar.' +
          (Cueva.esErrorDeRed(error) ? ' Comprueba antes tu conexión.' : '');
      Admin.estado(caja, m, true);
      Cueva.aviso(m, 'err');
      return;
    }
    Cueva.aviso('Entrega de ' + nombre + ' borrada.', 'ok');
    if (!caja.hidden) { await recargar(caja, reto); enfocar(caja, '[data-zip]:not([disabled])'); }
  }

  // ---------- Zip del reto ----------
  // Todos los archivos entregados (también los de "Otras entregas"), cada uno con su nombre_archivo. Si alguno no se
  // puede descargar, se sigue con los demás y al final se dice cuáles faltan.
  async function descargarZip(caja, reto, b) {
    const filas = caja._filas.filter(x => x.e && x.e.subido === true).map(x => ({ ruta: x.e.ruta, nombre: x.e.nombre_archivo, quien: x.nombre })); // copia
    if (!filas.length) return;
    const titulo = nombreReto(reto).replace(/\s+/g, '');
    const progreso = caja.querySelector('.ent-progreso'), barra = caja.querySelector('.ent-barra');
    const avance = (t, v) => { progreso.textContent = t; progreso.hidden = false; barra.hidden = false; barra.max = filas.length + 1; barra.value = v; };
    const soltar = Admin.bloquear(caja);
    Admin.estado(caja, '');
    const sb = Admin.sb(), archivos = [], faltan = [], usados = new Set();
    try {
      for (let i = 0; i < filas.length; i++) {
        avance('Descargando ' + (i + 1) + '/' + filas.length + '…', i);
        try {
          const r = await sb.storage.from(CUBO).download(filas[i].ruta);
          if (r.error || !r.data) throw r.error || {};
          archivos.push({ nombre: nombreUnico(filas[i].nombre, usados, i), datos: new Uint8Array(await r.data.arrayBuffer()) });
        } catch (e) {
          Cueva.registrar('No se ha podido descargar una entrega', e); // sin la ruta ni el nombre
          faltan.push(filas[i].quien);
        }
      }
      if (!archivos.length) throw { mensaje: 'No se ha podido descargar ningún archivo y no se ha generado el zip. Inténtalo de nuevo dentro de un momento.' };
      avance('Generando el zip…', filas.length);
      await new Promise(r => setTimeout(r, 30)); // deja que se pinte el texto antes de generar el zip
      const f = Zip.ahoraMadrid(), nombre = titulo + '-entregas-' + f.dia + '.zip';
      Zip.descargar(Zip.crear(archivos, f), nombre);
      archivos.length = 0; // la memoria de los archivos se libera en cuanto se ha generado el zip
      avance('Zip descargado.', filas.length + 1);
      if (faltan.length) {
        Admin.estado(caja, 'Se ha descargado ' + nombre + ' sin ' + plural(faltan.length, 'archivo', 'archivos') + ' (no se ' +
          (faltan.length === 1 ? 'ha' : 'han') + ' podido descargar): ' + faltan.join(', ') + '. Puedes volver a intentarlo dentro de un momento.', true);
      } else {
        Cueva.aviso('Zip descargado: ' + plural(filas.length, 'archivo', 'archivos') + '.', 'ok');
      }
    } catch (e) {
      Cueva.registrar('No se ha podido generar el zip de un reto', e);
      progreso.hidden = true; barra.hidden = true;
      Admin.estado(caja, e && e.mensaje ? e.mensaje : 'No se ha podido generar el zip. ' + Admin.mensajeError(e), true);
    } finally {
      soltar();
      if (b.isConnected) b.focus({ preventScroll: true });
    }
  }

  return { alternar, borrarArchivosReto, nombreReto };
})();
