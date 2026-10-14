// PANEL: AVISOS (admin-avisos.html). Solo administradores (Admin.iniciar). Script de la base de datos: supabase_25_avisos.sql
// - Avisos automáticos (avisos_config): solo se cambian "activo" y "dias"; cada cambio se guarda al momento.
// - Estado (avisos_estado, una sola fila): cuándo pasó por última vez la tarea automática y cuántos avisos creó hoy.
//   "Ver avisos creados" (supabase_26): RPC avisos_del_dia(p_dia) por tipo y destinatarios_avisos(p_dia, p_tipo) (máx. 300).
// - Enviar un aviso: RPC enviar_aviso_libre (a todos los socios activos o a uno). Destinatarios = socios con ficha cuya
//   cuenta está activa (perfiles.activo = true), lo mismo que usa la función.
// - Historial: RPC historial_avisos_libres(); "Retirar" borra el aviso libre (y, en cascada, el de cada socio).
// Cada escritura termina en .select() y se comprueba que ha cambiado exactamente una fila. Todo lo que viene de la
// base de datos se escapa o se pinta con textContent. En la consola, solo errores sin datos (Cueva.registrar).

(function () {
  const esc = Admin.esc, el = id => document.getElementById(id);
  const LOTE = 1000;
  const MADRID = 'Europe/Madrid';
  const PAGINAS = { 'inicio.html': 'Inicio', 'calendario.html': 'Calendario', 'curso.html': 'Curso', 'retos.html': 'Retos', 'biblioteca.html': 'Biblioteca', 'perfil.html': 'Mi perfil' };
  // Mensajes de las funciones de la base de datos (ya en castellano): se muestran tal cual. Cualquier otro, el genérico.
  const MENSAJES_BD = [
    'Solo los administradores pueden enviar avisos.',
    'El título debe tener entre 1 y 80 caracteres.',
    'El texto debe tener entre 1 y 300 caracteres.',
    'El enlace no es válido.',
    'Ese socio no existe o no está activo.',
    'Solo los administradores pueden ver este historial.',
    'Solo los administradores pueden ver este resumen.',
    'Solo los administradores pueden ver este detalle.'
  ];
  const mensajeError = e => e && typeof e.message === 'string' && MENSAJES_BD.includes(e.message) ? e.message : Admin.mensajeError(e);

  let sb = null, TIPOS = [], DESTINOS = [];

  // ---------- Fechas y horas de Madrid ----------
  function partesMadrid(d) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p;
  }
  const diaMadrid = d => { const p = partesMadrid(d); return p.year + '-' + p.month + '-' + p.day; };
  const fechaHora = d => { const p = partesMadrid(d); return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute; };
  const fechaDe = t => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d : null; };
  const numero = n => Number(n || 0).toLocaleString('es-ES');
  const socios = n => numero(n) + (Number(n) === 1 ? ' socio' : ' socios');

  // ---------- Lectura ----------
  async function todas(hacer) {
    const filas = [];
    for (let i = 0; ; i += LOTE) {
      const r = await hacer().range(i, i + LOTE - 1);
      if (r.error) throw r.error;
      const d = r.data || [];
      filas.push(...d);
      if (d.length < LOTE) return filas;
    }
  }
  async function leer() {
    sb = await Admin.iniciar();
    const [config, estado, fichas, activas] = await Promise.all([
      sb.from('avisos_config').select('tipo,titulo,descripcion,activo,dias,etiqueta_dias,orden').order('orden').then(r => { if (r.error) throw r.error; return r.data || []; }),
      sb.from('avisos_estado').select('ultima_ejecucion,dia,creados_dia').maybeSingle().then(r => { if (r.error) throw r.error; return r.data; }),
      todas(() => sb.from('socios').select('id,nombre_completo').order('nombre_completo').order('id')),
      todas(() => sb.from('perfiles').select('id').eq('activo', true).order('id'))
    ]);
    const ids = new Set(activas.map(p => p.id));
    return { data: { config, estado, destinos: fichas.filter(s => ids.has(s.id)) } };
  }

  // ---------- a) Avisos automáticos ----------
  const diasDe = t => Array.isArray(t.dias) ? t.dias.filter(n => Number.isInteger(n)) : [];
  function pintarTipos() {
    el('tipos').innerHTML = TIPOS.map((t, i) => {
      const id = 'tipo-' + i, dias = diasDe(t);
      const campos = t.etiqueta_dias == null ? '' :
        '<fieldset class="opciones avi-dias" id="' + id + '-dias" aria-describedby="' + id + '-dias-pista">' +
        '<legend>' + esc(t.etiqueta_dias) + '</legend>' +
        '<div class="avi-dias-campos">' + [0, 1, 2].map(k =>
          '<input class="entrada avi-dia" type="number" inputmode="numeric" min="0" max="31" step="1" name="' + id + '-d' + k + '" data-i="' + i + '" ' +
          'aria-label="' + esc(t.etiqueta_dias) + ', valor ' + (k + 1) + '" value="' + (dias[k] != null ? dias[k] : '') + '">').join('') + '</div>' +
        '<p class="pista" id="' + id + '-dias-pista">Entre 1 y 3 valores; se guardan al salir del campo.</p>' +
        '<p class="error-campo" id="' + id + '-dias-error" hidden></p></fieldset>';
      return '<li class="avi-tipo"><div class="avi-tipo-cab"><div class="avi-tipo-tx">' +
        '<h3 id="' + id + '-t">' + esc(t.titulo) + '</h3>' + (t.descripcion ? '<p class="pista" id="' + id + '-d">' + esc(t.descripcion) + '</p>' : '') + '</div>' +
        '<button type="button" class="perfil-switch" role="switch" data-i="' + i + '" aria-checked="' + (t.activo === true) + '" aria-labelledby="' + id + '-t"' +
        (t.descripcion ? ' aria-describedby="' + id + '-d"' : '') + '><span class="perfil-switch-pista" aria-hidden="true"><span></span></span>' +
        '<span class="perfil-switch-texto" aria-hidden="true">' + (t.activo === true ? 'Sí' : 'No') + '</span></button></div>' + campos + '</li>';
    }).join('') || '<li class="empty">No hay tipos de avisos automáticos en la base de datos.</li>';
  }

  // Guarda un cambio de un tipo: bloquea la página (aria-busy) y exige que se actualice exactamente 1 fila.
  async function guardarTipo(t, cambio) {
    const filas = await Admin.escribir(el('sec-auto'), async () => {
      const r = await sb.from('avisos_config').update(cambio).eq('tipo', t.tipo).select('tipo,activo,dias');
      if (!r.error && Array.isArray(r.data) && r.data.length > 1) return { data: null, error: { mensaje: 'Se ha cambiado más de un tipo de aviso. Recarga la página y revisa la configuración.' } };
      return r;
    }, 'Cambio guardado.');
    if (!filas) return false;
    Object.assign(t, { activo: filas[0].activo, dias: filas[0].dias });
    return true;
  }

  el('tipos').addEventListener('click', async e => {
    const sw = e.target.closest('.perfil-switch');
    if (!sw || sw.disabled) return;
    const t = TIPOS[+sw.dataset.i];
    if (!t) return;
    const nuevo = sw.getAttribute('aria-checked') !== 'true';
    if (!(await guardarTipo(t, { activo: nuevo }))) return;
    sw.setAttribute('aria-checked', String(t.activo === true));
    sw.querySelector('.perfil-switch-texto').textContent = t.activo === true ? 'Sí' : 'No';
  });

  // Tipos cuyos "dias" son días del mes: de 1 a 28 (así existen en todos los meses)
  const DIAS_DEL_MES = ['cuota', 'retos_pendientes'];
  // Valida los días de un tipo: enteros de 0 a 31 (1 a 28 en DIAS_DEL_MES), sin repetidos, entre 1 y 3. Devuelve la lista
  // ordenada o null (y marca el error en el grupo).
  function leerDias(caja, t) {
    const campos = [...caja.querySelectorAll('.avi-dia')];
    const [min, max] = DIAS_DEL_MES.includes(t.tipo) ? [1, 28] : [0, 31];
    const error = caja.querySelector('.error-campo');
    campos.forEach(c => c.removeAttribute('aria-invalid'));
    let m = '', malos = [];
    const valores = [];
    campos.forEach(c => {
      const v = c.value.trim();
      if (c.validity && c.validity.badInput) { malos.push(c); return; }
      if (!v) return;
      if (!/^\d+$/.test(v) || +v < min || +v > max) { malos.push(c); return; }
      valores.push(+v);
    });
    if (malos.length) m = 'Escribe números enteros entre ' + min + ' y ' + max + '.';
    else if (!valores.length) { m = 'Escribe al menos un valor.'; malos = [campos[0]]; }
    else if (new Set(valores).size !== valores.length) { m = 'No repitas el mismo valor.'; malos = campos.filter(c => c.value.trim() && valores.filter(x => x === +c.value.trim()).length > 1); }
    error.textContent = m;
    error.hidden = !m;
    malos.forEach(c => c.setAttribute('aria-invalid', 'true'));
    campos.forEach(c => {
      const desc = (c.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== error.id);
      if (m && malos.includes(c)) desc.push(error.id);
      if (desc.length) c.setAttribute('aria-describedby', desc.join(' ')); else c.removeAttribute('aria-describedby');
    });
    return m ? null : valores.sort((a, b) => a - b);
  }

  el('tipos').addEventListener('change', async e => {
    const c = e.target.closest('.avi-dia');
    if (!c) return;
    const t = TIPOS[+c.dataset.i];
    const caja = c.closest('.avi-dias');
    if (!t || !caja) return;
    const dias = leerDias(caja, t);
    if (!dias) return;
    if (dias.join(',') === diasDe(t).slice().sort((a, b) => a - b).join(',')) return; // no ha cambiado nada
    await guardarTipo(t, { dias });
  });

  // ---------- b) Estado de la tarea automática ----------
  function pintarTarea(estado) {
    const ultima = fechaDe(estado && estado.ultima_ejecucion);
    const ahora = new Date();
    const hoy = diaMadrid(ahora);
    const creados = estado && estado.dia === hoy ? Number(estado.creados_dia || 0) : 0;
    const hora = +partesMadrid(ahora).hour;
    const parada = (!ultima || ahora - ultima > 3 * 3600 * 1000) && hora >= 12 && hora < 21;
    el('tarea').innerHTML =
      (parada ? '<p class="msg err" role="alert">La tarea automática no parece estar funcionando</p>' : '') +
      '<p>Última comprobación: <b>' + (ultima ? esc(fechaHora(ultima)) : 'nunca') + '</b></p>' +
      '<p>Avisos creados hoy: <b>' + esc(numero(creados)) + '</b></p>';
    prepararCreados();
  }

  // Avisos creados en un día, por tipo, y quién los recibió. Todo se pinta con textContent (createElement).
  const MAX_DEST = 300;
  const nuevo = (etiqueta, clase, texto) => {
    const n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  };
  const plural = (n, uno, varios) => numero(n) + ' ' + (Number(n) === 1 ? uno : varios);
  // Carga en "caja" con aria-busy; si falla, mensaje en español y Reintentar. Ignora respuestas de una carga anterior.
  function cargarEn(caja, consulta, pintar) {
    const turno = (caja._turno = (caja._turno || 0) + 1);
    caja.setAttribute('aria-busy', 'true');
    Cueva.cargando(caja);
    Promise.resolve().then(consulta).then(r => {
      if (r.error) throw r.error;
      return r.data || [];
    }).then(d => {
      if (caja._turno !== turno) return;
      caja.replaceChildren();
      pintar(d);
      caja.removeAttribute('aria-busy');
    }, e => {
      if (caja._turno !== turno) return;
      Cueva.registrar('No se han podido cargar los avisos creados', e);
      const fallo = nuevo('div', 'empty fallo');
      fallo.setAttribute('role', 'alert');
      const otra = nuevo('button', 'chip', 'Reintentar');
      otra.type = 'button';
      otra.addEventListener('click', () => cargarEn(caja, consulta, pintar));
      fallo.append(nuevo('p', '', mensajeError(e)), otra);
      caja.replaceChildren(fallo);
      caja.removeAttribute('aria-busy');
    });
  }

  function prepararCreados() {
    const hoy = diaMadrid(new Date());
    const abrir = nuevo('button', 'btn sec avi-creados-abrir', 'Ver avisos creados');
    abrir.type = 'button';
    abrir.setAttribute('aria-expanded', 'false');
    abrir.setAttribute('aria-controls', 'avi-creados');
    const bloque = nuevo('div', 'avi-creados');
    bloque.id = 'avi-creados';
    bloque.hidden = true;
    const campo = nuevo('div', 'campo');
    const etiqueta = nuevo('label', '', 'Día');
    etiqueta.htmlFor = 'avi-dia';
    const dia = nuevo('input', 'entrada avi-creados-dia');
    Object.assign(dia, { type: 'date', id: 'avi-dia', max: hoy, value: hoy });
    dia.setAttribute('aria-describedby', 'avi-dia-error');
    const errorDia = nuevo('p', 'error-campo');
    errorDia.id = 'avi-dia-error';
    errorDia.hidden = true;
    campo.append(etiqueta, dia, errorDia);
    const lista = nuevo('div', 'avi-creados-lista');
    lista.id = 'avi-dia-lista';
    lista.setAttribute('aria-live', 'polite');
    bloque.append(nuevo('p', 'pista', 'Solo la administración ve este detalle.'), campo, lista);
    el('tarea').append(abrir, bloque);

    let cargado = false;
    abrir.addEventListener('click', () => {
      const ver = bloque.hidden;
      bloque.hidden = !ver;
      abrir.setAttribute('aria-expanded', String(ver));
      if (ver && !cargado) { cargado = true; cargarDia(); }
    });
    dia.addEventListener('change', cargarDia);

    function cargarDia() {
      const v = dia.value;
      const m = !/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'Elige un día.' : v > diaMadrid(new Date()) ? 'Elige hoy o un día anterior.' : '';
      errorDia.textContent = m;
      errorDia.hidden = !m;
      if (m) { dia.setAttribute('aria-invalid', 'true'); lista._turno = (lista._turno || 0) + 1; lista.replaceChildren(); lista.removeAttribute('aria-busy'); return; }
      dia.removeAttribute('aria-invalid');
      cargarEn(lista, () => sb.rpc('avisos_del_dia', { p_dia: v }), filas => pintarDia(v, filas));
    }

    function pintarDia(v, filas) {
      if (!filas.length) { lista.append(nuevo('p', 'empty', 'No se crearon avisos ese día.')); return; }
      const ul = nuevo('ul', 'avi-creados-tipos');
      filas.forEach((f, i) => {
        const li = nuevo('li', 'avi-creados-tipo');
        const cab = nuevo('div', 'avi-creados-cab');
        const tx = nuevo('div', 'avi-creados-tx');
        const h = nuevo('h3', '', f.titulo || f.tipo || '');
        h.id = 'avi-ct-' + i;
        tx.append(h, nuevo('p', 'pista', plural(f.creados, 'creado', 'creados') + ' · ' + plural(f.leidos, 'leído', 'leídos')));
        const quien = nuevo('button', 'btn sec avi-creados-quien', 'Ver quién');
        quien.type = 'button';
        quien.id = 'avi-cq-' + i;
        quien.setAttribute('aria-expanded', 'false');
        quien.setAttribute('aria-controls', 'avi-cd-' + i);
        quien.setAttribute('aria-describedby', h.id);
        cab.append(tx, quien);
        const det = nuevo('div', 'avi-creados-det');
        det.id = 'avi-cd-' + i;
        det.hidden = true;
        quien.addEventListener('click', () => {
          const ver = det.hidden;
          det.hidden = !ver;
          quien.setAttribute('aria-expanded', String(ver));
          if (ver && !det.dataset.cargado) {
            det.dataset.cargado = '1';
            cargarEn(det, () => sb.rpc('destinatarios_avisos', { p_dia: v, p_tipo: f.tipo }), d => pintarDestinatarios(det, d));
          }
        });
        li.append(cab, det);
        ul.append(li);
      });
      lista.append(ul);
    }

    function pintarDestinatarios(det, filas) {
      if (!filas.length) { det.append(nuevo('p', 'empty', 'No hay destinatarios de este aviso.')); return; }
      const ul = nuevo('ul', 'avi-dest');
      filas.forEach(f => {
        const li = nuevo('li', 'avi-dest-fila');
        const cab = nuevo('p', 'avi-dest-cab');
        cab.append(nuevo('b', '', f.socio || 'Socio sin nombre'), nuevo('span', 'avi-dest-leido' + (f.leido === true ? ' si' : ''), f.leido === true ? 'Leído' : 'Sin leer'));
        li.append(cab);
        if (f.texto) li.append(nuevo('p', 'avi-dest-texto', f.texto));
        ul.append(li);
      });
      det.append(ul);
      if (filas.length >= MAX_DEST) det.append(nuevo('p', 'msg aviso', 'Se muestran los ' + MAX_DEST + ' primeros destinatarios (el máximo).'));
    }
  }

  // ---------- c) Enviar un aviso ----------
  const form = el('form-enviar');
  function contar(campo) {
    const p = el(campo.id + '-cuenta');
    p.textContent = campo.value.length + ' de ' + campo.maxLength + ' caracteres';
  }
  ['av-titulo', 'av-texto'].forEach(id => el(id).addEventListener('input', e => contar(e.target)));

  function pintarDestinos() {
    const sel = el('av-destino');
    sel.querySelectorAll('option[value]:not([value=""])').forEach(o => o.remove());
    DESTINOS.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.nombre_completo || 'Sin nombre';
      sel.appendChild(o);
    });
    sel.options[0].textContent = 'Todos los socios activos (' + socios(DESTINOS.length) + ')';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    // Valores copiados ANTES de cualquier espera: lo que se envía es lo que había al pulsar.
    const titulo = form.elements.titulo.value.trim();
    const texto = form.elements.texto.value.trim();
    const enlace = form.elements.enlace.value || null;
    const socio = form.elements.destino.value || null;
    const nombre = socio ? form.elements.destino.selectedOptions[0].textContent : '';
    const total = DESTINOS.length;
    if (!Admin.validar(form, () => {
      const err = {};
      if (enlace && !PAGINAS[enlace]) err.enlace = 'Elige un enlace de la lista.';
      if (socio && !DESTINOS.some(s => s.id === socio)) err.destino = 'Elige un socio de la lista.';
      return err;
    })) return;
    if (!socio && !total) { Admin.estado(form, 'No hay ningún socio activo al que enviar el aviso.', true); return; }
    const si = await Admin.confirmar(socio ? 'Se enviará a ' + nombre + '.' : 'Se enviará a ' + socios(total) + '.', 'Enviar', true);
    if (!si) return;
    const soltar = Admin.bloquear(form);
    Admin.estado(form, 'Enviando…');
    let n;
    try {
      const r = await sb.rpc('enviar_aviso_libre', { p_titulo: titulo, p_texto: texto, p_enlace: enlace, p_socio: socio });
      if (r.error) throw r.error;
      if (!Number.isInteger(r.data)) throw { mensaje: 'No sabemos si el aviso se ha enviado. Revisa el historial antes de volver a enviarlo.' };
      n = r.data;
    } catch (err) {
      Cueva.registrar('No se ha podido enviar el aviso', err);
      soltar();
      Admin.estado(form, mensajeError(err), true);
      return;
    }
    soltar();
    form.reset();
    ['av-titulo', 'av-texto'].forEach(id => contar(el(id)));
    const ok = 'Aviso enviado a ' + socios(n);
    Admin.estado(form, ok);
    Cueva.aviso(ok, 'ok');
    cargarHistorial();
  });

  // ---------- d) Historial ----------
  let HISTORIAL = [];
  function cargarHistorial() {
    Cueva.cargar(el('historial'), () => sb.rpc('historial_avisos_libres'), d => { HISTORIAL = d; pintarHistorial(); });
  }
  function pintarHistorial() {
    el('historial').innerHTML = HISTORIAL.length ? '<ul class="avi-hist">' + HISTORIAL.map((h, i) => {
      const f = fechaDe(h.creado);
      return '<li class="avi-hist-fila">' +
        '<p class="avi-hist-meta"><span>' + esc(f ? fechaHora(f) : '') + '</span><span>Para: ' + esc(h.destinatario_nombre == null ? 'Todos' : h.destinatario_nombre) + '</span></p>' +
        '<h3>' + esc(h.titulo) + '</h3>' + (h.texto ? '<p class="avi-hist-texto">' + esc(h.texto) + '</p>' : '') +
        (h.enlace ? '<p class="pista">Enlace: ' + esc(PAGINAS[h.enlace] || h.enlace) + '</p>' : '') +
        '<div class="avi-hist-pie"><span>Leído por ' + esc(numero(h.leidos)) + ' de ' + esc(numero(h.enviados)) + '</span>' +
        '<button type="button" class="btn sec avi-retirar" data-i="' + i + '">Retirar</button></div></li>';
    }).join('') + '</ul>' : '<p class="empty">Todavía no se ha enviado ningún aviso.</p>';
  }
  el('historial').addEventListener('click', async e => {
    const b = e.target.closest('.avi-retirar');
    if (!b || b.disabled) return;
    const h = HISTORIAL[+b.dataset.i];
    if (!h) return;
    const id = h.id, titulo = h.titulo || '';
    const si = await Admin.confirmar('Se retirará el aviso «' + titulo + '» a todos los socios que lo recibieron. No se puede deshacer.', 'Retirar');
    if (!si) return;
    const filas = await Admin.escribir(el('sec-historial'), async () => {
      const r = await sb.from('avisos_libres').delete().eq('id', id).select('id');
      if (!r.error && Array.isArray(r.data) && r.data.length > 1) return { data: null, error: { mensaje: 'Se ha retirado más de un aviso. Recarga la página.' } };
      return r;
    }, 'Aviso retirado.');
    if (filas) cargarHistorial();
  });

  // ---------- Arranque ----------
  Cueva.cargar(el('estado'), leer, d => {
    TIPOS = d.config;
    DESTINOS = d.destinos;
    el('estado').remove();
    el('avisos-admin').hidden = false;
    pintarTipos();
    pintarTarea(d.estado);
    pintarDestinos();
    Admin.obligatorios(form);
    cargarHistorial();
  });
})();
