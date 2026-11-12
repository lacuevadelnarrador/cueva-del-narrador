// LEER LAS ENTREGAS DE LOS COMPAÑEROS (leer.html)
// Tres niveles, cada uno con su entrada en el historial (el botón "atrás" del móvil sube un nivel):
//   1. Retos con entregas (rpc retos_con_entregas)   2. Entregas de un reto (rpc entregas_de_un_reto, #reto-<id>)
//   3. Lector a pantalla completa: el visor común de lector.js (Lector.abrir), con el almacén privado "entregas".
// - Solo para socios activos: la guardia es Cueva.privada() y las dos funciones de la base de datos lo vuelven a comprobar.
// - Descarga sin caché, solo lectura, saneado del Word y librerías con SRI: todo está en lector.js.
// - La consola solo recibe errores sin datos (Cueva.registrar): nunca la ruta, la dirección ni el token.
(function () {
  const vista = document.getElementById('vista');

  // ---------- Utilidades ----------
  const NS = 'http://www.w3.org/2000/svg';
  const ICONOS = { atras: 'M15 5l-7 7 7 7', check: 'M5 12l5 5 9-10' };
  function el(tag, props, hijos) {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      if (k === 'texto') e.textContent = props[k];
      else if (k === 'clase') e.className = props[k];
      else e.setAttribute(k, props[k]);
    });
    (hijos || []).forEach(h => { if (h) e.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return e;
  }
  function icono(nombre, clase) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    if (clase) s.setAttribute('class', clase);
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONOS[nombre]); s.appendChild(p);
    return s;
  }
  const FECHA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' });
  const MES = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const fecha = ts => { const d = new Date(ts); return ts && !isNaN(d) ? FECHA.format(d) : ''; };
  const mes = dia => { const d = new Date(String(dia || '') + 'T12:00:00Z'); return dia && !isNaN(d) ? MES.format(d) : ''; };
  const cuantas = n => { n = Number(n) || 0; return n + (n === 1 ? ' entrega' : ' entregas'); };
  const nombreReto = r => 'Reto ' + (r && r.numero != null ? r.numero : '');
  const callada = p => { p.catch(() => {}); return p; };

  // ---------- Mensajes de error ----------
  const SESION = 'Inicia sesión para leer las entregas.';
  const caducada = e => !!e && (e.caducada === true || e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' ||
    String(e.message || '').trim() === SESION);
  function textoError(e) {
    if (caducada(e)) return 'Tu sesión ha caducado. ' + SESION;
    return Cueva.mensaje(e);
  }
  // Si el foco estaba dentro (por ejemplo, en "Reintentar"), pasa al aviso para no perderse al cambiar la caja.
  function cargando(caja, texto) {
    const enfocar = caja.contains(document.activeElement);
    caja.setAttribute('aria-busy', 'true');
    const p = el('p', { clase: 'empty cargando', role: 'status', tabindex: '-1', texto });
    caja.replaceChildren(p);
    if (enfocar) p.focus({ preventScroll: true });
  }
  const listo = caja => caja.removeAttribute('aria-busy');
  // Error con "Reintentar" (o "Iniciar sesión" si la sesión ha caducado). Si el foco estaba dentro de la caja (o se ha
  // perdido al cambiarla), pasa al botón.
  function fallo(caja, e, reintentar, registro, texto) {
    const enfocar = caja.contains(document.activeElement) || document.activeElement === document.body;
    Cueva.registrar(registro, e);
    listo(caja);
    const acciones = el('div', { clase: 'leer-acciones' });
    if (caducada(e)) acciones.appendChild(el('a', { clase: 'chip', href: 'acceso.html', texto: 'Iniciar sesión' }));
    else if (reintentar) {
      const b = el('button', { type: 'button', clase: 'chip', texto: 'Reintentar' });
      b.addEventListener('click', reintentar);
      acciones.appendChild(b);
    }
    caja.replaceChildren(el('div', { clase: 'empty fallo', role: 'alert' }, [el('p', { texto: texto || textoError(e) }), acciones.firstChild ? acciones : null]));
    const b = acciones.firstChild;
    if (enfocar && b) b.focus({ preventScroll: true });
  }

  // ---------- Datos ----------
  let sb = null;
  let retos = null;        // filas de retos_con_entregas (se piden una vez por visita a la página)
  let retoAbierto = null;  // reto_id que se ve en el nivel 2 (null en el nivel 1)
  let pedidaEntregas = 0;  // para descartar respuestas de un reto que ya no se ve

  // Primera carga: la consulta de retos sale a la vez que la guardia (Cueva.privada) y no se pinta nada hasta que
  // la guardia termina bien. Reintentar siempre pide una lectura nueva.
  function iniciar(primera) {
    cargando(vista, 'Cargando los retos…');
    Cueva.privada(primera ? s => ({ retos: callada(Promise.resolve(s.rpc('retos_con_entregas'))) }) : undefined)
      .then(async r => {
        sb = r.sb;
        const res = await ((r.previas && r.previas.retos) || sb.rpc('retos_con_entregas'));
        if (res.error) throw res.error;
        retos = Array.isArray(res.data) ? res.data : [];
        irA(history.state || nivelDeLaUrl(), false);
      })
      .catch(e => fallo(vista, e, () => iniciar(false), 'No se han podido cargar los retos con entregas'));
  }

  // ---------- Historial ----------
  function nivelDeLaUrl() {
    const m = /^#reto-(\d+)$/.exec(location.hash);
    return m ? { nivel: 'reto', reto: Number(m[1]) } : { nivel: 'retos' };
  }
  function irA(s, enfocar) {
    if (s.nivel === 'reto' || s.nivel === 'lector') { if (retoAbierto !== s.reto) mostrarReto(s.reto, enfocar); }
    else if (retoAbierto !== null || !vista.querySelector('.leer-lista, .leer-vacio')) mostrarRetos(retoAbierto);
  }
  window.addEventListener('popstate', () => {
    let s = history.state || nivelDeLaUrl();
    if (Lector.abierto() && s.nivel !== 'lector') Lector.terminar();
    // Volver "hacia delante" a un lector ya cerrado: no se reabre; se queda en la lista de ese reto.
    if (s.nivel === 'lector' && !Lector.abierto()) { s = { nivel: 'reto', reto: s.reto, dentro: true }; history.replaceState(s, ''); }
    if (retos) irA(s, true);
  });
  function abrirReto(id) {
    history.pushState({ nivel: 'reto', reto: id, dentro: true }, '', '#reto-' + id);
    mostrarReto(id, true);
  }
  function volverARetos() {
    if (history.state && history.state.dentro && history.state.nivel === 'reto') { history.back(); return; }
    const id = retoAbierto;
    history.replaceState({ nivel: 'retos' }, '', location.pathname + location.search);
    mostrarRetos(id);
  }

  // ---------- Nivel 1: retos con entregas ----------
  // "Volver a Retos" (enlace fijo de la página) solo en el nivel 1; en el 2 se ve "Todos los retos".
  const enlaceRetos = document.querySelector('main > a.volver');
  function mostrarRetos(foco) {
    retoAbierto = null; pedidaEntregas++;
    if (enlaceRetos) enlaceRetos.hidden = false;
    listo(vista);
    if (!retos.length) {
      vista.replaceChildren(el('p', { clase: 'empty leer-vacio', texto: 'Todavía no hay entregas que leer. Cuando tus compañeros entreguen sus textos de los retos, aparecerán aquí.' }));
      return;
    }
    const ul = el('ul', { clase: 'leer-lista' });
    retos.forEach(r => {
      const etiquetas = el('span', { clase: 'leer-etqs' });
      if (r.mia) etiquetas.appendChild(el('span', { clase: 'leer-etq ok' }, ['Tú has entregado', icono('check', 'leer-ic')]));
      if (r.entregas_abiertas) etiquetas.appendChild(el('span', { clase: 'leer-etq', texto: 'Entregas abiertas' }));
      const detalle = [cuantas(r.total), mes(r.inicio)].filter(Boolean).join(' · ');
      const b = el('button', { type: 'button', clase: 'fila', 'data-reto': String(r.reto_id) }, [
        el('span', { clase: 'st' }, [
          el('b', { texto: nombreReto(r) + (r.titulo ? ' · ' + r.titulo : '') }),
          el('small', { texto: detalle }),
          etiquetas.firstChild ? etiquetas : null
        ])
      ]);
      b.addEventListener('click', () => abrirReto(r.reto_id));
      ul.appendChild(el('li', null, [b]));
    });
    vista.replaceChildren(el('h2', { clase: 'leer-h2', texto: 'Retos con entregas' }), ul);
    if (foco != null) {
      const b = [...ul.querySelectorAll('[data-reto]')].find(x => x.dataset.reto === String(foco));
      if (b) b.focus();
    }
  }

  // ---------- Nivel 2: entregas de un reto ----------
  function mostrarReto(id, enfocar) {
    retoAbierto = id;
    if (enlaceRetos) enlaceRetos.hidden = true;
    const r = retos.find(x => String(x.reto_id) === String(id));
    const atras = el('button', { type: 'button', clase: 'volver leer-atras' }, [icono('atras', 'leer-flecha'), 'Todos los retos']);
    atras.addEventListener('click', volverARetos);
    const h2 = el('h2', { clase: 'leer-h2', tabindex: '-1', texto: r ? nombreReto(r) + (r.titulo ? ' · ' + r.titulo : '') : 'Reto' });
    const caja = el('div', { clase: 'leer-entregas' });
    listo(vista);
    vista.replaceChildren(atras, h2, caja);
    if (enfocar) h2.focus();
    if (!r) { caja.appendChild(el('p', { clase: 'empty', texto: 'Este reto no tiene entregas para leer.' })); return; }
    cargarEntregas(r, caja);
  }
  async function cargarEntregas(r, caja) {
    const pedida = ++pedidaEntregas;
    cargando(caja, 'Cargando las entregas…');
    try {
      const res = await sb.rpc('entregas_de_un_reto', { p_reto: Number(r.reto_id) });
      if (res.error) throw res.error;
      if (pedida !== pedidaEntregas) return;
      pintarEntregas(r, caja, Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      if (pedida !== pedidaEntregas) return;
      fallo(caja, e, () => cargarEntregas(r, caja), 'No se han podido cargar las entregas de un reto');
    }
  }
  function pintarEntregas(r, caja, filas) {
    const enfocar = caja.contains(document.activeElement);
    listo(caja);
    if (!filas.length) { caja.replaceChildren(el('p', { clase: 'empty', texto: 'Este reto todavía no tiene entregas para leer.' })); return; }
    const ul = el('ul', { clase: 'leer-lista' });
    filas.forEach(f => {
      const ext = String(f.extension || '').toLowerCase();
      const detalle = [f.entregado ? 'Entregado el ' + fecha(f.entregado) : '', ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word' : ''].filter(Boolean).join(' · ');
      const b = el('button', { type: 'button', clase: 'fila' }, [
        el('span', { clase: 'st' }, [
          el('b', { texto: f.autor || 'Socio del club' }),
          el('small', { texto: detalle }),
          f.es_mia ? el('span', { clase: 'leer-etqs' }, [el('span', { clase: 'leer-etq ok', texto: 'Tuya' })]) : null
        ])
      ]);
      b.addEventListener('click', () => Lector.abrir({
        almacen: 'entregas', ruta: f.ruta, extension: f.extension, origen: b,
        titulo: nombreReto(r) + ' · ' + (f.autor || 'Socio del club'), estado: { reto: r.reto_id, dentro: true },
        etiqueta: 'Texto de la entrega', sesion: SESION, registro: 'No se ha podido abrir una entrega'
      }));
      ul.appendChild(el('li', null, [b]));
    });
    caja.replaceChildren(el('p', { clase: 'leer-cuenta', texto: cuantas(filas.length) }), ul);
    if (enfocar) { const b = ul.querySelector('button'); if (b) b.focus(); }
  }

  // ---------- Arranque ----------
  // Al recargar con el lector abierto, se vuelve a la lista de ese reto (el lector no se reabre solo).
  const inicial = history.state || nivelDeLaUrl();
  history.replaceState(inicial.nivel === 'lector' ? { nivel: 'reto', reto: inicial.reto, dentro: inicial.dentro } : inicial, '');
  iniciar(true);
})();
