// LEER LAS ENTREGAS DE LOS COMPAÑEROS (leer.html)
// Tres niveles, cada uno con su entrada en el historial (el botón "atrás" del móvil sube un nivel):
//   1. Retos con entregas (rpc retos_con_entregas)   2. Entregas de un reto (rpc entregas_de_un_reto, #reto-<id>)
//   3. Lector a pantalla completa (<dialog>): PDF con pdf.js y Word (.docx) con mammoth.
// - Solo para socios activos: la guardia es Cueva.privada() y las dos funciones de la base de datos lo vuelven a comprobar.
// - Las librerías se descargan solo al abrir una entrega (y solo la que hace falta), con versión fijada y SRI.
// - El archivo se pide con fetch(cache: 'no-store') y el token de la sesión: no queda copia en la caché del navegador
//   ni en ningún almacenamiento. Al cerrar el lector se sueltan los datos, los canvas y el worker.
// - Solo lectura "de comodidad": sin descargar, imprimir, copiar ni menú contextual dentro del lector. NO es una medida
//   de seguridad: quien lee el texto en su pantalla siempre puede capturarlo.
// - Todo el texto se pinta con textContent o con nodos creados uno a uno. El HTML del Word pasa por un saneador con
//   lista blanca (sanear) y nunca se inserta tal cual.
// - La consola solo recibe errores sin datos (Cueva.registrar): nunca la ruta, la dirección ni el token.
(function () {
  const vista = document.getElementById('vista');
  const dlg = document.getElementById('lector');
  const cuerpo = document.getElementById('lector-cuerpo');
  const tituloLector = document.getElementById('lector-titulo');
  const botonVolver = document.getElementById('lector-volver');

  // ---------- Librerías (versión exacta + SRI; hashes calculados y contrastados con otro CDN) ----------
  // pdf.js: compilación "legacy" (con polyfills): funciona desde Chrome 125 y Safari/iOS 18. La normal pide navegadores
  // más recientes. El worker no se puede crear desde otro dominio: se descarga con fetch (también con SRI) y se arranca
  // desde una dirección blob: de esta página.
  const PDFJS = {
    src: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/pdf.min.mjs',
    sri: 'sha384-5NjcDwbJzXhI7QGdIeL4gC2aaEUnzbpPCN461DegG6G/1ym8f1MBJQpAjcXNOi5s', modulo: true, global: 'pdfjsLib'
  };
  const PDFJS_WORKER = {
    src: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/legacy/build/pdf.worker.min.mjs',
    sri: 'sha384-2elss7Fc57S3C8hPKJxxGbtpWJRNsg0VWJqPR6PSSaIetveaFPnpIRIGVSml+d5+'
  };
  const MAMMOTH = {
    src: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.13.0/mammoth.browser.min.js',
    sri: 'sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO', global: 'mammoth'
  };

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
    if (abierto && s.nivel !== 'lector') terminarLector();
    // Volver "hacia delante" a un lector ya cerrado: no se reabre; se queda en la lista de ese reto.
    if (s.nivel === 'lector' && !abierto) { s = { nivel: 'reto', reto: s.reto, dentro: true }; history.replaceState(s, ''); }
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
      b.addEventListener('click', () => abrirLector(r, f, b));
      ul.appendChild(el('li', null, [b]));
    });
    caja.replaceChildren(el('p', { clase: 'leer-cuenta', texto: cuantas(filas.length) }), ul);
    if (enfocar) { const b = ul.querySelector('button'); if (b) b.focus(); }
  }

  // ---------- Carga diferida de librerías ----------
  // Si falla (sin red o SRI que no coincide) se puede reintentar: no se guarda la promesa fallida. Un módulo que ha
  // fallado queda marcado en el navegador para esa dirección, así que cada reintento cambia el fragmento (#2, #3…):
  // la petición es la misma y el SRI se comprueba igual.
  const promesas = {};
  let intentos = 0;
  function cargarScript(lib) {
    if (window[lib.global]) return Promise.resolve(window[lib.global]);
    if (!promesas[lib.global]) {
      promesas[lib.global] = new Promise((ok, mal) => {
        const s = document.createElement('script');
        if (lib.modulo) s.type = 'module';
        s.src = lib.src + (intentos ? '#' + (intentos + 1) : '');
        s.integrity = lib.sri; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
        s.onload = () => {
          const g = window[lib.global];
          // Se ha descargado pero no ha llegado a funcionar: el navegador es demasiado antiguo para esta librería.
          if (g) ok(g); else { s.remove(); mal({ sinSoporte: true, code: 'sin-soporte' }); }
        };
        s.onerror = () => { s.remove(); intentos++; mal({ libreria: true, code: 'libreria' }); };
        document.head.appendChild(s);
      }).catch(e => { delete promesas[lib.global]; throw e; });
    }
    return promesas[lib.global];
  }
  let urlWorker = null, promesaWorker = null;
  function cargarWorker() {
    if (urlWorker) return Promise.resolve(urlWorker);
    if (!promesaWorker) {
      promesaWorker = fetch(PDFJS_WORKER.src, { integrity: PDFJS_WORKER.sri, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(r => { if (!r.ok) throw new Error('worker'); return r.blob(); })
        .then(b => { urlWorker = URL.createObjectURL(new Blob([b], { type: 'text/javascript' })); return urlWorker; })
        .catch(() => { promesaWorker = null; throw { libreria: true, code: 'libreria' }; });
    }
    return promesaWorker;
  }
  const soportaPdf = () => typeof Worker === 'function' && typeof URL.createObjectURL === 'function' && 'noModule' in HTMLScriptElement.prototype;

  // ---------- Descarga del archivo ----------
  // fetch con cache 'no-store' (ni se lee ni se guarda en la caché HTTP) y el token de getSession(), que lo renueva si
  // ha caducado. El service worker no la intercepta (es de otro dominio). 400/401/403: sesión caducada o sin permiso.
  async function descargar(ruta, signal) {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const s = data && data.session;
    if (!s || !s.access_token) throw { caducada: true, code: 'sin-sesion' };
    const camino = String(ruta || '').split('/').map(encodeURIComponent).join('/');
    let r;
    try {
      r = await fetch(SUPABASE_URL + '/storage/v1/object/authenticated/entregas/' + camino, {
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + s.access_token },
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { cancelado: true };
      throw { red: true, code: 'red' };
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) throw { caducada: true, code: r.status };
    if (r.status === 404) throw { noEsta: true, code: 404 };
    if (!r.ok) throw { code: r.status };
    try { return new Uint8Array(await r.arrayBuffer()); }
    catch (e) { if (e && e.name === 'AbortError') throw { cancelado: true }; throw { red: true, code: 'red' }; }
  }
  // Firma del archivo: "%PDF-" (en los primeros 1024 bytes, como acepta pdf.js) o "PK\x03\x04" (zip del .docx).
  function firmaValida(bytes, ext) {
    if (ext === 'docx') return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    const n = Math.min(bytes.length - 5, 1024);
    for (let i = 0; i < n; i++) if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2D) return true;
    return false;
  }

  // ---------- Lector ----------
  let abierto = null;  // { reto, fila, origen, ctrl, tarea, worker, pdfWorker, observador, paginas, alCambiar }
  let turno = 0;       // cada apertura o reintento; lo que llega de un turno anterior se descarta
  const vigente = t => { if (t !== turno || !abierto) throw { cancelado: true }; };

  function abrirLector(r, fila, origen) {
    if (abierto) return;
    abierto = { reto: r, fila, origen };
    tituloLector.textContent = nombreReto(r) + ' · ' + (fila.autor || 'Socio del club');
    document.documentElement.classList.add('leyendo');
    history.pushState({ nivel: 'lector', reto: r.reto_id, dentro: true }, '');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    botonVolver.focus();
    cargarEntrega();
  }
  // "Volver", Escape y el botón "atrás": se sale del nivel del lector en el historial; popstate lo cierra.
  function cerrarLector() {
    if (!abierto) return;
    if (history.state && history.state.nivel === 'lector') {
      const a = abierto;
      history.back();
      setTimeout(() => { if (abierto === a) terminarLector(); }, 600); // por si el navegador no avisa (popstate)
    } else terminarLector();
  }
  function terminarLector() {
    const a = abierto; if (!a) return;
    turno++;
    liberar();
    abierto = null;
    if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
    document.documentElement.classList.remove('leyendo');
    tituloLector.textContent = '';
    if (a.origen && a.origen.isConnected) a.origen.focus();
  }
  // Suelta todo lo del archivo abierto: petición en curso, documento, worker, canvas y datos.
  function liberar() {
    const a = abierto; if (!a) return;
    if (a.ctrl) a.ctrl.abort();
    if (a.observador) a.observador.disconnect();
    if (a.alCambiar) window.removeEventListener('resize', a.alCambiar);
    (a.paginas || []).forEach(vaciarPagina);
    cuerpo.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; });
    if (a.tarea) { try { a.tarea.destroy().catch(() => {}); } catch (e) {} }
    if (a.pdfWorker) { try { a.pdfWorker.destroy(); } catch (e) {} }
    if (a.worker) { try { a.worker.terminate(); } catch (e) {} }
    ['ctrl', 'observador', 'alCambiar', 'paginas', 'tarea', 'doc', 'pdfWorker', 'worker'].forEach(k => { a[k] = null; });
    cuerpo.replaceChildren();
  }
  function estadoLector(texto) {
    const enfocar = cuerpo.contains(document.activeElement) && document.activeElement !== cuerpo;
    cuerpo.setAttribute('aria-busy', 'true');
    cuerpo.replaceChildren(el('p', { clase: 'empty cargando lector-estado', role: 'status', texto }));
    if (enfocar) cuerpo.focus({ preventScroll: true }); // tras "Reintentar": el foco no se pierde
  }

  async function cargarEntrega() {
    const t = ++turno;
    liberar();
    const a = abierto, ext = String(a.fila.extension || '').toLowerCase();
    a.ctrl = new AbortController();
    estadoLector('Descargando el texto…');
    try {
      if (ext !== 'pdf' && ext !== 'docx') throw { formato: true, code: 'formato' };
      if (ext === 'pdf' && !soportaPdf()) throw { sinSoporte: true, code: 'sin-soporte' };
      // La librería y el archivo se piden a la vez; la librería solo la primera vez (luego la tiene el navegador).
      const lib = callada(ext === 'pdf' ? Promise.all([cargarScript(PDFJS), cargarWorker()]) : cargarScript(MAMMOTH));
      let datos = await descargar(a.fila.ruta, a.ctrl.signal);
      vigente(t);
      if (!firmaValida(datos, ext)) throw { danado: true, code: 'firma' };
      estadoLector('Preparando el lector…');
      await lib;
      vigente(t);
      if (ext === 'pdf') await pintarPdf(datos, t); else await pintarDocx(datos, t);
      datos = null;
    } catch (e) {
      if ((e && e.cancelado) || t !== turno || !abierto) return;
      errorLector(e);
    }
  }
  function errorLector(e) {
    let texto, reintentar = true;
    if (e.sinSoporte) { texto = 'Tu navegador no puede mostrar este texto. Actualízalo (en iPhone, a iOS 18 o posterior; en Android, la última versión de Chrome) y vuelve a intentarlo.'; reintentar = false; }
    else if (e.libreria) texto = 'No se ha podido preparar el lector. Comprueba tu conexión y vuelve a intentarlo.';
    else if (e.danado) { texto = 'El archivo está dañado y no se puede mostrar.'; reintentar = false; }
    else if (e.protegido) { texto = 'Este PDF tiene contraseña y no se puede mostrar aquí.'; reintentar = false; }
    else if (e.formato) { texto = 'Este formato no se puede mostrar. Solo se leen archivos PDF y Word (.docx).'; reintentar = false; }
    else if (e.noEsta) texto = 'Este texto ya no está disponible.';
    else if (caducada(e) || e.red || Cueva.esErrorDeRed(e)) texto = null; // textoError
    else texto = 'No se ha podido abrir este texto. Vuelve a intentarlo dentro de un momento.';
    fallo(cuerpo, e, reintentar ? cargarEntrega : null, 'No se ha podido abrir una entrega', texto);
  }

  // ---------- PDF ----------
  // Sin capa de texto ni de anotaciones (no hay texto seleccionable, enlaces ni formularios en la página) y sin
  // pdf.sandbox: el JavaScript del PDF no se ejecuta. pdf.js 6 ya no usa eval para el PDF. Cada página es un canvas
  // ajustado al ancho que se dibuja al acercarse con el scroll y se vacía al alejarse (memoria del móvil).
  async function pintarPdf(datos, t) {
    const lib = window.pdfjsLib, a = abierto;
    lib.GlobalWorkerOptions.workerSrc = urlWorker; // plan B de pdf.js si no puede usar el worker
    a.worker = new Worker(urlWorker, { type: 'module' });
    // verbosity ERRORS (en el worker y aquí): pdf.js no escribe sus avisos internos en la consola.
    a.pdfWorker = lib.PDFWorker.create({ port: a.worker, verbosity: lib.VerbosityLevel.ERRORS });
    a.tarea = lib.getDocument({ data: datos, worker: a.pdfWorker, enableXfa: false, stopAtErrors: false, verbosity: lib.VerbosityLevel.ERRORS });
    let doc;
    try { doc = await a.tarea.promise; }
    catch (e) {
      vigente(t);
      const n = e && e.name;
      if (n === 'PasswordException') throw { protegido: true, code: n };
      if (n === 'InvalidPDFException' || n === 'FormatError' || n === 'UnknownErrorException' || n === 'MissingPDFException') throw { danado: true, code: n };
      throw e;
    }
    vigente(t);
    a.doc = doc;
    const primera = await doc.getPage(1);
    vigente(t);
    const v1 = primera.getViewport({ scale: 1 });
    const total = doc.numPages;
    const cont = el('div', { clase: 'lector-pdf' });
    a.paginas = [];
    for (let i = 1; i <= total; i++) {
      const p = el('div', { clase: 'lector-pag', role: 'img', 'aria-label': 'Página ' + i + ' de ' + total });
      p.style.aspectRatio = v1.width + ' / ' + v1.height;
      p.dataset.n = String(i);
      a.paginas.push(p);
      cont.appendChild(p);
    }
    listo(cuerpo);
    cuerpo.replaceChildren(cont);
    let cola = Promise.resolve();
    a.observador = new IntersectionObserver(entradas => {
      entradas.forEach(en => {
        const p = en.target;
        p.cerca = en.isIntersecting;
        if (p.cerca && !p.pintada && !p.enCola) { p.enCola = true; cola = cola.then(() => dibujar(lib, doc, p, t)).catch(() => {}); }
        else if (!p.cerca) vaciarPagina(p);
      });
    }, { root: cuerpo, rootMargin: '150% 0px' });
    a.paginas.forEach(p => a.observador.observe(p));
    // Al girar el móvil o cambiar el ancho se vuelven a dibujar las páginas cercanas al nuevo tamaño.
    let ancho = cont.clientWidth, espera = 0;
    a.alCambiar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        if (!abierto || abierto !== a || !a.observador || cont.clientWidth === ancho) return;
        ancho = cont.clientWidth;
        a.paginas.forEach(vaciarPagina);
        a.observador.disconnect();
        a.paginas.forEach(p => a.observador.observe(p));
      }, 250);
    };
    window.addEventListener('resize', a.alCambiar);
  }
  async function dibujar(lib, doc, p, t) {
    p.enCola = false;
    if (t !== turno || !p.cerca || p.pintada) return;
    const pagina = await doc.getPage(Number(p.dataset.n));
    if (t !== turno || !p.cerca) return;
    const v0 = pagina.getViewport({ scale: 1 });
    p.style.aspectRatio = v0.width + ' / ' + v0.height;
    // Nitidez: hasta 2 píxeles por píxel de pantalla, y como mucho ~16 millones de píxeles por página (límite de iOS).
    let escala = (p.clientWidth || 320) / v0.width * Math.min(window.devicePixelRatio || 1, 2);
    const area = v0.width * v0.height * escala * escala;
    if (area > 16e6) escala *= Math.sqrt(16e6 / area);
    const vp = pagina.getViewport({ scale: escala });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    p.tarea = pagina.render({ canvas: c, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE });
    try { await p.tarea.promise; }
    catch (e) {
      c.width = 0; c.height = 0;
      if (e && e.name === 'RenderingCancelledException') return;
      if (t === turno) { p.replaceChildren(el('p', { clase: 'lector-pag-error', texto: 'No se ha podido dibujar esta página.' })); p.pintada = true; }
      return;
    } finally { p.tarea = null; }
    if (t !== turno || !p.cerca) { c.width = 0; c.height = 0; return; }
    p.replaceChildren(c);
    p.pintada = true;
    pagina.cleanup();
  }
  function vaciarPagina(p) {
    if (p.tarea) { try { p.tarea.cancel(); } catch (e) {} p.tarea = null; }
    const c = p.querySelector('canvas');
    if (c) { c.width = 0; c.height = 0; }
    if (p.firstChild) p.replaceChildren();
    p.pintada = false;
  }

  // ---------- Word (.docx) ----------
  // mammoth convierte el documento en HTML (sin imágenes: no se leen ni se convierten). Ese HTML NUNCA se inserta:
  // sanear() lo analiza con DOMParser (documento inerte: no ejecuta scripts ni descarga nada) y construye nodos nuevos.
  async function pintarDocx(datos, t) {
    const m = window.mammoth;
    let imagenes = 0, res;
    try {
      res = await m.convertToHtml({ arrayBuffer: datos.buffer }, {
        convertImage: m.images.imgElement(() => { imagenes++; return Promise.resolve({}); }),
        ignoreEmptyParagraphs: true,
        // Además de lo que mammoth trae de serie (títulos, negrita, cursiva, listas): subrayado y citas.
        styleMap: ['u => u', "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Intense Quote'] => blockquote:fresh", "p[style-name='Cita'] => blockquote:fresh"]
      });
    } catch (e) { vigente(t); throw { danado: true, code: 'docx' }; }
    vigente(t);
    const limpio = sanear(res && res.value);
    const art = el('article', { clase: 'lector-docx' });
    const notas = [];
    if (imagenes) notas.push(imagenes === 1 ? 'Este documento tiene una imagen que no se muestra aquí.' : 'Este documento tiene ' + imagenes + ' imágenes que no se muestran aquí.');
    if (limpio.tablas) notas.push('Las tablas se muestran como texto seguido.');
    if (limpio.recortado) notas.push('El documento es muy largo y solo se muestra una parte.');
    if (notas.length) art.appendChild(el('p', { clase: 'lector-nota', texto: notas.join(' ') }));
    if (limpio.texto) art.appendChild(limpio.fragmento);
    else art.appendChild(el('p', { clase: 'lector-nota', texto: 'Este documento no tiene texto que mostrar.' }));
    listo(cuerpo);
    cuerpo.replaceChildren(art);
    cuerpo.scrollTop = 0;
  }

  // Saneador con lista blanca. Se quedan (sin ningún atributo) estas etiquetas; los enlaces y todo lo desconocido se
  // sustituyen por su contenido (se queda el texto); lo peligroso o sin texto útil se quita entero, con su contenido.
  // NOSCRIPT no está en FUERA: en DOMParser (sin scripts) su interior son nodos normales, que pasan por este mismo filtro.
  const PERMITIDAS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
  const FUERA = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'MATH', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'TEMPLATE',
    'LINK', 'META', 'BASE', 'TITLE', 'HEAD', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'VIDEO', 'AUDIO',
    'SOURCE', 'TRACK', 'PICTURE', 'CANVAS', 'MAP', 'AREA', 'DIALOG', 'PORTAL', 'SLOT']);
  const MAX_NODOS = 60000, MAX_PROFUNDIDAD = 32;
  function sanear(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const fragmento = document.createDocumentFragment();
    const r = { fragmento, tablas: false, recortado: false, texto: false };
    let nodos = 0;
    (function copiar(origen, destino, prof) {
      for (let n = origen.firstChild; n; n = n.nextSibling) {
        if (++nodos > MAX_NODOS) { r.recortado = true; return; }
        if (n.nodeType === 3) {
          if (n.nodeValue) { destino.appendChild(document.createTextNode(n.nodeValue)); if (n.nodeValue.trim()) r.texto = true; }
          continue;
        }
        if (n.nodeType !== 1) continue; // comentarios, instrucciones…
        const tag = String(n.nodeName).toUpperCase();
        if (FUERA.has(tag)) continue;
        if (prof >= MAX_PROFUNDIDAD) { r.recortado = true; continue; }
        if (tag === 'TABLE') r.tablas = true;
        if (PERMITIDAS.has(tag)) {
          const e = document.createElement(tag.toLowerCase());
          copiar(n, e, prof + 1);
          destino.appendChild(e);
        } else copiar(n, destino, prof + 1); // A, SPAN, DIV, SUP, TABLE, TR, TD…: solo su contenido
      }
    })(doc.body, fragmento, 0);
    return r;
  }

  // ---------- Solo lectura (comodidad, no seguridad) ----------
  ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'].forEach(t => dlg.addEventListener(t, e => e.preventDefault()));
  document.addEventListener('keydown', e => {
    if (!abierto) return;
    // Imprimir, guardar, copiar, cortar y seleccionar todo
    if ((e.ctrlKey || e.metaKey) && /^[pscxa]$/i.test(e.key)) e.preventDefault();
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); cerrarLector(); });
  // Si el navegador cierra el diálogo por su cuenta (por ejemplo, Escape repetido), se quita también su nivel del historial.
  dlg.addEventListener('close', () => {
    if (!abierto) return;
    const enLector = history.state && history.state.nivel === 'lector';
    terminarLector();
    if (enLector) history.back();
  });
  botonVolver.addEventListener('click', cerrarLector);
  // Al salir de la página (o dejarla en la caché de ida y vuelta) no se queda nada abierto en memoria.
  window.addEventListener('pagehide', () => {
    if (abierto) terminarLector();
    if (urlWorker) { URL.revokeObjectURL(urlWorker); urlWorker = null; promesaWorker = null; }
  });

  // ---------- Arranque ----------
  // Al recargar con el lector abierto, se vuelve a la lista de ese reto (el lector no se reabre solo).
  const inicial = history.state || nivelDeLaUrl();
  history.replaceState(inicial.nivel === 'lector' ? { nivel: 'reto', reto: inicial.reto, dentro: inicial.dentro } : inicial, '');
  iniciar(true);
})();
