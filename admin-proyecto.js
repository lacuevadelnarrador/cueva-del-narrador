// PANEL: PROYECTO COMÚN (admin-proyecto.html). Solo administradores (Admin.iniciar).
// - Ajustes (tabla proyecto_ajustes: claves 'titulo', 'descripcion' y 'abierto' con valor 'true'/'false'): solo UPDATE.
// - Documentación (tabla proyecto_documentos, también las pendientes, subido = false):
//   subir = proyecto_admin_iniciar_documento → upload a doc/<id> → proyecto_admin_confirmar_documento (y el orden, si no
//   es 0, con un UPDATE). Si la subida falla después de iniciar, se intenta borrar la fila pendiente.
//   Editar: solo categoria, titulo, descripcion y orden. Borrar: primero la fila y después el archivo (si el archivo
//   falla, se avisa).
// - Capítulos (tabla proyecto_capitulos, también los pendientes: subido = false o pendiente_desde no nulo): ver todos y
//   borrar (primero la fila y después el archivo cap/<socio>/<número>). Los autores salen de socios.nombre_completo (con
//   nombre_pila de respaldo), como en admin-entregas.js.
// - Todo dato se pinta con textContent (nodos creados uno a uno). La consola solo recibe errores sin datos.
(function () {
  const ALMACEN = 'proyecto';
  const MAX = 3145728;
  const TIPOS = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const FIRMA = { pdf: [0x25, 0x50, 0x44, 0x46, 0x2D], docx: [0x50, 0x4B, 0x03, 0x04] };
  const CATEGORIAS = [['escaleta', 'Escaleta'], ['ideas', 'Ideas iniciales'], ['personajes', 'Personajes'], ['mundo', 'Mundo y ambientación'],
    ['estilo', 'Estilo'], ['otros', 'Otros']];
  const NOMBRE_CAT = Object.fromEntries(CATEGORIAS);
  const $ = id => document.getElementById(id);

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
  const formato = ext => ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word' : '';
  const kb = n => n ? Math.max(1, Math.round(Number(n) / 1024)) + ' KB' : '';
  const unaFila = d => Array.isArray(d) ? d[0] : d;
  // Mensaje de las funciones de la base de datos (en castellano) o, si es técnico, el general de Admin.
  const TECNICO = /violates|permission denied|function|relation|column|schema|syntax|null value|duplicate key|PGRST|JWT|fetch|network|timeout|[{}<>]/i;
  const texto = e => { const t = String((e && e.message) || '').trim(); return t && t.length <= 200 && !TECNICO.test(t) && !Cueva.esErrorDeRed(e) ? t : Admin.mensajeError(e); };
  const fallar = (caja, e, registro) => { Cueva.registrar(registro, e); Admin.estado(caja, texto(e), true); };

  let ajustes = {}, docs = [], caps = [], nombres = new Map();

  // ---------- Carga ----------
  async function leer() {
    const sb = await Admin.iniciar();
    const [a, d, c, s] = await Promise.all([
      sb.from('proyecto_ajustes').select('clave,valor'),
      sb.from('proyecto_documentos').select('id,categoria,titulo,descripcion,orden,ruta,extension,nombre_archivo,tamano,subido,creado,actualizado').order('categoria').order('orden').order('titulo'),
      sb.from('proyecto_capitulos').select('id,socio_id,numero,titulo,ruta,extension,nombre_archivo,tamano,version,subido,actualizado,pend_titulo,pend_extension,pend_tamano,pendiente_desde,creado').order('numero').order('creado'),
      sb.from('socios').select('id,nombre_completo,nombre_pila')
    ]);
    [a, d, c, s].forEach(r => { if (r.error) throw r.error; });
    return { a: a.data || [], d: d.data || [], c: c.data || [], s: s.data || [] };
  }
  function cargar() {
    Cueva.cargar($('estado'), () => leer().then(data => ({ data, error: null })), r => {
      ajustes = Object.fromEntries(r.a.map(x => [x.clave, x.valor]));
      docs = r.d; caps = r.c;
      nombres = new Map(r.s.map(x => [x.id, x.nombre_completo || x.nombre_pila || 'Socio sin nombre']));
      $('estado').replaceChildren();
      $('contenido').hidden = false;
      pintarAjustes(); pintarDocs(); pintarCaps();
    });
  }
  // Tras un cambio: se vuelve a leer en silencio (sin "Cargando…"); si falla, se queda lo que había.
  async function refrescar() {
    try {
      const r = await leer();
      ajustes = Object.fromEntries(r.a.map(x => [x.clave, x.valor])); docs = r.d; caps = r.c;
      nombres = new Map(r.s.map(x => [x.id, x.nombre_completo || x.nombre_pila || 'Socio sin nombre']));
      pintarDocs(); pintarCaps();
    } catch (e) { Cueva.registrar('No se ha podido recargar el proyecto', e); }
  }

  // ---------- 1. Ajustes ----------
  function pintarAjustes() {
    $('aj-titulo').value = ajustes.titulo || '';
    $('aj-descripcion').value = ajustes.descripcion || '';
    pintarInterruptor(ajustes.abierto === 'true');
  }
  function pintarInterruptor(si) {
    const b = $('abierto');
    b.setAttribute('aria-checked', String(si));
    b.querySelector('.perfil-switch-texto').textContent = si ? 'Sí' : 'No';
  }
  $('abierto').addEventListener('click', async () => {
    const b = $('abierto'), nuevo = b.getAttribute('aria-checked') !== 'true';
    const r = await Admin.escribir($('caja-ajustes'), () => Admin.sb().from('proyecto_ajustes').update({ valor: nuevo ? 'true' : 'false' }).eq('clave', 'abierto').select('clave,valor'),
      nuevo ? 'Subidas de capítulos abiertas.' : 'Subidas de capítulos cerradas.');
    if (r) { ajustes.abierto = r[0].valor; pintarInterruptor(r[0].valor === 'true'); }
    b.focus({ preventScroll: true });
  });
  $('form-ajustes').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, titulo = $('aj-titulo').value.trim(), descripcion = $('aj-descripcion').value.trim();
    const cambios = [['titulo', titulo], ['descripcion', descripcion]].filter(([k, v]) => (ajustes[k] || '') !== v);
    if (!cambios.length) { Admin.estado(f, 'No hay cambios que guardar.'); return; }
    const sb = Admin.sb();
    const r = await Admin.escribir(f, async () => {
      const filas = [];
      for (const [k, v] of cambios) {
        const x = await sb.from('proyecto_ajustes').update({ valor: v }).eq('clave', k).select('clave,valor');
        if (x.error) return x;
        if (!x.data || !x.data.length) return { data: [], error: null };
        filas.push(...x.data);
      }
      return { data: filas, error: null };
    }, 'Ajustes guardados.');
    if (r) r.forEach(x => { ajustes[x.clave] = x.valor; });
  });

  // ---------- 2. Documentación ----------
  const formDoc = $('form-doc');
  let editando = null; // null = documento nuevo; si no, la fila que se edita
  function abrirDoc(fila) {
    editando = fila || null;
    Admin.limpiar(formDoc);
    formDoc.reset();
    $('form-doc-titulo').textContent = fila ? 'Editar documento' : 'Subir documento';
    $('doc-enviar').textContent = fila ? 'Guardar cambios' : 'Subir documento';
    $('campo-doc-archivo').hidden = !!fila;
    $('doc-archivo').required = !fila;
    $('doc-categoria').value = fila ? fila.categoria : 'escaleta';
    $('doc-titulo').value = fila ? fila.titulo : '';
    $('doc-descripcion').value = fila ? (fila.descripcion || '') : '';
    $('doc-orden').value = fila ? String(fila.orden || 0) : '0';
    formDoc.hidden = false;
    $('docs-acciones').hidden = true;
    $('form-doc-titulo').focus();
  }
  function cerrarDoc() {
    formDoc.hidden = true; editando = null;
    $('docs-acciones').hidden = false;
    $('doc-nuevo').focus();
  }
  $('doc-nuevo').addEventListener('click', () => abrirDoc(null));
  $('doc-cancelar').addEventListener('click', cerrarDoc);

  async function revisarDoc() {
    Admin.limpiar(formDoc);
    const titulo = $('doc-titulo').value.trim(), descripcion = $('doc-descripcion').value.trim(), orden = Number($('doc-orden').value || 0);
    const errores = [];
    if (titulo.length < 3 || titulo.length > 100) errores.push([$('doc-titulo'), 'El título tiene que tener entre 3 y 100 caracteres.']);
    if (descripcion.length > 300) errores.push([$('doc-descripcion'), 'La descripción tiene que tener como máximo 300 caracteres.']);
    if (!Number.isInteger(orden) || Math.abs(orden) > 1000000) errores.push([$('doc-orden'), 'El orden tiene que ser un número entero.']);
    let archivo = null, ext = null;
    if (!editando) {
      archivo = $('doc-archivo').files && $('doc-archivo').files[0];
      ext = archivo && ((/\.(pdf|docx)$/i.exec(archivo.name || '') || [])[1] || '').toLowerCase();
      if (!archivo) errores.push([$('doc-archivo'), 'Elige el archivo (PDF o Word .docx).']);
      else if (!ext) errores.push([$('doc-archivo'), 'Solo se pueden subir archivos PDF o Word (.docx).']);
      else if (!archivo.size || archivo.size > MAX) errores.push([$('doc-archivo'), archivo.size ? 'El archivo ocupa más de 3 MB.' : 'El archivo está vacío.']);
      else {
        let cab = null;
        try { cab = new Uint8Array(await archivo.slice(0, FIRMA[ext].length).arrayBuffer()); } catch (e) {}
        if (!cab || !FIRMA[ext].every((b, i) => cab[i] === b)) errores.push([$('doc-archivo'), 'El archivo no parece un ' + (ext === 'pdf' ? 'PDF' : 'Word (.docx)') + ' de verdad.']);
      }
    }
    if (errores.length) {
      Admin.estado(formDoc, errores.map(x => x[1]).join(' '), true);
      errores.forEach(([c]) => c.setAttribute('aria-invalid', 'true'));
      errores[0][0].focus();
      return null;
    }
    return { categoria: $('doc-categoria').value, titulo, descripcion: descripcion || null, orden, archivo, ext };
  }

  formDoc.addEventListener('submit', async e => {
    e.preventDefault();
    const v = await revisarDoc();
    if (!v) return;
    const sb = Admin.sb();
    if (editando) {
      const id = editando.id;
      const r = await Admin.escribir(formDoc, () => sb.from('proyecto_documentos').update({ categoria: v.categoria, titulo: v.titulo, descripcion: v.descripcion, orden: v.orden })
        .eq('id', id).select('id'), 'Documento guardado.');
      if (r) { formDoc.hidden = true; editando = null; $('docs-acciones').hidden = false; await refrescar(); $('doc-nuevo').focus(); }
      return;
    }
    // Documento nuevo: iniciar → subir → confirmar (→ orden). Bloquea el formulario mientras dura.
    const soltar = Admin.bloquear(formDoc);
    let id = null, paso = 'iniciar';
    try {
      Admin.estado(formDoc, 'Preparando la subida…');
      const ini = await sb.rpc('proyecto_admin_iniciar_documento', { p_categoria: v.categoria, p_titulo: v.titulo, p_descripcion: v.descripcion, p_ext: v.ext, p_tamano: v.archivo.size });
      if (ini.error) throw ini.error;
      const d = unaFila(ini.data) || {};
      id = d.id; const ruta = d.ruta;
      if (id == null || !ruta) throw {};
      paso = 'subir'; Admin.estado(formDoc, 'Subiendo el archivo (' + kb(v.archivo.size) + ')…');
      const sub = await sb.storage.from(ALMACEN).upload(ruta, v.archivo, { upsert: true, contentType: TIPOS[v.ext] });
      if (sub.error) throw sub.error;
      paso = 'confirmar'; Admin.estado(formDoc, 'Confirmando…');
      const conf = await sb.rpc('proyecto_admin_confirmar_documento', { p_id: id });
      if (conf.error) throw conf.error;
      if (v.orden !== 0) {
        paso = 'orden';
        const o = await sb.from('proyecto_documentos').update({ orden: v.orden }).eq('id', id).select('id');
        if (o.error || !o.data || !o.data.length) throw o.error || { sinFilas: true };
      }
      Admin.estado(formDoc, '');
      soltar();
      Cueva.aviso('Documento subido.', 'ok');
      formDoc.hidden = true; $('docs-acciones').hidden = false;
      await refrescar();
      $('doc-nuevo').focus();
    } catch (e) {
      Cueva.registrar('No se ha podido subir un documento del proyecto', e);
      let m = paso === 'subir' ? (Cueva.esErrorDeRed(e) ? 'No hay conexión con el servidor.' : 'No se ha podido subir el archivo.') : texto(e);
      // Si falla la subida al almacén, se intenta borrar la fila pendiente que acaba de crear "iniciar".
      if (paso === 'subir' && id != null) {
        try {
          const b = await sb.from('proyecto_documentos').delete().eq('id', id).eq('subido', false).select('id');
          if (b.error || !b.data || !b.data.length) throw b.error || { sinFilas: true };
          m += ' No se ha guardado nada. Vuelve a intentarlo.';
        } catch (x) {
          Cueva.registrar('No se ha podido borrar un documento pendiente', x);
          m += ' Ha quedado un documento pendiente en la lista: bórralo antes de volver a intentarlo.';
        }
      } else if (paso === 'confirmar') m += ' El documento ha quedado pendiente: puedes pulsar «Terminar la subida» en la lista o borrarlo.';
      else if (paso === 'orden') m = 'El documento se ha subido, pero no se ha podido guardar el orden. Edítalo desde la lista.';
      Admin.estado(formDoc, m, true);
      soltar();
      await refrescar();
    }
  });

  function pintarDocs() {
    const caja = $('lista-docs');
    if (!docs.length) { caja.replaceChildren(el('p', { clase: 'empty', texto: 'Todavía no hay documentación.' })); return; }
    const partes = [];
    CATEGORIAS.forEach(([k, nombre]) => {
      const suyos = docs.filter(d => d.categoria === k);
      if (!suyos.length) return;
      const ul = el('ul', { clase: 'ap-lista' });
      suyos.forEach(d => {
        const detalle = [d.subido ? (d.actualizado ? 'Actualizado: ' + Admin.fecha(d.actualizado) : '') : 'Sin confirmar', formato(d.extension), kb(d.tamano), 'Orden ' + (d.orden || 0)].filter(Boolean).join(' · ');
        const botones = el('div', { clase: 'ap-botones' });
        if (!d.subido) {
          const t = el('button', { type: 'button', clase: 'chip', 'aria-label': 'Terminar la subida de «' + d.titulo + '»', texto: 'Terminar la subida' });
          t.addEventListener('click', () => confirmarDoc(d, t));
          botones.appendChild(t);
        }
        const ed = el('button', { type: 'button', clase: 'chip', 'aria-label': 'Editar «' + d.titulo + '»', texto: 'Editar' });
        ed.addEventListener('click', () => abrirDoc(d));
        const bo = el('button', { type: 'button', clase: 'chip ap-borrar', 'aria-label': 'Borrar «' + d.titulo + '»', texto: 'Borrar' });
        bo.addEventListener('click', () => borrarDoc(d));
        botones.append(ed, bo);
        ul.appendChild(el('li', { clase: 'ap-fila' }, [
          el('span', { clase: 'st' }, [
            el('b', { texto: d.titulo }),
            d.descripcion ? el('span', { clase: 'ap-desc', texto: d.descripcion }) : null,
            el('small', { texto: detalle }),
            !d.subido ? el('span', { clase: 'ap-etq pend', texto: 'Pendiente' }) : null
          ]),
          botones
        ]));
      });
      partes.push(el('h3', { texto: nombre + ' (' + suyos.length + ')' }), ul);
    });
    caja.replaceChildren(...partes);
  }
  async function confirmarDoc(d, b) {
    const caja = $('caja-docs'), soltar = Admin.bloquear(caja);
    Admin.estado(caja, 'Confirmando…');
    try {
      const r = await Admin.sb().rpc('proyecto_admin_confirmar_documento', { p_id: d.id });
      if (r.error) throw r.error;
      Admin.estado(caja, '');
      Cueva.aviso('Documento confirmado.', 'ok');
    } catch (e) { fallar(caja, e, 'No se ha podido confirmar un documento del proyecto'); }
    soltar();
    await refrescar();
  }
  async function borrarDoc(d) {
    const si = await Admin.confirmar('Se borrará el documento «' + d.titulo + '» y su archivo. Los socios dejarán de verlo. Esta acción no se puede deshacer.', 'Borrar documento');
    if (!si) return;
    await borrarFilaYArchivo($('caja-docs'), 'proyecto_documentos', d.id, d.ruta, 'Documento borrado.', 'el documento');
  }

  // Borra primero la fila y después el archivo del almacén. Si el archivo falla, avisa (la fila ya no está).
  async function borrarFilaYArchivo(caja, tabla, id, ruta, textoOk, que) {
    const sb = Admin.sb();
    const r = await Admin.escribir(caja, () => sb.from(tabla).delete().eq('id', id).select('id'));
    if (!r) return;
    let avisoArchivo = null;
    try {
      const x = await sb.storage.from(ALMACEN).remove([ruta]);
      if (x.error) throw x.error;
    } catch (e) {
      Cueva.registrar('No se ha podido borrar un archivo del proyecto', e);
      avisoArchivo = 'Se ha borrado ' + que + ', pero no su archivo del almacén. Avisa a quien mantiene la web para quitarlo a mano.';
    }
    if (avisoArchivo) { Admin.estado(caja, avisoArchivo, true); Cueva.aviso(avisoArchivo, 'err'); }
    else Cueva.aviso(textoOk, 'ok');
    await refrescar();
    const h = caja.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); }
  }

  // ---------- 3. Capítulos ----------
  function pintarCaps() {
    const caja = $('lista-caps');
    if (!caps.length) { caja.replaceChildren(el('p', { clase: 'empty', texto: 'Todavía no hay capítulos.' })); return; }
    const ul = el('ul', { clase: 'ap-lista' });
    caps.forEach(c => {
      const autor = nombres.get(c.socio_id) || 'Socio sin ficha';
      const nunca = c.subido !== true, sustituyendo = !nunca && !!c.pendiente_desde;
      const detalle = [autor, nunca ? 'nunca confirmado' : 'versión ' + (c.version || 1), c.actualizado ? Admin.fecha(c.actualizado) : '', formato(c.extension), kb(c.tamano)].filter(Boolean).join(' · ');
      const titulo = 'Capítulo ' + c.numero + ' · ' + (c.titulo || '');
      const bo = el('button', { type: 'button', clase: 'chip ap-borrar', 'aria-label': 'Borrar el capítulo ' + c.numero + ' de ' + autor, texto: 'Borrar' });
      bo.addEventListener('click', () => borrarCap(c, autor));
      ul.appendChild(el('li', { clase: 'ap-fila' }, [
        el('span', { clase: 'st' }, [
          el('b', { texto: titulo }),
          el('small', { texto: detalle }),
          nunca ? el('span', { clase: 'ap-etq pend', texto: 'Pendiente: no se ha confirmado nunca' }) : null,
          sustituyendo ? el('span', { clase: 'ap-etq pend', texto: 'Versión nueva sin confirmar' + (c.pend_titulo ? ': «' + c.pend_titulo + '»' : '') }) : null
        ]),
        el('div', { clase: 'ap-botones' }, [bo])
      ]));
    });
    caja.replaceChildren(el('p', { clase: 'pista', texto: caps.length + (caps.length === 1 ? ' capítulo' : ' capítulos') }), ul);
  }
  async function borrarCap(c, autor) {
    const si = await Admin.confirmar('Se borrará el capítulo ' + c.numero + ' («' + (c.titulo || '') + '») de ' + autor + ' y su archivo. Esta acción no se puede deshacer.', 'Borrar capítulo');
    if (!si) return;
    await borrarFilaYArchivo($('caja-caps'), 'proyecto_capitulos', c.id, c.ruta, 'Capítulo borrado.', 'el capítulo');
  }

  cargar();
})();
