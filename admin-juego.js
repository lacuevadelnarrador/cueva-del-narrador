// PANEL: JUEGO (admin-juego.html). Solo administradores (Admin.iniciar). Script de la base de datos: supabase_35 (y 30-34).
// - Resumen: RPC juego_admin_resumen() → { temporada (entero), partidas, por_categoria, logros_temporada, banco, reportes_nuevos }.
//   Banco: si un nivel de una categoría tiene menos de 6 preguntas activas, la categoría no se puede jugar (aviso en rojo).
// - Preguntas: tabla juego_preguntas (RLS de admin). Lista paginada con filtros; editor de enunciado, opciones,
//   correcta (índice en el array opciones, no la posición en pantalla), explicación y fuente; activar/desactivar.
//   El id no se cambia. No se crean ni se borran preguntas (borrar = desactivar). Las 40 públicas de cada categoría
//   viven en juego/banco/*.json (repositorio) y no están en esta tabla.
// - Reportes: RPC juego_admin_reportes(p_estado) para leer; tabla juego_reportes (RLS de admin) para cambiar el estado.
// - Más falladas: RPC juego_admin_fallos(p_limite, p_min_vistas).
// - Jugadores: RPC juego_admin_jugadores() → filas { nombre, partidas, ganadas, perdidas, abandonadas, logros (temporada
//   actual), ultima_partida }, ya ordenadas por partidas y luego logros (de más a menos).
// - Temporada: RPC juego_nueva_temporada() → entero (la temporada nueva). Doble confirmación.
// Nada se pide al servidor antes de que la guardia confirme el rol de administrador; cada pestaña pide sus datos la
// primera vez que se abre. Todo lo que viene de la base de datos se pinta con textContent (nunca innerHTML con datos).
// Cada escritura termina en .select() y se comprueba que ha cambiado una fila. En la consola, solo errores sin datos.
(function () {
  const el = id => document.getElementById(id);
  const crear = Estante.crear;
  const NIVELES = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
  const NIVELES_MIN = { facil: 'fácil', media: 'media', dificil: 'difícil' };
  const MOTIVOS = { respuesta_incorrecta: 'Respuesta incorrecta', enunciado_confuso: 'Enunciado confuso', errata: 'Errata', otra: 'Otra cosa' };
  const ESTADOS = { nuevo: 'Nuevo', revisado: 'Revisado', descartado: 'Descartado' };
  const PESTANAS = ['resumen', 'preguntas', 'reportes', 'fallos', 'jugadores', 'temporada'];
  const POR_PAGINA = 25;
  const MINIMO_ACTIVAS = 6;   // 5 por nivel en cada partida + 1 para el comodín Saltar
  const LETRAS = ['A', 'B', 'C', 'D'];
  const CONFIRMACION = 'NUEVA TEMPORADA';
  const nombreCat = c => { const x = Estante.categoria(c); return x ? x.nombre : String(c || ''); };
  // Los errores de las funciones del juego (RAISE en SQL) ya vienen en castellano: se muestran tal cual.
  const mensajeError = e => e && e.code === 'P0001' && typeof e.message === 'string' && e.message ? e.message : Admin.mensajeError(e);
  const fechaHora = t => {
    const d = new Date(t);
    if (isNaN(d)) return '';
    const p = {};
    new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
  };
  const numero = n => Number.isFinite(n) ? n.toLocaleString('es-ES') : '—';

  let sb = null, pestana = 'resumen';
  const cargadas = {};      // pestañas ya pedidas al servidor
  let resumen = null, promesaResumen = null, reportesNuevos = 0;

  // ---------- Arranque: primero la guardia de administrador ----------
  Cueva.cargar(el('estado'), () => Admin.iniciar().then(c => { sb = c; return { data: [] }; }), () => {
    el('estado').remove();
    el('vista-lista').hidden = false;
    const h = location.hash.slice(1);
    pestana = PESTANAS.includes(h) ? h : 'resumen';
    rellenarCategorias();
    pintarPestana();
    // El resumen se pide siempre al entrar: da el contador de reportes nuevos y el banco (para avisar al desactivar).
    pedirResumen().catch(() => {});
  });

  // ---------- Pestañas ----------
  function pintarPestana() {
    PESTANAS.forEach(k => {
      const on = k === pestana, t = el('tab-' + k);
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      el('panel-' + k).hidden = !on;
    });
    // En el móvil las pestañas se desplazan en horizontal: la elegida se deja a la vista (sin mover la página)
    const tabs = el('tabs'), sel = el('tab-' + pestana);
    const a = tabs.getBoundingClientRect(), b = sel.getBoundingClientRect();
    if (b.left < a.left || b.right > a.right) tabs.scrollLeft += b.left - a.left - 8;
    try { history.replaceState(history.state, '', location.pathname + (pestana === 'resumen' ? '' : '#' + pestana)); } catch (e) {}
    if (!cargadas[pestana]) { cargadas[pestana] = true; CARGAR[pestana](); }
  }
  const ocupado = () => !!document.querySelector('form[aria-busy="true"]');
  function irA(k, foco) {
    if (ocupado()) return;
    pestana = k; pintarPestana();
    if (foco) el('tab-' + k).focus();
  }
  el('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) irA(b.id.slice(4)); });
  el('tabs').addEventListener('keydown', e => {
    const i = PESTANAS.indexOf(pestana);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % PESTANAS.length;
    else if (e.key === 'ArrowLeft') j = (i + PESTANAS.length - 1) % PESTANAS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = PESTANAS.length - 1;
    if (j === null) return;
    e.preventDefault();
    irA(PESTANAS[j], true);
  });

  // Carga con «Cargando…» y, si falla, el error con «Reintentar» (como el resto del panel).
  function cargarEn(caja, consulta, pintar) {
    Cueva.cargando(caja);
    Promise.resolve().then(consulta).then(r => {
      if (r && r.error) throw r.error;
      pintar(r ? r.data : null, r);
    }).catch(e => errorCarga(caja, e, () => cargarEn(caja, consulta, pintar)));
  }
  // Como Cueva.error, pero si el servidor explica el error (RAISE en SQL, código P0001) se muestra su texto.
  function errorCarga(caja, e, reintentar) {
    if (!(e && e.code === 'P0001' && e.message)) { Cueva.error(caja, e, reintentar); return; }
    Cueva.registrar('No se han podido cargar los datos', e);
    caja.textContent = '';
    const d = t('div', 'empty fallo');
    d.setAttribute('role', 'alert');
    d.appendChild(t('p', null, e.message));
    const b = t('button', 'chip', 'Reintentar');
    b.type = 'button';
    b.addEventListener('click', reintentar);
    d.appendChild(b);
    caja.appendChild(d);
  }
  // Construye un elemento con texto (siempre con textContent).
  const t = (etiqueta, clase, texto) => crear(etiqueta, clase, texto);

  // ---------- 1. Resumen ----------
  function pedirResumen(forzar) {
    if (!promesaResumen || forzar) {
      promesaResumen = Promise.resolve().then(() => sb.rpc('juego_admin_resumen')).then(r => {
        if (r.error) throw r.error;
        resumen = r.data || {};
        reportesNuevos = Number.isInteger(resumen.reportes_nuevos) ? resumen.reportes_nuevos : 0;
        pintarCuentaReportes();
        pintarTemporada();
        return resumen;
      });
      promesaResumen.catch(e => { promesaResumen = null; Cueva.registrar('No se ha podido leer el resumen del juego', e); });
    }
    return promesaResumen;
  }
  function cargarResumen(forzar) {
    const caja = el('resumen');
    cargarEn(caja, () => pedirResumen(forzar).then(d => ({ data: d })), pintarResumen);
  }
  function cifra(etiqueta, valor, detalle) {
    const c = t('div', 'card jadm-cifra');
    c.appendChild(t('p', 'jadm-cifra-et', etiqueta));
    c.appendChild(t('p', 'jadm-cifra-num', valor));
    if (detalle) c.appendChild(t('p', 'jadm-cifra-det', detalle));
    return c;
  }
  function tabla(titulo, cabeceras, filas, clase) {
    const sec = t('section', 'jadm-bloque' + (clase ? ' ' + clase : ''));
    const h = t('h2', null, titulo);
    h.id = 'jadm-t-' + Math.random().toString(36).slice(2, 8);
    sec.setAttribute('aria-labelledby', h.id);
    sec.appendChild(h);
    const caja = t('div', 'card jadm-tabla-caja');
    const tb = t('table', 'jadm-tabla');
    const thead = t('thead'), tr = t('tr');
    cabeceras.forEach((c, i) => { const th = t('th', i ? 'num' : null, c); th.scope = 'col'; tr.appendChild(th); });
    thead.appendChild(tr); tb.appendChild(thead);
    const tbody = t('tbody');
    filas.forEach(f => tbody.appendChild(f));
    tb.appendChild(tbody); caja.appendChild(tb); sec.appendChild(caja);
    return sec;
  }
  function pintarResumen(d) {
    const caja = el('resumen');
    caja.textContent = '';
    d = d || {};
    const p = d.partidas || {}, l = d.logros_temporada || {};
    caja.appendChild(t('p', 'jadm-temporada-cab', 'Temporada ' + (Number.isInteger(d.temporada) ? d.temporada : '—')));
    // Banco: avisos primero, para que se vean
    const banco = Array.isArray(d.banco) ? d.banco : [];
    const bajos = banco.filter(b => Number.isInteger(b.activas) && b.activas < MINIMO_ACTIVAS);
    if (bajos.length) {
      const av = t('div', 'msg err jadm-alerta');
      av.setAttribute('role', 'alert');
      av.appendChild(t('p', null, bajos.length === 1 ? 'Hay una categoría que no se puede jugar:' : 'Hay categorías que no se pueden jugar:'));
      const ul = t('ul');
      bajos.forEach(b => ul.appendChild(t('li', null, nombreCat(b.categoria) + ': el nivel ' + NIVELES_MIN[b.nivel] + ' tiene ' + b.activas + ' preguntas activas (hacen falta ' + MINIMO_ACTIVAS + ').')));
      av.appendChild(ul);
      caja.appendChild(av);
    }
    const cifras = t('div', 'jadm-cifras');
    cifras.appendChild(cifra('Partidas', numero(p.total), numero(p.ganadas) + ' ganadas · ' + numero(p.perdidas) + ' perdidas · ' + numero(p.abandonadas) + ' abandonadas · ' + numero(p.en_curso) + ' en curso'));
    cifras.appendChild(cifra('Jugadores', numero(p.jugadores), 'Socios que han jugado'));
    cifras.appendChild(cifra('Logros de la temporada', numero((l.bronce || 0) + (l.plata || 0) + (l.oro || 0)),
      numero(l.bronce) + ' bronce · ' + numero(l.plata) + ' plata · ' + numero(l.oro) + ' oro · ' + numero(l.socios) + ' socios con logros'));
    const rep = cifra('Reportes nuevos', numero(reportesNuevos), reportesNuevos ? 'Pendientes de revisar' : 'Nada pendiente');
    if (reportesNuevos) {
      const b = t('button', 'jadm-enlace', 'Ver los reportes');
      b.type = 'button';
      b.addEventListener('click', () => irA('reportes', true));
      rep.appendChild(b);
    }
    cifras.appendChild(rep);
    caja.appendChild(cifras);

    const porCat = Array.isArray(d.por_categoria) ? d.por_categoria : [];
    caja.appendChild(tabla('Partidas por categoría', ['Categoría', 'Partidas', 'Ganadas', 'Perdidas'], porCat.map(f => {
      const tr = t('tr');
      const th = t('th', null, nombreCat(f.categoria)); th.scope = 'row'; tr.appendChild(th);
      [f.partidas, f.ganadas, f.perdidas].forEach(v => tr.appendChild(t('td', 'num', numero(v))));
      return tr;
    })));

    // Banco: categoría × nivel, «activas / total»; en rojo (y con texto) si hay menos de 6 activas
    const filas = Estante.CATEGORIAS.map(c => {
      const tr = t('tr');
      const th = t('th', null, c.nombre); th.scope = 'row'; tr.appendChild(th);
      ['facil', 'media', 'dificil'].forEach(n => {
        const b = banco.find(x => x.categoria === c.id && x.nivel === n);
        const td = t('td', 'num');
        if (!b) { td.textContent = '—'; tr.appendChild(td); return; }
        td.textContent = b.activas + ' / ' + b.total;
        if (b.activas < MINIMO_ACTIVAS) { td.classList.add('jadm-bajo'); td.appendChild(t('span', 'jadm-bajo-txt', ' Menos de ' + MINIMO_ACTIVAS)); }
        tr.appendChild(td);
      });
      return tr;
    });
    const sec = tabla('Banco de preguntas del club', ['Categoría', 'Fácil', 'Media', 'Difícil'], filas, 'jadm-banco');
    sec.insertBefore(t('p', 'pista', 'Preguntas activas / total en cada nivel. Cada nivel necesita al menos ' + MINIMO_ACTIVAS + ' activas para que la categoría se pueda jugar.'), sec.children[1]);
    caja.appendChild(sec);
  }

  function pintarCuentaReportes() {
    const s = el('cuenta-reportes');
    s.textContent = '';
    s.hidden = !reportesNuevos;
    if (!reportesNuevos) return;
    s.appendChild(document.createTextNode(String(reportesNuevos)));
    s.appendChild(t('span', 'perfil-sr', reportesNuevos === 1 ? ' nuevo' : ' nuevos'));
  }

  // ---------- 2. Preguntas ----------
  const F = { categoria: '', nivel: '', activa: '', q: '', pagina: 0, total: 0 };
  let turnoLista = 0, temporizador = null;
  function rellenarCategorias() {
    const s = el('f-categoria');
    Estante.CATEGORIAS.forEach(c => { const o = t('option', null, c.nombre); o.value = c.id; s.appendChild(o); });
  }
  // Quita lo que rompería el filtro de búsqueda del servidor (comas, paréntesis, comodines, comillas).
  const limpiarBusqueda = v => String(v || '').replace(/[%_,()*\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  function cargarPreguntas() {
    const caja = el('lista-preguntas'), turno = ++turnoLista;
    Cueva.cargando(caja);
    el('paginas').hidden = true;
    el('cuenta-preguntas').textContent = '';
    Promise.resolve().then(() => {
      let q = sb.from('juego_preguntas').select('id,categoria,nivel,pregunta,activa', { count: 'exact' });
      if (F.categoria) q = q.eq('categoria', F.categoria);
      if (F.nivel) q = q.eq('nivel', F.nivel);
      if (F.activa) q = q.eq('activa', F.activa === 'si');
      const b = limpiarBusqueda(F.q);
      if (b) q = q.or('id.ilike.%' + b + '%,pregunta.ilike.%' + b + '%');
      const desde = F.pagina * POR_PAGINA;
      return q.order('id').range(desde, desde + POR_PAGINA - 1);
    }).then(r => {
      if (turno !== turnoLista) return;
      if (r.error) throw r.error;
      F.total = Number.isInteger(r.count) ? r.count : (r.data || []).length;
      // Si la página se ha quedado vacía (por ejemplo, tras desactivar con el filtro «Activas»), se vuelve a la anterior
      if (!(r.data || []).length && F.pagina > 0) { F.pagina = Math.max(0, Math.ceil(F.total / POR_PAGINA) - 1); return cargarPreguntas(); }
      pintarPreguntas(r.data || []);
    }).catch(e => {
      if (turno !== turnoLista) return;
      errorCarga(caja, e, cargarPreguntas);
    });
  }
  function pintarPreguntas(filas) {
    const caja = el('lista-preguntas');
    caja.textContent = '';
    if (!filas.length) {
      caja.appendChild(t('p', 'card empty', 'No hay preguntas con estos filtros.'));
      el('cuenta-preguntas').textContent = 'Ninguna pregunta';
      return;
    }
    const a = F.pagina * POR_PAGINA + 1, b = a + filas.length - 1;
    el('cuenta-preguntas').textContent = 'Preguntas ' + numero(a) + '–' + numero(b) + ' de ' + numero(F.total);
    filas.forEach(f => {
      const bt = t('button', 'fila jadm-fila');
      bt.type = 'button';
      bt.dataset.id = f.id;
      const st = t('span', 'st');
      const cab = t('b', null, f.id);
      st.appendChild(cab);
      st.appendChild(t('small', 'jadm-fila-meta', nombreCat(f.categoria) + ' · ' + NIVELES[f.nivel]));
      st.appendChild(t('small', 'jadm-fila-texto', f.pregunta));
      bt.appendChild(st);
      if (f.activa === false) bt.appendChild(t('span', 'estado no', 'Inactiva'));
      caja.appendChild(bt);
    });
    const paginas = Math.ceil(F.total / POR_PAGINA);
    el('paginas').hidden = paginas <= 1;
    el('pag-texto').textContent = 'Página ' + (F.pagina + 1) + ' de ' + paginas;
    el('pag-anterior').disabled = F.pagina === 0;
    el('pag-siguiente').disabled = F.pagina >= paginas - 1;
  }
  function filtrar() { F.pagina = 0; cargarPreguntas(); }
  el('f-categoria').addEventListener('change', e => { F.categoria = e.target.value; filtrar(); });
  el('f-buscar').addEventListener('input', e => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { if (F.q !== e.target.value) { F.q = e.target.value; filtrar(); } }, 350);
  });
  function chips(id, alCambiar) {
    el(id).addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      el(id).querySelectorAll('.chip').forEach(c => { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      alCambiar(b.dataset.v);
    });
  }
  chips('f-nivel', v => { F.nivel = v; filtrar(); });
  chips('f-activa', v => { F.activa = v; filtrar(); });
  el('pag-anterior').addEventListener('click', () => { if (F.pagina > 0) { F.pagina--; cargarPreguntas(); el('cuenta-preguntas').scrollIntoView({ block: 'start' }); } });
  el('pag-siguiente').addEventListener('click', () => { F.pagina++; cargarPreguntas(); el('cuenta-preguntas').scrollIntoView({ block: 'start' }); });
  el('lista-preguntas').addEventListener('click', e => { const b = e.target.closest('.fila[data-id]'); if (b) abrirPregunta(b.dataset.id); });

  // ---------- Editor ----------
  const form = el('form-pregunta');
  let actual = null;   // la fila que se está editando, tal como está guardada
  const OPCIONES = ['op0', 'op1', 'op2', 'op3'];
  function contar() {
    form.querySelectorAll('[data-cuenta-de]').forEach(p => {
      const c = el(p.dataset.cuentaDe);
      p.textContent = c.value.length + ' de ' + c.maxLength + ' caracteres';
    });
  }
  async function abrirPregunta(id) {
    if (ocupado()) return;
    let r;
    try {
      r = await sb.from('juego_preguntas').select('id,categoria,nivel,pregunta,opciones,correcta,explicacion,fuente,activa').eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw { mensaje: 'Esa pregunta ya no existe o no tienes permiso para verla.' };
    } catch (e) {
      Cueva.registrar('No se ha podido abrir la pregunta', e);
      Cueva.aviso(mensajeError(e), 'err');
      return;
    }
    actual = r.data;
    const op = Array.isArray(actual.opciones) ? actual.opciones : [];
    Admin.rellenar(form, { pregunta: actual.pregunta, op0: op[0], op1: op[1], op2: op[2], op3: op[3], correcta: String(actual.correcta),
      explicacion: actual.explicacion || '', fuente: actual.fuente || '' });
    el('pq-id').value = actual.id;
    el('pq-ficha').textContent = nombreCat(actual.categoria) + ' · Nivel ' + NIVELES_MIN[actual.nivel];
    pintarActiva();
    quitarPrevia();
    contar();
    Admin.obligatorios(form);
    // «Editar pregunta» desde Reportes o Más falladas abre la pestaña Preguntas por detrás (al volver se ve esa lista)
    if (pestana !== 'preguntas') { pestana = 'preguntas'; pintarPestana(); }
    Admin.abrir('vista-pregunta');
  }
  function pintarActiva() {
    const b = el('pq-activa');
    b.setAttribute('aria-checked', String(actual.activa === true));
    b.querySelector('.perfil-switch-texto').textContent = actual.activa ? 'Sí' : 'No';
  }
  function quitarPrevia() {
    el('pq-previa').hidden = true;
    el('pq-guardar').textContent = 'Revisar y guardar';
    el('pq-editar-mas').hidden = true;
  }
  const datosForm = () => ({
    pregunta: form.elements.pregunta.value.trim(),
    opciones: OPCIONES.map(k => form.elements[k].value.trim()),
    correcta: Number(form.querySelector('input[name="correcta"]:checked') ? form.querySelector('input[name="correcta"]:checked').value : -1),
    explicacion: form.elements.explicacion.value.trim(),
    fuente: form.elements.fuente.value.trim()
  });
  function errores() {
    const d = datosForm(), e = {};
    if (d.pregunta && d.pregunta.length < 5) e.pregunta = 'El enunciado debe tener al menos 5 caracteres.';
    // Las opciones deben ser distintas (se distinguen mayúsculas: «Lunes» y «lunes» son opciones distintas a propósito)
    OPCIONES.forEach((k, i) => {
      if (d.opciones[i] && d.opciones.indexOf(d.opciones[i]) !== i) e[k] = 'Esta opción es igual que la opción ' + LETRAS[d.opciones.indexOf(d.opciones[i])] + '.';
    });
    return e;
  }
  function pintarPrevia() {
    const d = datosForm();
    el('pq-previa-enunciado').textContent = d.pregunta;
    const ol = el('pq-previa-opciones');
    ol.textContent = '';
    d.opciones.forEach((o, i) => {
      const li = t('li', i === d.correcta ? 'correcta' : null);
      li.appendChild(t('span', 'jadm-letra', LETRAS[i]));
      li.appendChild(t('span', 'jadm-op', o));
      if (i === d.correcta) li.appendChild(t('span', 'jadm-marca', 'Correcta'));
      ol.appendChild(li);
    });
    el('pq-previa-expl').textContent = d.explicacion ? 'Explicación: ' + d.explicacion : 'Sin explicación.';
    el('pq-previa').hidden = false;
    el('pq-guardar').textContent = 'Guardar cambios';
    el('pq-editar-mas').hidden = false;
    el('pq-previa-t').focus();
  }
  // Cualquier cambio después de la vista previa la quita: se guarda siempre lo que se ha visto.
  form.addEventListener('input', () => { contar(); if (!el('pq-previa').hidden) quitarPrevia(); });
  form.addEventListener('change', e => { if (e.target.name === 'correcta' && !el('pq-previa').hidden) quitarPrevia(); });
  el('pq-editar-mas').addEventListener('click', () => { quitarPrevia(); form.elements.pregunta.focus(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!actual || ocupado()) return;
    if (!Admin.validar(form, errores)) return;
    if (el('pq-previa').hidden) { pintarPrevia(); return; }
    const d = datosForm();
    const filas = await Admin.escribir(form, () => sb.from('juego_preguntas').update(d).eq('id', actual.id)
      .select('id,categoria,nivel,pregunta,opciones,correcta,explicacion,fuente,activa'), 'Pregunta guardada.');
    if (!filas) return;
    actual = filas[0];
    quitarPrevia();
    cargadas.reportes = cargadas.fallos = false;   // se verán con el texto nuevo la próxima vez
    Admin.cerrar(form);
    cargarPreguntas();
  });

  // Activar / desactivar (se guarda en el momento). Si al desactivar un nivel se queda con menos de 6 activas, la
  // categoría deja de poder jugarse: se pide confirmación con el número exacto (datos del banco del Resumen).
  el('pq-activa').addEventListener('click', async () => {
    if (!actual || ocupado()) return;
    const activar = actual.activa !== true;
    if (!activar) {
      let banco = null;
      try { banco = (await pedirResumen()).banco; } catch (e) { banco = null; }
      const b = Array.isArray(banco) ? banco.find(x => x.categoria === actual.categoria && x.nivel === actual.nivel) : null;
      if (!b) {
        if (!await Admin.confirmar('No se ha podido comprobar cuántas preguntas activas quedan en este nivel. ¿Desactivar igualmente?', 'Desactivar')) return;
      } else if (b.activas - 1 < MINIMO_ACTIVAS) {
        if (!await Admin.confirmar('La categoría ' + nombreCat(actual.categoria) + ' dejará de poder jugarse: el nivel ' + NIVELES_MIN[actual.nivel] +
          ' quedará con ' + (b.activas - 1) + ' preguntas activas.', 'Desactivar')) return;
      }
    }
    const filas = await Admin.escribir(form, () => sb.from('juego_preguntas').update({ activa: activar }).eq('id', actual.id).select('id,activa'),
      activar ? 'Pregunta activada.' : 'Pregunta desactivada.');
    if (!filas) return;
    actual.activa = filas[0].activa === true;
    pintarActiva();
    // El banco del Resumen se actualiza aquí (y se vuelve a pedir la próxima vez que se abra la pestaña)
    if (resumen && Array.isArray(resumen.banco)) {
      const b = resumen.banco.find(x => x.categoria === actual.categoria && x.nivel === actual.nivel);
      if (b) b.activas += activar ? 1 : -1;
    }
    cargadas.resumen = cargadas.fallos = false;
    cargarPreguntas();
    el('pq-activa').focus();
  });

  // ---------- 3. Reportes ----------
  let estadoReportes = 'nuevo';
  chips('f-estado', v => { estadoReportes = v; cargarReportes(); });
  function cargarReportes() {
    el('cuenta-lista-reportes').textContent = '';
    cargarEn(el('lista-reportes'), () => sb.rpc('juego_admin_reportes', { p_estado: estadoReportes || null }), pintarReportes);
  }
  function opcionesConCorrecta(opciones, correcta) {
    const ol = t('ol', 'jadm-opciones');
    (Array.isArray(opciones) ? opciones : []).forEach((o, i) => {
      const li = t('li', i === correcta ? 'correcta' : null);
      li.appendChild(t('span', 'jadm-letra', LETRAS[i]));
      li.appendChild(t('span', 'jadm-op', o));
      if (i === correcta) li.appendChild(t('span', 'jadm-marca', 'Correcta'));
      ol.appendChild(li);
    });
    return ol;
  }
  function pintarReportes(filas) {
    const caja = el('lista-reportes');
    caja.textContent = '';
    filas = Array.isArray(filas) ? filas : [];
    el('cuenta-lista-reportes').textContent = filas.length === 1 ? '1 reporte' : filas.length + ' reportes';
    if (!filas.length) { caja.appendChild(t('p', 'card empty', estadoReportes === 'nuevo' ? 'No hay reportes nuevos.' : 'No hay reportes.')); return; }
    filas.forEach(r => caja.appendChild(tarjetaReporte(r)));
  }
  function tarjetaReporte(r) {
    const art = t('article', 'card jadm-reporte');
    art.dataset.id = r.id;
    const cab = t('div', 'jadm-reporte-cab');
    cab.appendChild(t('span', 'tag', MOTIVOS[r.motivo] || 'Otra cosa'));
    const est = t('span', 'estado jadm-estado-' + r.estado, ESTADOS[r.estado] || r.estado);
    cab.appendChild(est);
    art.appendChild(cab);
    const ficha = t('p', 'jadm-ficha', r.pregunta_id + ' · ' + nombreCat(r.categoria) + ' · Nivel ' + (NIVELES_MIN[r.nivel] || '') + (r.activa === false ? ' · Inactiva' : ''));
    art.appendChild(ficha);
    art.appendChild(t('p', 'jadm-enunciado', r.pregunta || '(La pregunta ya no existe)'));
    if (Array.isArray(r.opciones)) art.appendChild(opcionesConCorrecta(r.opciones, r.correcta));
    if (r.explicacion) art.appendChild(t('p', 'pista', 'Explicación: ' + r.explicacion));
    if (r.detalle) {
      const bq = t('blockquote', 'jadm-detalle');
      bq.appendChild(t('p', null, r.detalle));
      art.appendChild(t('p', 'jadm-detalle-et', 'Lo que escribió el socio:'));
      art.appendChild(bq);
    }
    art.appendChild(t('p', 'pista', 'Reportada por ' + (r.socio || 'Socio') + (r.creado ? ' el ' + fechaHora(r.creado) : '') + '.'));
    const botones = t('div', 'botones-form');
    const boton = (texto, clase, accion) => { const b = t('button', 'btn ' + clase, texto); b.type = 'button'; b.addEventListener('click', accion); botones.appendChild(b); };
    if (r.estado !== 'revisado') boton('Marcar revisado', '', () => cambiarEstado(art, r, 'revisado'));
    if (r.estado !== 'descartado') boton('Descartar', 'sec', () => cambiarEstado(art, r, 'descartado'));
    if (r.pregunta) boton('Editar pregunta', 'sec', () => abrirPregunta(r.pregunta_id));
    art.appendChild(botones);
    return art;
  }
  async function cambiarEstado(art, r, nuevo) {
    const botones = [...art.querySelectorAll('button')];
    botones.forEach(b => { b.disabled = true; });
    art.setAttribute('aria-busy', 'true');
    try {
      const x = await sb.from('juego_reportes').update({ estado: nuevo }).eq('id', r.id).select('id,estado');
      if (x.error) throw x.error;
      if (!Array.isArray(x.data) || x.data.length !== 1) throw { sinFilas: true };
      if (r.estado === 'nuevo') { reportesNuevos = Math.max(0, reportesNuevos - 1); pintarCuentaReportes(); }
      r.estado = nuevo;
      Cueva.aviso(nuevo === 'revisado' ? 'Reporte marcado como revisado.' : 'Reporte descartado.', 'ok');
      cargadas.resumen = false;
      if (estadoReportes && estadoReportes !== nuevo) {
        const sig = art.nextElementSibling || art.previousElementSibling;
        art.remove();
        const quedan = el('lista-reportes').querySelectorAll('.jadm-reporte').length;
        el('cuenta-lista-reportes').textContent = quedan === 1 ? '1 reporte' : quedan + ' reportes';
        if (!quedan) pintarReportes([]);
        const foco = sig && sig.querySelector && sig.querySelector('button');
        if (foco) foco.focus({ preventScroll: true }); else el('tab-reportes').focus();
      } else {
        art.replaceWith(tarjetaReporte(r));
      }
    } catch (e) {
      Cueva.registrar('No se ha podido cambiar el estado del reporte', e);
      Cueva.aviso(mensajeError(e), 'err');
      botones.forEach(b => { b.disabled = false; });
    } finally {
      art.removeAttribute('aria-busy');
    }
  }

  // ---------- 4. Más falladas ----------
  el('f-vistas').addEventListener('change', () => cargarFallos());
  function cargarFallos() {
    const min = Number(el('f-vistas').value) || 3;
    cargarEn(el('lista-fallos'), () => sb.rpc('juego_admin_fallos', { p_limite: 30, p_min_vistas: min }), pintarFallos);
  }
  function pintarFallos(filas) {
    const caja = el('lista-fallos');
    caja.textContent = '';
    filas = Array.isArray(filas) ? filas : [];
    if (!filas.length) { caja.appendChild(t('p', 'card empty', 'Ninguna pregunta ha salido tantas veces todavía.')); return; }
    const tb = t('table', 'jadm-tabla jadm-fallos');
    const thead = t('thead'), tr = t('tr');
    ['Pregunta', 'Categoría', 'Nivel', 'Veces', 'Fallos', '% fallo', 'Reportes', ''].forEach((c, i) => {
      const th = t('th', i >= 3 && i <= 6 ? 'num' : null, c); th.scope = 'col';
      if (!c) th.appendChild(t('span', 'perfil-sr', 'Acción'));
      tr.appendChild(th);
    });
    thead.appendChild(tr); tb.appendChild(thead);
    const tbody = t('tbody');
    filas.forEach(f => {
      const fila = t('tr');
      const celda = (et, texto, clase) => { const td = t('td', clase || null, texto); td.dataset.et = et; fila.appendChild(td); return td; };
      const td = celda('Pregunta', null, 'jadm-fallos-preg');
      td.appendChild(t('b', null, f.id));
      if (f.activa === false) td.appendChild(t('span', 'estado no', 'Inactiva'));
      const txt = String(f.pregunta || '');
      td.appendChild(t('span', 'jadm-fallos-texto', txt.length > 110 ? txt.slice(0, 107) + '…' : txt));
      celda('Categoría', nombreCat(f.categoria));
      celda('Nivel', NIVELES[f.nivel] || '');
      celda('Veces', numero(f.vistas), 'num');
      celda('Fallos', numero(f.fallos), 'num');
      celda('% fallo', (Number.isFinite(Number(f.porcentaje_fallo)) ? Number(f.porcentaje_fallo).toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—') + ' %', 'num jadm-pct');
      celda('Reportes', numero(f.reportes), 'num');
      const acc = celda('', null, 'jadm-accion');
      const b = t('button', 'btn sec', 'Editar');
      b.type = 'button';
      b.appendChild(t('span', 'perfil-sr', ' ' + f.id));
      b.addEventListener('click', () => abrirPregunta(f.id));
      acc.appendChild(b);
      tbody.appendChild(fila);
    });
    tb.appendChild(tbody);
    const cajaTabla = t('div', 'card jadm-tabla-caja');
    cajaTabla.appendChild(tb);
    caja.appendChild(cajaTabla);
  }

  // ---------- 5. Jugadores (ranking de actividad) ----------
  // Las filas ya llegan ordenadas del servidor: la posición es el orden de la lista. Tabla en pantallas anchas, tarjetas en el móvil.
  function cargarJugadores() {
    el('cuenta-jugadores').textContent = '';
    cargarEn(el('lista-jugadores'), () => sb.rpc('juego_admin_jugadores'), pintarJugadores);
  }
  function pintarJugadores(filas) {
    const caja = el('lista-jugadores');
    caja.textContent = '';
    filas = Array.isArray(filas) ? filas : [];
    el('cuenta-jugadores').textContent = filas.length === 1 ? '1 jugador' : filas.length ? numero(filas.length) + ' jugadores' : '';
    if (!filas.length) { caja.appendChild(t('p', 'card empty', 'Todavía nadie ha jugado')); return; }
    const tb = t('table', 'jadm-tabla jadm-jugadores');
    tb.appendChild(t('caption', 'perfil-sr', 'Jugadores, de más a menos partidas'));
    const thead = t('thead'), tr = t('tr');
    ['#', 'Nombre', 'Partidas', 'Ganadas', 'Perdidas', 'Abandonadas', 'Logros', 'Última partida'].forEach((c, i) => {
      const th = t('th', i === 0 || (i >= 2 && i <= 6) ? 'num' : null, i === 0 ? null : c); th.scope = 'col';
      if (i === 0) { th.appendChild(t('span', null, '#')); th.firstChild.setAttribute('aria-hidden', 'true'); th.appendChild(t('span', 'perfil-sr', 'Posición')); }
      tr.appendChild(th);
    });
    thead.appendChild(tr); tb.appendChild(thead);
    const tbody = t('tbody');
    filas.forEach((f, i) => {
      const fila = t('tr');
      const pos = t('td', 'num jadm-pos', String(i + 1)); pos.dataset.et = 'Posición'; fila.appendChild(pos);
      const nombre = t('th', 'jadm-jug-nombre', String(f.nombre || 'Socio')); nombre.scope = 'row'; nombre.dataset.et = 'Nombre'; fila.appendChild(nombre);
      [['Partidas', f.partidas], ['Ganadas', f.ganadas], ['Perdidas', f.perdidas], ['Abandonadas', f.abandonadas], ['Logros', f.logros]].forEach(([et, v]) => {
        const td = t('td', 'num', numero(Number(v))); td.dataset.et = et; fila.appendChild(td);
      });
      const ult = t('td', 'jadm-ultima', f.ultima_partida ? fechaHora(f.ultima_partida) || '—' : '—'); ult.dataset.et = 'Última partida'; fila.appendChild(ult);
      tbody.appendChild(fila);
    });
    tb.appendChild(tbody);
    const cajaTabla = t('div', 'card jadm-tabla-caja');
    cajaTabla.appendChild(tb);
    caja.appendChild(cajaTabla);
  }

  // ---------- 6. Temporada ----------
  function pintarTemporada() {
    const n = resumen && Number.isInteger(resumen.temporada) ? resumen.temporada : null;
    el('temporada-actual').textContent = n ? 'Temporada ' + n : '—';
    el('confirmar-boton').textContent = n ? 'Empezar la Temporada ' + (n + 1) : 'Empezar la temporada nueva';
  }
  function cargarTemporada() {
    el('temporada-actual').textContent = 'Cargando…';
    pedirResumen().then(pintarTemporada).catch(e => {
      el('temporada-actual').textContent = '—';
      Cueva.aviso(mensajeError(e), 'err');
    });
  }
  const formT = el('form-temporada');
  el('nueva-temporada').addEventListener('click', async () => {
    if (ocupado()) return;
    const n = resumen && Number.isInteger(resumen.temporada) ? resumen.temporada : null;
    const ok = await Admin.confirmar('Vas a empezar ' + (n ? 'la Temporada ' + (n + 1) : 'una temporada nueva') +
      '. El ranking volverá a cero para todos los socios; los logros anteriores se conservan en la base de datos. No se puede deshacer.', 'Continuar');
    if (!ok) return;
    el('temporada-resultado').hidden = true;
    formT.hidden = false;
    el('nueva-temporada').hidden = true;
    el('confirmar-temporada').value = '';
    el('confirmar-boton').disabled = true;
    Admin.estado(formT, '');
    el('confirmar-temporada').focus();
  });
  el('confirmar-temporada').addEventListener('input', e => { el('confirmar-boton').disabled = e.target.value.trim() !== CONFIRMACION; });
  function cerrarConfirmacion() {
    formT.hidden = true;
    el('nueva-temporada').hidden = false;
    el('nueva-temporada').focus();
  }
  el('cancelar-temporada').addEventListener('click', cerrarConfirmacion);
  formT.addEventListener('submit', async e => {
    e.preventDefault();
    if (el('confirmar-temporada').value.trim() !== CONFIRMACION || ocupado()) return;
    const soltar = Admin.bloquear(formT);
    Admin.estado(formT, 'Empezando la temporada nueva…');
    try {
      const r = await sb.rpc('juego_nueva_temporada');
      if (r.error) throw r.error;
      if (!Number.isInteger(r.data)) throw { mensaje: 'El servidor no ha devuelto el número de la temporada nueva. Recarga la página para comprobar si se ha creado.' };
      Admin.estado(formT, '');
      soltar();
      formT.hidden = true;
      el('nueva-temporada').hidden = false;
      const res = el('temporada-resultado');
      res.textContent = 'Hecho: empieza la Temporada ' + r.data + '. El ranking vuelve a cero; los logros anteriores siguen guardados.';
      res.hidden = false;
      el('temporada-actual').textContent = 'Temporada ' + r.data;
      if (resumen) resumen.temporada = r.data;
      pintarTemporada();
      Cueva.aviso('Temporada ' + r.data + ' en marcha.', 'ok');
      cargadas.resumen = false;
      pedirResumen(true).catch(() => {});
      res.setAttribute('tabindex', '-1');
      res.focus();
    } catch (err) {
      Cueva.registrar('No se ha podido empezar la temporada nueva', err);
      Admin.estado(formT, mensajeError(err), true);
      soltar();
    }
  });

  const CARGAR = { resumen: () => cargarResumen(true), preguntas: cargarPreguntas, reportes: cargarReportes, fallos: cargarFallos,
    jugadores: cargarJugadores, temporada: cargarTemporada };
})();
