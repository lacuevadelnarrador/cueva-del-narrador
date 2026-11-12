// PROYECTO COMÚN (proyecto.html): la novela que escriben entre todos los socios (script 38).
// - Solo para socios activos: la guardia es Cueva.privada() y las funciones de la base de datos lo vuelven a comprobar.
// - Lectura: proyecto_info() (título, descripción y si las subidas están abiertas), proyecto_documentos() y
//   proyecto_capitulos(). Los archivos se leen dentro de la página con el visor común (lector.js, almacén "proyecto")
//   y, a diferencia de los retos, se pueden descargar (opción descargable; se guardan con su nombre_archivo).
// - Subir un capítulo o una versión nueva, en tres pasos: proyecto_iniciar_capitulo (da la ruta) → subida al almacén
//   (upsert: la versión nueva sustituye a la anterior) → proyecto_confirmar_capitulo. El socio NO puede borrar.
// - Los textos de error de las funciones vienen en castellano para el socio y se muestran tal cual (si no son técnicos).
// - Todo dato se pinta con textContent o nodos creados uno a uno; nunca con innerHTML.
// - No se guarda nada en localStorage/sessionStorage y la consola solo recibe errores sin datos (Cueva.registrar).
(function () {
  const MAX = 3145728; // 3 MB, como el almacén
  const TIPOS = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const NOMBRE_TIPO = { pdf: 'un PDF', docx: 'un documento de Word (.docx)' };
  const FIRMA = { pdf: [0x25, 0x50, 0x44, 0x46, 0x2D], docx: [0x50, 0x4B, 0x03, 0x04] }; // "%PDF-" y "PK\x03\x04" (zip)
  const CATEGORIAS = [['escaleta', 'Escaleta'], ['ideas', 'Ideas iniciales'], ['personajes', 'Personajes'], ['mundo', 'Mundo y ambientación'],
    ['estilo', 'Estilo'], ['otros', 'Otros']];
  const $ = id => document.getElementById(id);

  // ---------- Utilidades ----------
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
  const FECHA = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  // "actualizado" es una fecha sin hora (AAAA-MM-DD): se lee a mediodía UTC para que no cambie de día.
  const fecha = d => { const s = String(d || '').slice(0, 10), f = new Date(s + 'T12:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(f) ? FECHA.format(f) : ''; };
  const formato = ext => { ext = String(ext || '').toLowerCase(); return ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word' : ''; };
  const nombreCap = c => 'Capítulo ' + c.numero + (c.titulo ? ' · ' + c.titulo : '');
  const filas = d => Array.isArray(d) ? d : [];
  const unaFila = d => Array.isArray(d) ? d[0] : d;

  // Mensaje de un error de las funciones de la base de datos: sus textos vienen en castellano para el socio; cualquier
  // otra cosa (técnica, de red) se cambia por un texto general (mismo criterio que la entrega de los retos).
  const TECNICO = /violates|permission denied|function|relation|column|schema|syntax|null value|duplicate key|PGRST|JWT|fetch|network|timeout|[{}<>]/i;
  function textoRpc(e, general) {
    if (Cueva.esErrorDeRed(e)) return 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.';
    const t = String((e && e.message) || '').trim();
    if (t && t.length <= 200 && !TECNICO.test(t)) return t;
    return general;
  }
  function textoSubida(e) {
    if (Cueva.esErrorDeRed(e)) return 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.';
    const c = String((e && (e.statusCode || e.status)) || '');
    if (c === '413') return 'El archivo supera los 3 MB. Reduce su tamaño y vuelve a intentarlo.';
    if (c === '415') return 'Solo se pueden subir archivos PDF o Word (.docx).';
    return 'No se ha podido subir el archivo. Vuelve a intentarlo dentro de un momento.';
  }

  // ---------- Estado ----------
  let sb = null;
  let info = { titulo: '', descripcion: '', abierto: false };
  let documentos = [], capitulos = [];
  let ocupado = false;
  let modo = null;            // null (formulario cerrado) | { nuevo: true } | { numero, titulo } (versión nueva)
  let sinConfirmar = null;    // número de capítulo ya subido al almacén con la confirmación pendiente (fallo de red)

  // ---------- Carga ----------
  // Las tres lecturas salen a la vez que la guardia; no se pinta nada hasta que la guardia termina bien.
  // Cada consulta se convierte en una promesa una sola vez (una consulta de supabase-js se repite cada vez que se espera).
  const callada = p => { p.catch(() => {}); return p; };
  const pedir = s => ({ info: callada(Promise.resolve(s.rpc('proyecto_info'))), docs: callada(Promise.resolve(s.rpc('proyecto_documentos'))),
    caps: callada(Promise.resolve(s.rpc('proyecto_capitulos'))) });
  function iniciar(primera) {
    Cueva.cargando($('estado'), 'Cargando el proyecto…');
    $('proyecto').hidden = true;
    Cueva.privada(primera ? pedir : undefined)
      .then(async r => {
        sb = r.sb;
        const p = (r.previas && r.previas.info) ? r.previas : pedir(sb);
        const [ri, rd, rc] = await Promise.all([p.info, p.docs, p.caps]);
        [ri, rd, rc].forEach(x => { if (x.error) throw x.error; });
        const i = unaFila(ri.data) || {};
        info = { titulo: String(i.titulo || '').trim(), descripcion: String(i.descripcion || '').trim(), abierto: i.abierto === true || i.abierto === 'true' };
        documentos = filas(rd.data);
        capitulos = filas(rc.data);
        $('estado').replaceChildren();
        $('proyecto').hidden = false;
        pintarCabecera();
        pintarDocumentos();
        pintarCapitulos();
        mostrarPestana(location.hash === '#capitulos' ? 'cap' : 'doc', false);
      })
      .catch(e => errorCarga(e));
  }
  // Error al cargar: si la base de datos da un motivo claro (por ejemplo, cuenta no activa), se muestra tal cual;
  // si no, el mensaje general de Cueva. Siempre con "Reintentar".
  function errorCarga(e) {
    const propio = textoRpc(e, '');
    if (!propio || Cueva.esErrorDeRed(e)) { Cueva.error($('estado'), e, () => iniciar(false)); return; }
    Cueva.registrar('No se ha podido cargar el proyecto', e);
    const b = el('button', { type: 'button', clase: 'chip', texto: 'Reintentar' });
    b.addEventListener('click', () => iniciar(false));
    $('estado').replaceChildren(el('div', { clase: 'empty fallo', role: 'alert' }, [el('p', { texto: propio }), b]));
  }
  async function recargarCapitulos() {
    const r = await sb.rpc('proyecto_capitulos');
    if (r.error) throw r.error;
    capitulos = filas(r.data);
    pintarCapitulos();
  }

  // ---------- Cabecera ----------
  function pintarCabecera() {
    $('proy-titulo').textContent = info.titulo || 'Proyecto común';
    document.title = (info.titulo || 'Proyecto común') + ' · La Cueva del Narrador';
    $('proy-desc').textContent = info.descripcion || 'La novela que escribimos entre todos los socios.';
    $('proy-cerrado').hidden = info.abierto;
  }

  // ---------- Pestañas (tablist: flechas, Inicio y Fin) ----------
  const pestanas = () => [$('tab-doc'), $('tab-cap')];
  function mostrarPestana(cual, enfocar) {
    pestanas().forEach(t => {
      const si = t.id === 'tab-' + cual;
      t.setAttribute('aria-selected', String(si));
      t.tabIndex = si ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !si;
      if (si && enfocar) t.focus();
    });
    history.replaceState(history.state, '', cual === 'cap' ? '#capitulos' : location.pathname + location.search);
  }
  pestanas().forEach((t, i, todas) => {
    t.addEventListener('click', () => mostrarPestana(t.id.slice(4), false));
    t.addEventListener('keydown', e => {
      const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: todas.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      const destino = todas[(n + todas.length) % todas.length];
      mostrarPestana(destino.id.slice(4), true);
    });
  });

  // ---------- Documentación ----------
  function pintarDocumentos() {
    const panel = $('panel-doc');
    if (!documentos.length) {
      panel.replaceChildren(el('p', { clase: 'empty', texto: 'Todavía no hay documentación. Cuando la administración suba la escaleta, las fichas o las ideas del proyecto, aparecerán aquí.' }));
      return;
    }
    const partes = [];
    CATEGORIAS.forEach(([k, nombre]) => {
      const suyos = documentos.filter(d => d.categoria === k);
      if (!suyos.length) return;
      const ul = el('ul', { clase: 'proy-lista' });
      suyos.forEach(d => {
        const detalle = [d.actualizado ? 'Actualizado el ' + fecha(d.actualizado) : '', formato(d.extension)].filter(Boolean).join(' · ');
        const b = el('button', { type: 'button', clase: 'fila' }, [
          el('span', { clase: 'st' }, [
            el('b', { texto: d.titulo || 'Documento' }),
            d.descripcion ? el('span', { clase: 'proy-desc-doc', texto: d.descripcion }) : null,
            el('small', { texto: detalle })
          ])
        ]);
        b.addEventListener('click', () => abrir(d.ruta, d.extension, d.titulo || 'Documento', 'Documento del proyecto', b, d.nombre_archivo));
        ul.appendChild(el('li', null, [b]));
      });
      partes.push(el('h2', { clase: 'proy-h2', texto: nombre }), ul);
    });
    panel.replaceChildren(...partes);
  }

  // ---------- Capítulos ----------
  const mios = () => capitulos.filter(c => c.es_mio === true);
  function pintarCapitulos() {
    // Botón "Subir un capítulo nuevo" (o "Terminar la subida" si quedó una confirmación pendiente).
    const acciones = $('acciones-subida');
    acciones.replaceChildren();
    if (info.abierto) {
      if (sinConfirmar !== null) {
        const b = el('button', { type: 'button', clase: 'btn', texto: 'Terminar la subida del capítulo ' + sinConfirmar });
        b.addEventListener('click', reintentarConfirmar);
        acciones.appendChild(b);
      }
      if (!modo) {
        const b = el('button', { type: 'button', clase: sinConfirmar !== null ? 'btn sec' : 'btn', id: 'abrir-subida', texto: 'Subir un capítulo nuevo' });
        b.addEventListener('click', () => abrirForm({ nuevo: true }, b));
        acciones.appendChild(b);
      }
    }
    acciones.hidden = !acciones.firstChild;

    // Mis capítulos, con "Subir versión nueva" (no hay borrar)
    const caja = $('mis-capitulos');
    const propios = mios();
    if (!propios.length) caja.replaceChildren(el('p', { clase: 'pista', texto: 'Todavía no has subido ningún capítulo.' }));
    else caja.replaceChildren(...propios.map(c => {
      const detalle = ['Versión ' + (c.version || 1), c.actualizado ? fecha(c.actualizado) : '', formato(c.extension)].filter(Boolean).join(' · ');
      const fila = el('div', { clase: 'proy-mio' }, [el('span', { clase: 'proy-num', 'aria-hidden': 'true', texto: String(c.numero) }),
        el('span', { clase: 'st' }, [el('b', { texto: nombreCap(c) }), el('small', { texto: detalle })])]);
      if (info.abierto) {
        const b = el('button', { type: 'button', clase: 'chip', 'aria-label': 'Subir versión nueva del capítulo ' + c.numero, texto: 'Subir versión nueva' });
        b.addEventListener('click', () => abrirForm({ numero: c.numero, titulo: c.titulo || '' }, b));
        fila.appendChild(b);
      }
      return fila;
    }));

    // Todos los capítulos, por número
    const lista = $('lista-capitulos');
    if (!capitulos.length) {
      lista.replaceChildren(el('p', { clase: 'empty', texto: 'Todavía no hay capítulos. Cuando alguien suba el suyo, aparecerá aquí.' }));
      return;
    }
    const ul = el('ul', { clase: 'proy-lista' });
    capitulos.forEach(c => {
      const detalle = [c.autor || 'Socio del club', 'versión ' + (c.version || 1), c.actualizado ? fecha(c.actualizado) : '', formato(c.extension)].filter(Boolean).join(' · ');
      const b = el('button', { type: 'button', clase: 'fila' }, [
        el('span', { clase: 'proy-num', 'aria-hidden': 'true', texto: String(c.numero) }),
        el('span', { clase: 'st' }, [
          el('b', { texto: nombreCap(c) }),
          el('small', { texto: detalle }),
          c.es_mio === true ? el('span', { clase: 'proy-etqs' }, [el('span', { clase: 'proy-etq mio', texto: 'Mío' })]) : null
        ])
      ]);
      b.addEventListener('click', () => abrir(c.ruta, c.extension, nombreCap(c) + ' · ' + (c.autor || 'Socio del club'), 'Texto del capítulo', b, c.nombre_archivo));
      ul.appendChild(el('li', null, [b]));
    });
    lista.replaceChildren(ul);
  }

  // ---------- Lector ----------
  // En el proyecto los archivos se pueden descargar (descargable): el botón "Descargar" está en el visor.
  function abrir(ruta, extension, titulo, etiqueta, origen, nombre) {
    if (ocupado) return;
    Lector.abrir({ almacen: 'proyecto', ruta, extension, titulo, origen, etiqueta, estado: { proyecto: true }, descargable: true, nombre,
      sesion: 'Inicia sesión para leer el proyecto común.', registro: 'No se ha podido abrir un archivo del proyecto' });
  }
  window.addEventListener('popstate', () => {
    const s = history.state || {};
    if (Lector.abierto() && s.nivel !== 'lector') Lector.terminar();
    // Volver "hacia delante" a un lector ya cerrado: no se reabre.
    if (s.nivel === 'lector' && !Lector.abierto()) history.replaceState(null, '');
  });

  // ---------- Formulario de subida ----------
  const form = $('form-cap'), campoNum = $('cap-numero'), campoTit = $('cap-titulo'), campoArch = $('cap-archivo');
  let origenForm = null;
  function abrirForm(m, origen) {
    if (ocupado) return;
    modo = m; origenForm = origen || null;
    limpiarErrores();
    form.reset();
    const nueva = !m.nuevo;
    $('form-cap-titulo').textContent = nueva ? 'Versión nueva del capítulo ' + m.numero : 'Subir mi capítulo';
    campoNum.value = nueva ? String(m.numero) : '';
    campoNum.readOnly = nueva;
    campoTit.value = nueva ? m.titulo : '';
    $('cap-enviar').textContent = nueva ? 'Subir versión nueva' : 'Subir capítulo';
    form.hidden = false;
    pintarCapitulos(); // quita "Subir un capítulo nuevo" mientras el formulario está abierto
    $('form-cap-titulo').focus();
  }
  function cerrarForm(enfocarOrigen) {
    modo = null;
    form.hidden = true;
    form.reset();
    limpiarErrores();
    $('cap-progreso').hidden = true;
    pintarCapitulos();
    if (enfocarOrigen) { const b = $('abrir-subida'); if (b) b.focus(); }
  }
  $('cap-cancelar').addEventListener('click', () => { if (!ocupado) cerrarForm(true); });

  function marcar(campo, texto) {
    const p = $(campo.id + '-error');
    if (texto) { campo.setAttribute('aria-invalid', 'true'); p.textContent = texto; p.hidden = false; }
    else { campo.removeAttribute('aria-invalid'); p.textContent = ''; p.hidden = true; }
  }
  function limpiarErrores() { [campoNum, campoTit, campoArch].forEach(c => marcar(c, '')); }

  // Revisión en el navegador antes de subir nada: número, título, formato (por la extensión y por la firma), tamaño.
  async function revisar() {
    limpiarErrores();
    const errores = [];
    const n = Number(campoNum.value);
    if (!/^\d{1,2}$/.test(String(campoNum.value).trim()) || !Number.isInteger(n) || n < 1 || n > 99) errores.push([campoNum, 'Escribe un número de capítulo entre 1 y 99.']);
    const titulo = campoTit.value.trim();
    if (titulo.length < 3 || titulo.length > 100) errores.push([campoTit, 'El título tiene que tener entre 3 y 100 caracteres.']);
    const archivo = campoArch.files && campoArch.files[0];
    let ext = null;
    if (!archivo) errores.push([campoArch, 'Elige el archivo del capítulo (PDF o Word .docx).']);
    else {
      ext = (/\.(pdf|docx)$/i.exec(archivo.name || '') || [])[1];
      ext = ext ? ext.toLowerCase() : null;
      if (!ext) errores.push([campoArch, 'Solo se pueden subir archivos PDF o Word (.docx). Si es un .doc antiguo, guárdalo como .docx.']);
      else if (!archivo.size) errores.push([campoArch, 'El archivo está vacío.']);
      else if (archivo.size > MAX) errores.push([campoArch, 'El archivo ocupa más de 3 MB. Reduce su tamaño y vuelve a intentarlo.']);
      else {
        let cabeza;
        try { cabeza = new Uint8Array(await archivo.slice(0, FIRMA[ext].length).arrayBuffer()); } catch (e) { cabeza = null; }
        if (!cabeza) errores.push([campoArch, 'No se ha podido leer el archivo. Vuelve a elegirlo.']);
        else if (!FIRMA[ext].every((b, i) => cabeza[i] === b)) errores.push([campoArch, 'El archivo no parece ' + NOMBRE_TIPO[ext] + ' de verdad. Comprueba que lo has guardado en ese formato.']);
      }
    }
    errores.forEach(([c, t]) => marcar(c, t));
    if (errores.length) { errores[0][0].focus(); return null; }
    return { numero: n, titulo, archivo, ext, tipo: TIPOS[ext], tamano: archivo.size };
  }

  // ---------- Diálogo de confirmación (sustituir un capítulo que ya tienes) ----------
  function confirmar(titulo, texto, si) {
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(texto));
    return new Promise(ok => {
      const d = el('dialog', { clase: 'dialogo', 'aria-labelledby': 'proy-dlg-titulo', 'aria-describedby': 'proy-dlg-texto' }, [
        el('h2', { id: 'proy-dlg-titulo', texto: titulo }),
        el('p', { id: 'proy-dlg-texto', texto }),
        el('div', { clase: 'botones-form' }, [el('button', { type: 'button', clase: 'btn sec', value: 'no', texto: 'Cancelar' }), el('button', { type: 'button', clase: 'btn', value: 'si', texto: si })])
      ]);
      document.body.appendChild(d);
      let hecho = false;
      const terminar = r => { if (hecho) return; hecho = true; if (d.open) d.close(); d.remove(); ok(r); };
      d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) terminar(b.value === 'si'); });
      d.addEventListener('cancel', e => { e.preventDefault(); terminar(false); });
      d.addEventListener('close', () => terminar(false));
      d.showModal();
      d.querySelector('[value="no"]').focus();
    });
  }

  // ---------- Estado de la subida (texto visible además de la barra) ----------
  function estado(texto, error, enfocar) {
    const p = $('subida-estado');
    p.textContent = texto || '';
    p.hidden = !texto;
    p.classList.toggle('err', !!error);
    p.setAttribute('role', error ? 'alert' : 'status');
    if (texto && enfocar) p.focus({ preventScroll: false });
  }
  function progreso(paso) {
    const b = $('cap-progreso');
    b.hidden = paso == null;
    if (paso != null) { b.value = paso; b.setAttribute('aria-valuetext', ['Preparando', 'Subiendo el archivo', 'Confirmando', 'Terminado'][paso] || ''); }
  }
  const salir = e => { e.preventDefault(); e.returnValue = ''; };
  function bloquear(si) {
    ocupado = si;
    [...form.elements].forEach(x => { x.disabled = si; });
    document.querySelectorAll('.pagehead, .nav, .proy-tabs').forEach(x => { x.inert = si; });
    $('panel-cap').setAttribute('aria-busy', String(si));
    if (si) window.addEventListener('beforeunload', salir); else window.removeEventListener('beforeunload', salir);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (ocupado || !modo) return;
    estado('');
    const v = await revisar();
    if (!v) return;
    const yaLoTengo = mios().find(c => Number(c.numero) === v.numero);
    if (yaLoTengo && !(await confirmar('Sustituir tu capítulo', 'Ya tienes el capítulo ' + v.numero + ': se sustituirá por esta versión nueva.', 'Sustituir'))) {
      $('cap-enviar').focus();
      return;
    }
    if (!navigator.onLine) { estado('No hay conexión. Conéctate a internet para subir tu capítulo.', true, true); return; }
    await subir(v);
  });

  async function subir(v) {
    bloquear(true);
    let error = null, paso = 'iniciar', res = null;
    try {
      progreso(0); estado('Preparando la subida del capítulo ' + v.numero + '…');
      const ini = await sb.rpc('proyecto_iniciar_capitulo', { p_numero: v.numero, p_titulo: v.titulo, p_ext: v.ext, p_tamano: v.tamano });
      if (ini.error) throw ini.error;
      const d = unaFila(ini.data);
      const ruta = typeof d === 'string' ? d : d && (d.ruta || d.proyecto_iniciar_capitulo);
      if (!ruta) throw {};
      paso = 'subir'; progreso(1); estado('Subiendo el archivo (' + Math.max(1, Math.round(v.tamano / 1024)) + ' KB)…');
      const sub = await sb.storage.from('proyecto').upload(ruta, v.archivo, { upsert: true, contentType: v.tipo });
      if (sub.error) throw sub.error;
      paso = 'confirmar'; progreso(2); estado('Confirmando…');
      res = await confirmarCap(v.numero);
    } catch (x) { error = x; }
    bloquear(false);
    if (error) return fallo(paso, error, v.numero);
    terminado(v.numero, res);
  }
  async function confirmarCap(numero) {
    const r = await sb.rpc('proyecto_confirmar_capitulo', { p_numero: numero });
    if (r.error) throw r.error;
    return unaFila(r.data) || {};
  }
  async function reintentarConfirmar() {
    if (ocupado || sinConfirmar === null) return;
    if (!navigator.onLine) { estado('No hay conexión. Conéctate a internet para terminar la subida.', true, true); return; }
    const numero = sinConfirmar;
    bloquear(true);
    let error = null, res = null;
    try { estado('Confirmando…'); res = await confirmarCap(numero); } catch (x) { error = x; }
    bloquear(false);
    if (error) return fallo('confirmar', error, numero);
    terminado(numero, res);
  }
  async function terminado(numero, res) {
    sinConfirmar = null;
    progreso(3);
    const version = res && res.version ? ' (versión ' + res.version + ')' : '';
    cerrarForm(false);
    try { await recargarCapitulos(); } catch (e) { Cueva.registrar('No se ha podido recargar la lista de capítulos', e); }
    estado('Capítulo ' + numero + ' subido' + version + '. Ya lo pueden leer los demás socios.', false, true);
    Cueva.aviso('Capítulo ' + numero + ' subido.', 'ok');
  }
  function fallo(paso, e, numero) {
    Cueva.registrar(paso === 'subir' ? 'No se ha podido subir un capítulo' : paso === 'confirmar' ? 'No se ha podido confirmar un capítulo' : 'No se ha podido empezar la subida de un capítulo', e);
    progreso(null);
    let texto;
    if (paso === 'subir') texto = textoSubida(e);
    else if (paso === 'confirmar') {
      // Si la base de datos explica el motivo (por ejemplo, que el archivo no se ha subido bien), hay que volver a
      // subirlo; si es un fallo de red o desconocido, se ofrece "Terminar la subida" (solo repite la confirmación).
      const propio = textoRpc(e, '') !== '' && !Cueva.esErrorDeRed(e);
      if (propio) { sinConfirmar = null; texto = textoRpc(e, '').replace(/([^.!?])$/, '$1.') + ' Vuelve a elegir el archivo y súbelo otra vez.'; }
      else { sinConfirmar = numero; texto = 'El archivo se ha subido, pero falta confirmarlo. ' + (Cueva.esErrorDeRed(e) ? 'Comprueba tu conexión y pulsa' : 'Pulsa') + ' «Terminar la subida».'; }
    } else texto = textoRpc(e, 'No se ha podido empezar la subida. Vuelve a intentarlo dentro de un momento.');
    if (sinConfirmar !== null) cerrarForm(false); else pintarCapitulos();
    estado(texto, true, true);
  }

  // ---------- Arranque ----------
  // Al recargar con el lector abierto, se vuelve a la página (el lector no se reabre solo).
  if (history.state && history.state.nivel === 'lector') history.replaceState(null, '');
  iniciar(true);
})();
