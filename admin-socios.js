// PANEL: SOCIOS (admin-socios.html): listado, ficha del socio, cuenta, cuotas, asistencia, bajas y fichas pendientes.
// - Usa los ayudantes de admin.js (guardia, vistas con "atrás", validar, bloquear, estado, confirmar, avisos).
// - Los datos de socios son personales: NO se escriben en la consola (ni siquiera en los errores, porque un error de
//   Postgres puede traer la fila entera en "details") ni se guardan en el dispositivo. Todo se escapa antes de pintarlo.
// - Cada escritura termina en .select() y se comprueba que ha cambiado alguna fila (RLS puede impedirlo sin dar error).
// - fecha_pago de las cuotas la pone sola la base de datos: nunca se envía.
// - Las protecciones de administradores las aplica la base de datos; aquí solo se muestra su mensaje.
(function () {
  const esc = Admin.esc;
  const el = id => document.getElementById(id);
  const COLUMNAS = 'id,codigo,nombre_completo,nombre_pila,edad,telefono,instagram,tiktok,foto_url,generos_favoritos,motivacion,' +
    'como_nos_conocio,libro_publicado,rgpd_imagen,rgpd_publicaciones,fecha_inscripcion,fundador';
  const COL_PERFIL = 'id,email,nombre,rol,activo,creado';
  const COL_CUOTA = 'socio_id,curso_id,tipo,mes,estado,fecha_pago';
  // Mismas sugerencias que "Mi perfil" (y "Fundador" para el club)
  const MOTIVOS = ['Terminar proyectos', 'Publicar', 'Mejora general', 'Falta de ideas', 'Síndrome del impostor', 'Ortografía', 'Maquetación', 'Crear obras largas', 'Falta de motivación'];
  const CONOCIO = ['Instagram', 'TikTok', 'Boca a boca', 'Cartel en librería', 'Fundador', 'Otro'];
  // Mismas reglas que la base de datos
  const MAX_LISTA = 20, MAX_PROPIA = 40, MAX_CONOCIO = 120, MAX_RED = 60;
  const TELEFONO = /^\+?[0-9 ]+$/;
  const USUARIO_RED = /^[A-Za-z0-9._]+$/;
  // Mensajes de las protecciones de administradores (se muestran tal cual)
  const PROTECCIONES = ['No puedes quitarte el rol de administrador, desactivarte ni borrarte a ti mismo.', 'El club debe tener al menos un administrador activo.'];
  const ESTADOS = {
    pagada: { n: 'Pagada', p: 'Pagadas', i: '<path d="M5 12l5 5 9-10"/>' },
    pendiente: { n: 'Pendiente', p: 'Pendientes', i: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>' },
    exenta: { n: 'Exenta', p: 'Exentas', i: '<path d="M7 12h10"/>' }
  };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_CURSO = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

  // ---------- Utilidades ----------
  const dos = n => String(n).padStart(2, '0');
  const norm = t => String(t == null ? '' : t).toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const inicialDe = t => (Array.from(String(t || '').trim())[0] || '?').toLocaleUpperCase('es');
  const unicos = arr => arr.filter((x, i) => arr.indexOf(x) === i);
  const lista = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
  const usuarioRed = v => String(v || '').replace(/[@\s]/g, '');
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const porCodigo = (a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es', { numeric: true });
  const compararCursos = (a, b) => String(b.codigo || '').localeCompare(String(a.codigo || ''), 'es', { numeric: true }) || (+b.id || 0) - (+a.id || 0);
  const nombreCurso = c => c ? (c.nombre || ('Curso ' + (c.codigo || ''))) : 'Curso';
  const textoCuotas = n => n ? (n === 1 ? 'Se ha creado 1 cuota.' : 'Se han creado ' + n + ' cuotas.') : 'No había nada que crear.';
  // "creado" es timestamptz: se muestra la fecha en la hora local.
  const fechaCreado = t => { const d = new Date(t); return isNaN(d) ? '' : dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear(); };
  const ic = path => '<svg class="perfil-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + path + '</svg>';

  // ---------- Estado ----------
  let sb = null, yo = null, cargado = false, filtro = 'todos';
  let PERFILES = [], SOCIOS = [], CURSOS = [], GENEROS = [], PEND = {};
  let ficha = null;      // { socio, perfil, cuotas, asistencia, curso }
  let pedida = 0;        // para ignorar cargas de una ficha anterior
  let cuentaCrear = null;

  const perfilDe = id => PERFILES.find(p => p.id === id) || null;
  const socioDe = id => SOCIOS.find(s => s.id === id) || null;
  const cursoDe = id => CURSOS.find(c => String(c.id) === String(id)) || null;

  // ---------- Errores (sin consola) ----------
  function mensaje(e) {
    const t = String((e && e.message) || '');
    const p = PROTECCIONES.find(x => t.includes(x));
    if (p) return p;
    if (e && e.code === '23505' && /socios_pkey|\(id\)/.test(t + ' ' + (e.details || ''))) return 'Esta cuenta ya tiene ficha. Recarga la página para verla.';
    return Admin.mensajeError(e);
  }
  function fallo(form, e) {
    const m = mensaje(e);
    Admin.estado(form, m, true);
    if (!Admin.visible(form)) Admin.aviso(m, 'err');
  }
  function errorCarga(caja, e, reintentar) {
    caja.innerHTML = '<div class="empty fallo" role="alert"><p>' + esc(Cueva.mensaje(e)) + '</p><button type="button" class="chip">Reintentar</button></div>';
    caja.querySelector('button').addEventListener('click', reintentar);
  }

  // Como Admin.escribir (bloqueo, filas afectadas, mensajes), pero sin escribir el error en la consola.
  async function escribir(form, consulta, textoOk) {
    const soltar = Admin.bloquear(form);
    Admin.estado(form, 'Guardando…');
    try {
      const r = await consulta();
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || r.data.length === 0) throw { sinFilas: true };
      Admin.estado(form, '');
      if (textoOk) Admin.aviso(textoOk, 'ok');
      return r.data;
    } catch (e) {
      fallo(form, e);
      return null;
    } finally {
      soltar();
    }
  }

  // Llama a generar_cuotas. Devuelve cuántas cuotas ha creado, o null si ha fallado (el error queda en el formulario).
  async function generar(form, cursoId, socioId) {
    const soltar = Admin.bloquear(form);
    Admin.estado(form, 'Generando cuotas…');
    try {
      const args = { p_curso_id: cursoId };
      if (socioId) args.p_socio_id = socioId;
      const r = await sb.rpc('generar_cuotas', args);
      if (r.error) throw r.error;
      const n = Number(r.data);
      if (!Number.isInteger(n) || n < 0) throw {};
      Admin.estado(form, '');
      return n;
    } catch (e) {
      fallo(form, e);
      return null;
    } finally {
      soltar();
    }
  }

  // ---------- Diálogos ----------
  // Diálogo modal con su título (#dlg-titulo). Al cerrarse se borra y el foco vuelve a donde estaba.
  // Mientras hay algo guardándose dentro, Escape no lo cierra.
  function crearDialogo(html) {
    const previo = document.activeElement;
    const d = document.createElement('dialog');
    d.className = 'dialogo soc-dialogo';
    d.setAttribute('aria-labelledby', 'dlg-titulo');
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('cancel', e => { if (d.querySelector('[aria-busy="true"]')) e.preventDefault(); });
    d.addEventListener('click', e => { const b = e.target.closest('[data-cerrar]'); if (b && !b.disabled) d.close(); });
    d.addEventListener('close', () => {
      d.remove();
      if (previo && previo.isConnected && Admin.visible(previo)) previo.focus({ preventScroll: true });
    });
    d.showModal();
    return d;
  }
  // Pregunta con botones. Devuelve el valor del botón pulsado, o null si se cancela (o Escape).
  function preguntar(titulo, cuerpo, botones, alAbrir) {
    return new Promise(ok => {
      let valor = null;
      const d = crearDialogo('<h2 id="dlg-titulo">' + esc(titulo) + '</h2><div id="dlg-texto">' + cuerpo + '</div>' +
        '<div class="botones-form">' + botones.map(b => '<button type="button" class="btn ' + (b.clase || '') + '" value="' + esc(b.v) + '"' + (b.off ? ' disabled' : '') + '>' + esc(b.t) + '</button>').join('') + '</div>');
      d.setAttribute('aria-describedby', 'dlg-texto');
      d.addEventListener('click', e => {
        const b = e.target.closest('.botones-form > button');
        if (!b || b.disabled) return;
        valor = b.value === 'no' ? null : b.value;
        d.close();
      });
      d.addEventListener('close', () => ok(valor));
      if (alAbrir) alAbrir(d);
      const foco = d.querySelector('[data-foco]') || d.querySelector('button[value="no"]') || d.querySelector('button');
      foco.focus();
    });
  }

  // ---------- Carga del listado ----------
  async function cargarLista(silencio) {
    if (!silencio) Cueva.cargando(el('lista'), 'Cargando socios…');
    try {
      sb = await Admin.iniciar();
      if (!yo) {
        const s = await sb.auth.getSession();
        yo = (s.data && s.data.session && s.data.session.user.id) || null;
      }
      const [p, s, c, g] = await Promise.all([
        sb.from('perfiles').select(COL_PERFIL),
        sb.from('socios').select('id,codigo,nombre_completo,nombre_pila,telefono,fundador'),
        sb.from('cursos').select('id,codigo,nombre,periodo'),
        sb.from('generos').select('nombre').order('nombre')
      ]);
      const e = p.error || s.error || c.error || g.error;
      if (e) throw e;
      const cursos = (c.data || []).slice().sort(compararCursos);
      const pend = {};
      if (cursos[0]) {
        const q = await sb.from('cuotas').select('socio_id').eq('curso_id', cursos[0].id).eq('estado', 'pendiente');
        if (q.error) throw q.error;
        (q.data || []).forEach(x => { pend[x.socio_id] = (pend[x.socio_id] || 0) + 1; });
      }
      PERFILES = p.data || []; SOCIOS = s.data || []; CURSOS = cursos; PEND = pend;
      GENEROS = (g.data || []).map(x => x.nombre).filter(Boolean);
      cargado = true;
      el('generar').hidden = false;
      pintarLista();
      pintarPendientes();
    } catch (e) {
      if (silencio) Admin.aviso('No se ha podido actualizar el listado. ' + Cueva.mensaje(e), 'err');
      else { el('cuenta').textContent = ''; errorCarga(el('lista'), e, () => cargarLista()); }
    }
  }

  // ---------- Listado ----------
  function etiquetas(s, p) {
    const t = [];
    if (p && p.rol === 'admin') t.push(['admin', 'Administrador/a']);
    if (s && s.fundador) t.push(['fundador', 'Fundador/a']);
    if (!p || p.activo !== true) t.push(['inactivo', 'Inactivo']);
    const n = s ? PEND[s.id] || 0 : 0;
    if (n) t.push(['pend', plural(n, 'cuota pendiente', 'cuotas pendientes')]);
    return t.length ? '<span class="soc-etqs">' + t.map(([k, x]) => '<span class="soc-etq ' + k + '">' + esc(x) + '</span>').join('') + '</span>' : '';
  }
  const miembrosSinFicha = () => PERFILES.filter(p => p.rol === 'miembro' && !socioDe(p.id));
  const adminsSinFicha = () => PERFILES.filter(p => p.rol === 'admin' && !socioDe(p.id));

  function pintarLista() {
    if (!cargado) return;
    // Aviso de cuentas sin ficha: solo las de rol "miembro". Las de administración van aparte (más discreto).
    const m = miembrosSinFicha().length, a = adminsSinFicha().length;
    el('aviso-pend').innerHTML = m
      ? '<button type="button" class="soc-aviso" data-pendientes><span class="soc-aviso-ic" aria-hidden="true">!</span><span><b>Hay ' + plural(m, 'cuenta sin ficha', 'cuentas sin ficha') + '</b><small>Revísalas y crea su ficha de socio.</small></span></button>'
      : a ? '<button type="button" class="enlace" data-pendientes>Cuentas de administración sin ficha (' + a + ')</button>' : '';

    const q = norm(el('q').value), qJunto = q.replace(/\s+/g, '');
    const pasa = (s, p) => filtro === 'activos' ? !!p && p.activo === true
      : filtro === 'inactivos' ? !p || p.activo !== true
      : filtro === 'pendientes' ? (PEND[s.id] || 0) > 0
      : filtro === 'admins' ? !!p && p.rol === 'admin' : true;
    const busca = (s, p) => !q || [s.nombre_completo, s.nombre_pila, s.codigo, p && p.email, s.telefono].some(x => {
      const t = norm(x);
      return t.includes(q) || (qJunto && t.replace(/\s+/g, '').includes(qJunto));
    });
    const filas = SOCIOS.slice().sort(porCodigo).map(s => ({ s, p: perfilDe(s.id) })).filter(({ s, p }) => pasa(s, p) && busca(s, p));
    el('cuenta').textContent = plural(filas.length, 'socio', 'socios');
    el('lista').innerHTML = filas.length ? filas.map(({ s, p }) =>
      '<button type="button" class="fila soc-fila' + (p && p.activo === true ? '' : ' inactiva') + '" data-id="' + esc(s.id) + '">' +
      '<span class="soc-inicial" aria-hidden="true">' + esc(inicialDe(s.nombre_pila || s.nombre_completo)) + '</span>' +
      '<span class="st"><b>' + esc(s.nombre_completo || s.nombre_pila || 'Sin nombre') + '</b><small>' + esc(s.codigo || 'Sin código') + '</small>' + etiquetas(s, p) + '</span></button>').join('')
      : '<p class="empty">' + (!SOCIOS.length ? 'Todavía no hay fichas de socios.' : 'Ningún socio coincide con la búsqueda o el filtro.') + '</p>';
  }

  // ---------- Fichas pendientes ----------
  function filaCuenta(p) {
    return '<button type="button" class="fila soc-fila' + (p.activo === true ? '' : ' inactiva') + '" data-cuenta="' + esc(p.id) + '">' +
      '<span class="soc-inicial" aria-hidden="true">' + esc(inicialDe(p.nombre || p.email)) + '</span>' +
      '<span class="st"><b>' + esc(p.email || p.nombre || 'Cuenta sin correo') + '</b>' +
      (p.creado ? '<small>Cuenta creada el ' + esc(fechaCreado(p.creado)) + '</small>' : '') +
      (p.activo === true ? '' : '<span class="soc-etqs"><span class="soc-etq inactivo">Inactiva</span></span>') + '</span></button>';
  }
  function pintarPendientes() {
    const orden = (a, b) => String(b.creado || '').localeCompare(String(a.creado || ''));
    const m = miembrosSinFicha().sort(orden), a = adminsSinFicha().sort(orden);
    el('pendientes').innerHTML = (m.length ? m.map(filaCuenta).join('') : '<p class="empty">No hay cuentas de socios pendientes de ficha.</p>') +
      (a.length ? '<details class="soc-plegable"><summary>Cuentas de administración sin ficha (' + a.length + ')</summary>' +
        '<p class="pista">Normalmente no necesitan ficha (por ejemplo, la cuenta del club). Crea una solo si esa persona también es socia.</p>' +
        a.map(filaCuenta).join('') + '</details>' : '');
  }

  // ---------- Campos del formulario de socio (ficha y "Crear ficha") ----------
  function campo(p, n, et, v, o) {
    o = o || {};
    const id = p + '-' + n;
    const input = '<input class="entrada' + (o.corta ? ' soc-corta' : '') + '" id="' + id + '" name="' + n + '" type="' + (o.tipo || 'text') + '" value="' + esc(v == null ? '' : v) + '" autocomplete="off"' +
      (o.req ? ' required' : '') + (o.tipo === 'number' ? ' min="0" max="120"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') +
      (o.modo ? ' inputmode="' + o.modo + '"' : '') + (o.lista ? ' list="' + o.lista + '"' : '') +
      (o.arroba ? ' autocapitalize="none" spellcheck="false"' : '') + (o.pista ? ' aria-describedby="' + id + '-pista"' : '') + '>';
    return '<div class="campo"><label for="' + id + '">' + esc(et) + '</label>' +
      (o.arroba ? '<div class="perfil-arroba"><span aria-hidden="true">@</span>' + input + '</div>' : input) +
      (o.pista ? '<p class="pista" id="' + id + '-pista">' + esc(o.pista) + '</p>' : '') + '</div>';
  }
  const etiqueta = (n, v, on) => '<label class="etiqueta"><input type="checkbox" name="' + n + '" value="' + esc(v) + '"' + (on ? ' checked' : '') + '><span>' + esc(v) + '</span></label>';
  function grupo(p, n, et, opciones, marcadas, pista) {
    const id = p + '-g-' + n;
    return '<fieldset class="opciones" id="' + id + '" aria-describedby="' + id + '-pista"><legend>' + esc(et) + '</legend>' +
      '<p class="pista" id="' + id + '-pista">' + esc(pista) + '</p>' +
      '<div class="etiquetas" id="' + p + '-l-' + n + '">' + opciones.map(o => etiqueta(n, o, marcadas.includes(o))).join('') + '</div></fieldset>';
  }
  function interruptor(p, n, et, on, pista) {
    const id = p + '-' + n;
    on = on === true;
    return '<div class="campo soc-switch"><span class="perfil-switch-et" id="' + id + '-et">' + esc(et) + '</span>' +
      '<button class="perfil-switch" type="button" id="' + id + '" data-switch="' + n + '" role="switch" aria-checked="' + on + '" aria-labelledby="' + id + '-et"' +
      (pista ? ' aria-describedby="' + id + '-pista"' : '') + '><span class="perfil-switch-pista" aria-hidden="true"><span></span></span>' +
      '<span class="perfil-switch-texto" aria-hidden="true">' + (on ? 'Sí' : 'No') + '</span></button>' +
      (pista ? '<p class="pista" id="' + id + '-pista">' + esc(pista) + '</p>' : '') + '</div>';
  }
  function camposSocio(p, s, correo) {
    const misG = lista(s.generos_favoritos), misM = lista(s.motivacion);
    return '<h3 class="soc-seccion">Datos personales</h3>' +
      campo(p, 'nombre_completo', 'Nombre y apellidos', s.nombre_completo, { req: true }) +
      campo(p, 'nombre_pila', 'Nombre de pila', s.nombre_pila, { req: true, pista: 'Es como se le llamará en la app.' }) +
      campo(p, 'edad', 'Edad', s.edad, { tipo: 'number', modo: 'numeric', corta: true, pista: 'Entre 0 y 120.' }) +
      campo(p, 'telefono', 'Teléfono', s.telefono, { tipo: 'tel', pista: 'Solo números y espacios; puede empezar por +. Entre 6 y 20 caracteres.' }) +
      campo(p, 'instagram', 'Instagram', s.instagram, { arroba: true, pista: 'El nombre de usuario, sin @.' }) +
      campo(p, 'tiktok', 'TikTok', s.tiktok, { arroba: true, pista: 'El nombre de usuario, sin @.' }) +
      grupo(p, 'generos_favoritos', 'Géneros favoritos', unicos(GENEROS.concat(misG)), misG, 'Marca los que quiera (máximo ' + MAX_LISTA + ').') +
      grupo(p, 'motivacion', 'Motivación', unicos(MOTIVOS.concat(misM)), misM, 'Lo que quiere trabajar en el club (máximo ' + MAX_LISTA + ').') +
      '<div class="campo"><label for="' + p + '-propia">Añadir otra motivación</label>' +
      '<div class="en-linea"><input class="entrada" id="' + p + '-propia" type="text" maxlength="' + MAX_PROPIA + '" autocomplete="off" aria-describedby="' + p + '-propia-pista ' + p + '-propia-error">' +
      '<button class="btn sec" type="button" data-anadir="' + p + '">Añadir</button></div>' +
      '<p class="pista" id="' + p + '-propia-pista">Máximo ' + MAX_PROPIA + ' caracteres. Se añade ya marcada.</p>' +
      '<p class="error-campo" id="' + p + '-propia-error" hidden></p><p class="perfil-sr" role="status" id="' + p + '-anadida"></p></div>' +
      campo(p, 'como_nos_conocio', 'Cómo nos conoció', s.como_nos_conocio, { lista: p + '-conocio', max: MAX_CONOCIO, pista: 'Elige una sugerencia o escríbelo.' }) +
      '<datalist id="' + p + '-conocio">' + CONOCIO.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      interruptor(p, 'libro_publicado', 'Libro publicado', s.libro_publicado) +
      '<div class="campo"><label for="' + p + '-correo">Correo de la cuenta</label>' +
      '<input class="entrada" id="' + p + '-correo" type="email" value="' + esc(correo || '') + '" readonly aria-describedby="' + p + '-correo-pista">' +
      '<p class="pista" id="' + p + '-correo-pista">Solo lectura: es el correo con el que entra en la app.</p></div>' +
      '<h3 class="soc-seccion">Inscripción y consentimientos</h3>' +
      campo(p, 'fecha_inscripcion', 'Fecha de inscripción', s.fecha_inscripcion, { tipo: 'date', pista: 'Puede quedar vacía si es fundador/a.' }) +
      interruptor(p, 'fundador', 'Fundador/a', s.fundador) +
      interruptor(p, 'rgpd_imagen', 'Uso de imagen en redes', s.rgpd_imagen, 'Márcalo solo si consta por escrito.') +
      interruptor(p, 'rgpd_publicaciones', 'Publicación de textos', s.rgpd_publicaciones, 'Márcalo solo si consta por escrito.');
  }

  const interruptorDe = (form, n) => form.querySelector('[data-switch="' + n + '"]');
  const encendido = (form, n) => { const b = interruptorDe(form, n); return !!b && b.getAttribute('aria-checked') === 'true'; };

  // Obligatorios: la fecha de inscripción solo lo es si no es fundador/a.
  function prepararForm(form) {
    form.elements.fecha_inscripcion.required = !encendido(form, 'fundador');
    Admin.obligatorios(form);
  }

  // Instantánea de lo escrito (se toma antes de cualquier espera).
  function leer(form) {
    const e = form.elements, v = n => String(e[n].value || '').trim();
    const marcadas = n => [...form.querySelectorAll('input[name="' + n + '"]:checked')].map(i => i.value);
    return {
      nombre_completo: v('nombre_completo'),
      nombre_pila: v('nombre_pila'),
      edad: v('edad') === '' ? null : parseInt(v('edad'), 10),
      telefono: v('telefono') || null,
      instagram: usuarioRed(e.instagram.value) || null,
      tiktok: usuarioRed(e.tiktok.value) || null,
      generos_favoritos: marcadas('generos_favoritos'),
      motivacion: marcadas('motivacion'),
      como_nos_conocio: v('como_nos_conocio') || null,
      libro_publicado: encendido(form, 'libro_publicado'),
      fecha_inscripcion: v('fecha_inscripcion') || null,
      fundador: encendido(form, 'fundador'),
      rgpd_imagen: encendido(form, 'rgpd_imagen'),
      rgpd_publicaciones: encendido(form, 'rgpd_publicaciones')
    };
  }
  // Reglas de la base de datos que Admin.validar no cubre por sí solo.
  const reglas = form => () => {
    const er = {}, e = form.elements, v = n => String(e[n].value || '').trim();
    if (/^\d+$/.test(v('edad')) && +v('edad') > 120) er.edad = 'La edad debe ser un número entero entre 0 y 120.';
    const t = v('telefono');
    if (t && (!TELEFONO.test(t) || t.length < 6 || t.length > 20)) er.telefono = 'El teléfono solo puede llevar números y espacios, con un + opcional al principio, y tener entre 6 y 20 caracteres.';
    ['instagram', 'tiktok'].forEach(k => {
      const u = usuarioRed(e[k].value);
      if (u && (!USUARIO_RED.test(u) || u.length > MAX_RED)) er[k] = 'Escribe solo el usuario: letras, números, puntos y guiones bajos (máximo ' + MAX_RED + ').';
    });
    ['generos_favoritos', 'motivacion'].forEach(k => {
      if (form.querySelectorAll('input[name="' + k + '"]:checked').length > MAX_LISTA) er[k] = 'Marca como máximo ' + MAX_LISTA + '.';
    });
    if (Array.from(v('como_nos_conocio')).length > MAX_CONOCIO) er.como_nos_conocio = 'Máximo ' + MAX_CONOCIO + ' caracteres.';
    return er;
  };

  // Añade una motivación propia (o marca la que ya existía con ese nombre). Devuelve false si no es válida.
  function anadirPropia(p) {
    const inp = el(p + '-propia');
    if (!inp) return true;
    const err = el(p + '-propia-error');
    const marca = t => { err.textContent = t || ''; err.hidden = !t; if (t) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); };
    const v = inp.value.trim().replace(/\s+/g, ' ');
    marca('');
    if (!v) return true;
    if (Array.from(v).length > MAX_PROPIA) { marca('Máximo ' + MAX_PROPIA + ' caracteres.'); inp.focus(); return false; }
    const caja = el(p + '-l-motivacion');
    const ya = [...caja.querySelectorAll('input')].find(i => i.value.toLocaleLowerCase('es') === v.toLocaleLowerCase('es'));
    if (ya) ya.checked = true; else caja.insertAdjacentHTML('beforeend', etiqueta('motivacion', v, true));
    inp.value = '';
    el(p + '-anadida').textContent = 'Añadida y marcada: ' + v;
    return true;
  }

  // ---------- Ficha del socio ----------
  function abrirFicha(id) {
    Admin.abrir('vista-ficha');
    cargarFicha(id);
  }
  async function cargarFicha(id) {
    const token = ++pedida, caja = el('ficha');
    ficha = null;
    Cueva.cargando(caja, 'Cargando la ficha…');
    try {
      const [s, p, cu, as] = await Promise.all([
        sb.from('socios').select(COLUMNAS).eq('id', id).maybeSingle(),
        sb.from('perfiles').select(COL_PERFIL).eq('id', id).maybeSingle(),
        sb.from('cuotas').select(COL_CUOTA).eq('socio_id', id),
        sb.from('asistencia').select('evento_id,asistio').eq('socio_id', id)
      ]);
      const e = s.error || p.error || cu.error || as.error;
      if (e) throw e;
      const ids = unicos((as.data || []).map(a => a.evento_id).filter(x => x != null));
      let eventos = [];
      if (ids.length) {
        const ev = await sb.from('eventos').select('id,fecha,titulo').in('id', ids);
        if (ev.error) throw ev.error;
        eventos = ev.data || [];
      }
      if (token !== pedida) return;
      if (!s.data) { caja.innerHTML = '<p class="empty">Esta ficha ya no existe. Vuelve al listado.</p>'; return; }
      ficha = {
        socio: s.data, perfil: p.data || null, cuotas: cu.data || [], curso: null,
        asistencia: (as.data || []).map(a => Object.assign({ evento: eventos.find(x => String(x.id) === String(a.evento_id)) || null }, a))
      };
      pintarFicha();
      const t = el('ficha-nombre');
      if (t && Admin.visible(t)) t.focus({ preventScroll: true });
    } catch (e) {
      if (token === pedida) errorCarga(caja, e, () => cargarFicha(id));
    }
  }

  const nombreDe = () => ficha.socio.nombre_completo || ficha.socio.nombre_pila || 'este socio';
  function reponer(id, html) { const x = el(id); if (x) x.outerHTML = html; }

  function pintarFicha() {
    el('ficha').innerHTML = htmlCabecera() +
      '<form class="card formulario" id="form-ficha" novalidate>' + htmlFormFicha() + '</form>' +
      htmlCuenta() + htmlCuotas() + htmlAsistencia() + htmlBajas();
    prepararForm(el('form-ficha'));
  }

  function htmlCabecera() {
    const s = ficha.socio, p = ficha.perfil;
    return '<section class="card soc-cabecera" id="ficha-cabecera">' +
      '<span class="soc-inicial" aria-hidden="true">' + esc(inicialDe(s.nombre_pila || s.nombre_completo)) + '</span>' +
      '<div class="soc-cab-tx"><h2 id="ficha-nombre" tabindex="-1">' + esc(s.nombre_completo || s.nombre_pila || 'Sin nombre') + '</h2>' +
      '<p class="soc-sub">' + esc(s.codigo || 'Sin código') + (p && p.email ? ' · ' + esc(p.email) : '') + '</p>' + etiquetas(s, p) + '</div></section>';
  }

  function htmlFormFicha() {
    return '<h2>Datos de la ficha</h2><p class="msg" data-estado hidden></p>' +
      camposSocio('f', ficha.socio, ficha.perfil && ficha.perfil.email) +
      '<div class="botones-form"><button type="submit" class="btn">Guardar</button>' +
      '<button type="button" class="btn sec" data-descartar>Cancelar</button></div>';
  }

  function htmlCuenta() {
    const p = ficha.perfil;
    if (!p) return '<section class="card soc-tarjeta" id="form-cuenta"><h2>Cuenta</h2><p class="empty">No se ha encontrado la cuenta de acceso de esta ficha.</p></section>';
    const activa = p.activo === true;
    const roles = [['miembro', 'Miembro'], ['admin', 'Administrador/a']];
    if (!roles.some(r => r[0] === p.rol)) roles.push([p.rol, String(p.rol || 'Sin rol')]);
    return '<form class="card soc-tarjeta" id="form-cuenta" novalidate aria-labelledby="t-cuenta"><h2 id="t-cuenta">Cuenta</h2>' +
      (p.id === yo ? '<p class="msg aviso">Es tu propia cuenta: la base de datos no te deja quitarte el rol de administrador ni desactivarte.</p>' : '') +
      '<div class="soc-cuenta-fila"><p>Estado: <b>' + (activa ? 'Activa' : 'Desactivada') + '</b></p>' +
      '<button type="button" class="btn sec" data-activo="' + !activa + '">' + (activa ? 'Desactivar cuenta' : 'Activar cuenta') + '</button></div>' +
      '<div class="campo"><label for="f-rol">Rol</label><select class="entrada" id="f-rol" data-rol="' + esc(p.rol) + '">' +
      roles.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === p.rol ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
      '<p class="pista">Un administrador puede ver y cambiar todos los datos de los socios.</p></div>' +
      '<p class="msg" data-estado hidden></p></form>';
  }

  // Cuotas: pestañas por curso (el más reciente primero), matrícula y 10 meses.
  function cursosConCuotas() {
    return unicos(ficha.cuotas.map(c => String(c.curso_id))).map(id => cursoDe(id) || { id, codigo: '', nombre: 'Curso' }).sort(compararCursos);
  }
  // Año en que empieza el curso: por las mensualidades; si no hay, por el código ("2027" → 2026).
  function inicioCurso(curso, cuotas) {
    const anios = cuotas.filter(c => c.tipo === 'mensualidad').map(c => /^(\d{4})-(\d{2})/.exec(c.mes || '')).filter(Boolean).map(m => +m[2] >= 9 ? +m[1] : +m[1] - 1);
    if (anios.length) return Math.min.apply(null, anios);
    const n = parseInt(curso.codigo, 10);
    if (n > 1900) return n - 1;
    const d = new Date();
    return d.getMonth() + 1 >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  }
  const insignia = c => {
    const e = c && ESTADOS[c.estado];
    return e ? '<span class="perfil-estado ' + c.estado + '">' + ic(e.i) + e.n + '</span>' : '<span class="perfil-estado sin">Sin cuota</span>';
  };
  const textoPago = c => c && c.estado === 'pagada' && c.fecha_pago ? 'Pagada el ' + Admin.fecha(c.fecha_pago) : '';

  function htmlCuotas() {
    const cs = cursosConCuotas(), ultimo = CURSOS[0];
    let cuerpo;
    if (!cs.length) {
      cuerpo = ultimo
        ? '<p class="empty">No tiene cuotas de ningún curso.</p><div class="botones-form"><button type="button" class="btn" data-generar="' + esc(ultimo.id) + '">Generar cuotas del curso más reciente</button></div>' +
          '<p class="pista">' + esc(nombreCurso(ultimo)) + ': se crearán la matrícula y las 10 mensualidades.</p>'
        : '<p class="empty">No tiene cuotas y todavía no hay cursos. Hay que crearlos primero en la base de datos.</p>';
    } else {
      const f = ficha;
      if (!f.curso || !cs.some(c => String(c.id) === f.curso)) f.curso = String(cs[0].id);
      const curso = cs.find(c => String(c.id) === f.curso);
      const del = f.cuotas.filter(c => String(c.curso_id) === f.curso);
      const tabs = cs.length > 1
        ? '<div class="tabs perfil-tabs" role="tablist" aria-label="Cursos" style="grid-template-columns:repeat(' + cs.length + ',1fr)">' +
          cs.map(c => '<button class="tab" type="button" role="tab" data-curso="' + esc(c.id) + '" aria-selected="' + (String(c.id) === f.curso) + '">' + esc(nombreCurso(c)) + '</button>').join('') + '</div>'
        : '<p class="perfil-curso">' + esc(nombreCurso(curso)) + '</p>';
      const cuenta = k => del.filter(c => c.estado === k).length;
      const resumen = '<p class="perfil-resumen">' + Object.keys(ESTADOS).map(k => ESTADOS[k].p + ': <b>' + cuenta(k) + '</b>').join(' · ') + '</p>';
      const mat = del.find(c => c.tipo === 'matricula');
      const matricula = mat
        ? '<button type="button" class="perfil-matricula soc-matricula ' + esc(mat.estado) + '" data-tipo="matricula" data-mes="" aria-label="' + esc('Matrícula: ' + (ESTADOS[mat.estado] ? ESTADOS[mat.estado].n : mat.estado) + (textoPago(mat) ? ', ' + textoPago(mat).toLowerCase() : '') + '. Cambiar estado') + '">' +
          '<span>Matrícula</span><span class="soc-mat-estado">' + insignia(mat) + (textoPago(mat) ? '<small class="soc-pago">' + esc(textoPago(mat)) + '</small>' : '') + '</span></button>'
        : '<div class="perfil-matricula"><span>Matrícula</span>' + insignia(null) + '</div>';
      const a0 = inicioCurso(curso, del);
      const meses = MESES_CURSO.map(m => {
        const a = m >= 9 ? a0 : a0 + 1, clave = a + '-' + dos(m);
        const c = del.find(x => x.tipo === 'mensualidad' && String(x.mes || '').slice(0, 7) === clave);
        const cab = '<span class="perfil-mes-nombre" aria-hidden="true">' + MESES_CORTOS[m - 1] + '</span><span class="perfil-mes-anio" aria-hidden="true">' + a + '</span>';
        if (!c) return '<li><div class="perfil-mes sin">' + cab + '<span class="perfil-sr">' + MESES[m - 1] + ' de ' + a + ': </span>' + insignia(null) + '</div></li>';
        const nombre = MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + ' de ' + a;
        return '<li><button type="button" class="perfil-mes soc-mes ' + esc(c.estado) + '" data-tipo="mensualidad" data-mes="' + esc(c.mes) + '" aria-label="' +
          esc(nombre + ': ' + (ESTADOS[c.estado] ? ESTADOS[c.estado].n : c.estado) + (textoPago(c) ? ', ' + textoPago(c).toLowerCase() : '') + '. Cambiar estado') + '">' +
          cab + insignia(c) + (textoPago(c) ? '<small class="soc-pago">' + esc(Admin.fecha(c.fecha_pago)) + '</small>' : '') + '</button></li>';
      }).join('');
      const faltan = 11 - del.length;
      const ultimoSin = ultimo && !cs.some(c => String(c.id) === String(ultimo.id));
      cuerpo = tabs + resumen + matricula + '<h3 class="perfil-subtitulo">Mensualidades</h3><ul class="perfil-meses">' + meses + '</ul>' +
        '<p class="pista soc-pista-cuotas">Pulsa una cuota para cambiar su estado.</p>' +
        (faltan > 0 ? '<p class="pista">Faltan ' + plural(faltan, 'cuota', 'cuotas') + ' de este curso.</p><div class="botones-form"><button type="button" class="btn sec" data-generar="' + esc(curso.id) + '">Crear las que faltan</button></div>' : '') +
        (ultimoSin ? '<div class="botones-form"><button type="button" class="btn sec" data-generar="' + esc(ultimo.id) + '">Generar cuotas de ' + esc(nombreCurso(ultimo)) + '</button></div>' : '');
    }
    return '<form class="card soc-tarjeta" id="form-cuotas" novalidate aria-labelledby="t-cuotas"><h2 id="t-cuotas">Cuotas</h2>' + cuerpo + '<p class="msg" data-estado hidden></p></form>';
  }

  function htmlAsistencia() {
    const a = ficha.asistencia, n = a.length, x = a.filter(r => r.asistio === true).length;
    const fecha = r => (r.evento && r.evento.fecha) || '';
    const cuerpo = n
      ? '<p class="soc-resumen"><b>Asistió a ' + x + ' de ' + plural(n, 'sesión', 'sesiones') + '</b></p><ul class="perfil-sesiones">' +
        a.slice().sort((p, q) => fecha(q).localeCompare(fecha(p))).map(r => {
          const si = r.asistio === true, ev = r.evento || {};
          return '<li class="perfil-sesion ' + (si ? 'si' : 'no') + '"><span class="perfil-sesion-fecha">' + esc(Admin.fecha(ev.fecha) || 'Sin fecha') + '</span>' +
            '<b class="perfil-sesion-titulo">' + esc(ev.titulo || 'Sesión') + '</b>' +
            '<span class="perfil-asis ' + (si ? 'si' : 'no') + '"><span aria-hidden="true">' + (si ? '✓' : '✗') + '</span> ' + (si ? 'Asistió' : 'No asistió') + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="empty">Todavía no hay registros de asistencia.</p>';
    return '<section class="card soc-tarjeta" id="ficha-asistencia" aria-labelledby="t-asistencia"><h2 id="t-asistencia">Asistencia</h2>' + cuerpo +
      '<p class="pista">Solo lectura. La asistencia se edita al pasar lista.</p></section>';
  }

  function htmlBajas() {
    const p = ficha.perfil, activa = !!p && p.activo === true;
    return '<form class="card soc-bajas" id="form-bajas" novalidate aria-labelledby="t-bajas"><h2 id="t-bajas">Zona de bajas</h2>' +
      '<div class="soc-baja"><div><b>Desactivar cuenta</b><p class="pista">No podrá entrar en la app. Sus datos se conservan y se puede volver a activar.</p></div>' +
      (activa ? '<button type="button" class="btn sec" data-activo="false">Desactivar cuenta</button>' : '<p class="soc-hecho">La cuenta ya está desactivada.</p>') + '</div>' +
      '<div class="soc-baja"><div><b>Eliminar ficha</b><p class="pista">Borra la ficha, sus cuotas y su asistencia. No se puede deshacer.</p></div>' +
      '<button type="button" class="btn peligro" data-eliminar>Eliminar ficha</button></div>' +
      '<p class="msg" data-estado hidden></p></form>';
  }

  // Tras un cambio en la cuenta: cabecera, cuenta y zona de bajas (el formulario de datos no se toca: puede tener cambios sin guardar).
  function repintarCuenta() {
    reponer('ficha-cabecera', htmlCabecera());
    reponer('form-cuenta', htmlCuenta());
    reponer('form-bajas', htmlBajas());
  }
  function actualizarPerfil(p) {
    const i = PERFILES.findIndex(x => x.id === p.id);
    if (i >= 0) PERFILES[i] = Object.assign({}, PERFILES[i], p);
    if (ficha && ficha.socio.id === p.id) ficha.perfil = Object.assign({}, ficha.perfil, p);
  }

  // ---------- Acciones de la ficha ----------
  async function guardarFicha(form) {
    if (form.getAttribute('aria-busy')) return; // ya se está guardando
    if (!anadirPropia('f')) return;
    if (!Admin.validar(form, reglas(form))) return;
    const datos = leer(form), id = ficha.socio.id; // instantánea
    const r = await escribir(form, () => sb.from('socios').update(datos).eq('id', id).select(COLUMNAS), 'Ficha guardada.');
    if (!r) return;
    const i = SOCIOS.findIndex(s => s.id === id);
    if (i >= 0) SOCIOS[i] = Object.assign({}, SOCIOS[i], r[0]);
    if (ficha && ficha.socio.id === id) {
      ficha.socio = r[0];
      reponer('ficha-cabecera', htmlCabecera());
      form.innerHTML = htmlFormFicha();
      prepararForm(form);
    }
    pintarLista();
    cargarLista(true);
  }

  function descartar(form) {
    if (form.getAttribute('aria-busy')) return;
    form.innerHTML = htmlFormFicha();
    prepararForm(form);
    Admin.estado(form, 'Se han descartado los cambios.');
    form.elements.nombre_completo.focus();
  }

  async function cambiarActivo(form, nuevo) {
    if (form.getAttribute('aria-busy') || !ficha || !ficha.perfil) return;
    const id = ficha.perfil.id, nombre = nombreDe(); // instantánea
    const si = await Admin.confirmar(nuevo
      ? 'Se activará la cuenta de ' + nombre + ': podrá volver a entrar en la app.'
      : 'Se desactivará la cuenta de ' + nombre + ': no podrá entrar en la app hasta que se vuelva a activar. Sus datos no se borran.',
    nuevo ? 'Activar cuenta' : 'Desactivar cuenta');
    if (!si) return;
    const r = await escribir(form, () => sb.from('perfiles').update({ activo: nuevo }).eq('id', id).select(COL_PERFIL), nuevo ? 'Cuenta activada.' : 'Cuenta desactivada.');
    if (!r) return; // el mensaje queda en la tarjeta y todo sigue como estaba
    actualizarPerfil(r[0]);
    if (ficha && ficha.socio.id === id) repintarCuenta();
    pintarLista();
  }

  async function cambiarRol(sel) {
    const form = sel.form, antes = sel.dataset.rol, nuevo = sel.value;
    if (nuevo === antes || !ficha || !ficha.perfil) return;
    const id = ficha.perfil.id, nombre = nombreDe(); // instantánea
    const si = await Admin.confirmar(nuevo === 'admin'
      ? 'Vas a hacer administrador a ' + nombre + ': podrá ver y cambiar todos los datos de los socios.'
      : nombre + ' dejará de ser administrador/a: ya no podrá entrar en el panel de administración.',
    nuevo === 'admin' ? 'Hacer administrador' : 'Quitar el rol');
    if (!si) { sel.value = antes; return; }
    const r = await escribir(form, () => sb.from('perfiles').update({ rol: nuevo }).eq('id', id).select(COL_PERFIL), 'Rol cambiado: ' + (nuevo === 'admin' ? 'Administrador/a' : 'Miembro') + '.');
    if (!r) { sel.value = antes; return; } // todo queda como estaba; el mensaje sigue en la tarjeta
    actualizarPerfil(r[0]);
    if (ficha && ficha.socio.id === id) repintarCuenta();
    pintarLista();
  }

  async function recargarCuotas(id) {
    const r = await sb.from('cuotas').select(COL_CUOTA).eq('socio_id', id);
    if (r.error) { Admin.aviso('No se han podido recargar las cuotas. ' + Cueva.mensaje(r.error), 'err'); return; }
    if (ficha && ficha.socio.id === id) { ficha.cuotas = r.data || []; reponer('form-cuotas', htmlCuotas()); }
  }

  async function generarDelSocio(form, cursoId) {
    if (form.getAttribute('aria-busy') || !ficha) return;
    const id = ficha.socio.id, curso = cursoDe(cursoId); // instantánea
    if (!curso) return;
    const n = await generar(form, curso.id, id);
    if (n == null) return;
    Admin.aviso(textoCuotas(n), 'ok');
    if (ficha && ficha.socio.id === id) ficha.curso = String(curso.id);
    await recargarCuotas(id);
    const b = el('t-cuotas');
    if (b) { b.setAttribute('tabindex', '-1'); b.focus({ preventScroll: true }); }
    cargarLista(true);
  }

  // Diálogo de una cuota: las tres opciones y Guardar.
  function abrirCuota(boton) {
    if (!ficha) return;
    const tipo = boton.dataset.tipo, mes = boton.dataset.mes || null, curso = ficha.curso, id = ficha.socio.id;
    const c = ficha.cuotas.find(x => String(x.curso_id) === curso && x.tipo === tipo && (x.mes || null) === mes);
    if (!c) return;
    const p = /^(\d{4})-(\d{2})/.exec(mes || '');
    const titulo = tipo === 'matricula' ? 'Matrícula' : MESES[+p[2] - 1].charAt(0).toUpperCase() + MESES[+p[2] - 1].slice(1) + ' de ' + p[1];
    const opciones = Object.keys(ESTADOS).map(k => '<label class="opcion"><input type="radio" name="estado" value="' + k + '"' + (k === c.estado ? ' checked' : '') + '> ' + ESTADOS[k].n +
      (k === 'pagada' ? '<small class="pista">' + (c.estado === 'pagada' && c.fecha_pago ? ' (desde el ' + esc(Admin.fecha(c.fecha_pago)) + ')' : ' (se guardará la fecha de hoy)') + '</small>' : '') + '</label>').join('');
    const d = crearDialogo('<form id="form-cuota" novalidate><h2 id="dlg-titulo">' + esc(titulo) + '</h2>' +
      '<p id="dlg-texto">' + esc(nombreDe() + ' · ' + nombreCurso(cursoDe(curso))) + '</p>' +
      '<fieldset class="opciones"><legend>Estado de la cuota</legend>' + opciones + '</fieldset>' +
      '<p class="msg" data-estado hidden></p>' +
      '<div class="botones-form"><button type="button" class="btn sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>');
    d.setAttribute('aria-describedby', 'dlg-texto');
    const form = d.querySelector('form');
    form.querySelector('input:checked').focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (form.getAttribute('aria-busy')) return;
      const nuevo = (form.querySelector('input:checked') || {}).value; // instantánea
      if (!nuevo || nuevo === c.estado) { d.close(); return; }
      const r = await escribir(form, () => {
        let q = sb.from('cuotas').update({ estado: nuevo }).eq('socio_id', id).eq('curso_id', c.curso_id).eq('tipo', tipo);
        q = mes == null ? q.is('mes', null) : q.eq('mes', mes);
        return q.select(COL_CUOTA);
      }, titulo + ': ' + ESTADOS[nuevo].n + '.');
      if (!r) return;
      Object.assign(c, r[0]);
      d.close();
      if (ficha && ficha.socio.id === id) {
        reponer('form-cuotas', htmlCuotas());
        const sel = '#form-cuotas [data-tipo="' + tipo + '"][data-mes="' + (mes || '') + '"]';
        const b = document.querySelector(sel);
        if (b) b.focus({ preventScroll: true });
      }
      cargarLista(true);
    });
  }

  // Eliminar ficha: doble confirmación; primero se desactiva la cuenta (si la base de datos lo impide, no se borra nada)
  // y después se borra la fila de socios (la base de datos borra en cascada sus cuotas y su asistencia).
  async function eliminar(form) {
    if (form.getAttribute('aria-busy') || !ficha) return;
    const s = ficha.socio, p = ficha.perfil, id = s.id, nombre = nombreDe(), codigo = String(s.codigo || ''); // instantánea
    const paso1 = await preguntar('Eliminar ficha',
      '<p>Vas a eliminar la ficha de <b>' + esc(nombre) + '</b> (' + esc(codigo) + '). Se borrará:</p>' +
      '<ul class="soc-borrar-lista"><li>La ficha con sus datos personales.</li><li>Todas sus cuotas.</li><li>Todo su registro de asistencia.</li></ul>' +
      '<p><b>No se puede deshacer.</b> La cuenta de acceso se desactiva y, si hay que borrarla, se borra aparte en Supabase. ' +
      'Los préstamos de libros con su nombre se conservan, como indica la política de privacidad.</p>',
      [{ v: 'no', t: 'Cancelar', clase: 'sec' }, { v: 'si', t: 'Continuar', clase: 'peligro' }]);
    if (!paso1) return;
    const valido = v => { const t = v.trim().toLocaleUpperCase('es'); return t === 'ELIMINAR' || (!!codigo && t === codigo.toLocaleUpperCase('es')); };
    const paso2 = await preguntar('Confirma la eliminación',
      '<p>Para confirmar, escribe <b>ELIMINAR</b> o el código <b>' + esc(codigo) + '</b>.</p>' +
      '<div class="campo"><label for="dlg-confirma">Palabra de confirmación</label><input class="entrada" id="dlg-confirma" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-foco></div>',
      [{ v: 'no', t: 'Cancelar', clase: 'sec' }, { v: 'si', t: 'Eliminar definitivamente', clase: 'peligro', off: true }],
      d => {
        const inp = d.querySelector('#dlg-confirma'), b = d.querySelector('button[value="si"]');
        inp.addEventListener('input', () => { b.disabled = !valido(inp.value); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!b.disabled) b.click(); } });
      });
    if (!paso2) return;
    const soltar = Admin.bloquear(form);
    Admin.estado(form, 'Eliminando…');
    let desactivada = false, error = null, paso = '';
    try {
      if (p && p.activo === true) {
        paso = 'cuenta';
        const r = await sb.from('perfiles').update({ activo: false }).eq('id', id).select(COL_PERFIL);
        if (r.error) throw r.error;
        if (!Array.isArray(r.data) || !r.data.length) throw { sinFilas: true };
        desactivada = true;
        actualizarPerfil(r.data[0]);
      }
      paso = 'ficha';
      const r2 = await sb.from('socios').delete().eq('id', id).select('id');
      if (r2.error) throw r2.error;
      if (!Array.isArray(r2.data) || !r2.data.length) throw { sinFilas: true };
    } catch (e) {
      error = e;
    } finally {
      soltar();
    }
    if (error) {
      const m = mensaje(error);
      const texto = paso === 'cuenta' ? 'No se ha borrado nada. ' + m
        : desactivada ? 'La cuenta se ha desactivado, pero la ficha NO se ha borrado. ' + m : 'La ficha no se ha borrado. ' + m;
      if (desactivada && ficha && ficha.socio.id === id) repintarCuenta();
      const f = el('form-bajas');
      if (f) Admin.estado(f, texto, true);
      Admin.aviso(texto, 'err');
      cargarLista(true);
      return;
    }
    SOCIOS = SOCIOS.filter(x => x.id !== id);
    Admin.aviso('Ficha de ' + nombre + ' eliminada. La cuenta queda desactivada; si hay que borrarla, hazlo aparte en Supabase.', 'ok');
    if (ficha && ficha.socio.id === id) { ficha = null; Admin.cerrar(); }
    pintarLista();
    cargarLista(true);
  }

  // ---------- Crear ficha ----------
  // Código: máximo numérico de los A-NNN + 1, con 3 cifras como mínimo.
  const codigoDe = codigos => {
    let max = 0;
    codigos.forEach(c => { const m = /^A-(\d+)$/.exec(c || ''); if (m) max = Math.max(max, +m[1]); });
    return 'A-' + String(max + 1).padStart(3, '0');
  };
  async function siguienteCodigo() {
    const r = await sb.from('socios').select('codigo');
    if (r.error) throw r.error;
    return codigoDe((r.data || []).map(x => x.codigo));
  }

  function abrirCrear(id) {
    const p = perfilDe(id);
    if (!p || socioDe(id)) return;
    cuentaCrear = p;
    const f = el('form-crear'), ultimo = CURSOS[0];
    f.innerHTML = '<h2 tabindex="-1" data-foco>Crear ficha</h2><p class="msg" data-estado hidden></p>' +
      '<div class="soc-crear-cuenta"><p><b>' + esc(p.email || 'Cuenta sin correo') + '</b></p>' +
      '<p class="pista">' + (p.creado ? 'Cuenta creada el ' + esc(fechaCreado(p.creado)) + '. ' : '') + (p.rol === 'admin' ? 'Cuenta de administración. ' : '') +
      'Se le asignará el código <b>' + esc(codigoDe(SOCIOS.map(s => s.codigo))) + '</b> (o el siguiente libre al guardar).</p></div>' +
      camposSocio('c', { nombre_pila: p.nombre || '', fecha_inscripcion: Admin.hoy(), fundador: false, rgpd_imagen: false, rgpd_publicaciones: false, libro_publicado: false }, p.email) +
      '<h3 class="soc-seccion">Cuenta y cuotas</h3>' +
      (p.activo === true ? '<p class="pista">La cuenta ya está activa.</p>'
        : '<label class="opcion"><input type="checkbox" id="c-activar" checked> Activar la cuenta</label><p class="pista">Si no la activas, la ficha se crea pero no podrá entrar en la app.</p>') +
      '<p class="pista">' + (ultimo ? 'Al guardar se crearán sus cuotas de ' + esc(nombreCurso(ultimo)) + '.' : 'No hay cursos: las cuotas se podrán crear cuando existan.') + '</p>' +
      '<div class="botones-form"><button type="submit" class="btn">Crear ficha</button><button type="button" class="btn sec" data-cancelar>Cancelar</button></div>';
    Admin.abrir('vista-crear');
    prepararForm(f);
  }

  async function crearFicha(form) {
    if (form.getAttribute('aria-busy') || !cuentaCrear) return;
    if (!anadirPropia('c')) return;
    if (!Admin.validar(form, reglas(form))) return;
    // Instantánea
    const datos = leer(form), cuenta = cuentaCrear, id = cuenta.id, curso = CURSOS[0] || null;
    const activar = !!(el('c-activar') && el('c-activar').checked);
    const soltar = Admin.bloquear(form);
    Admin.estado(form, 'Creando la ficha…');
    let creada = null;
    try {
      // Si otro administrador ha cogido el mismo código a la vez, se recalcula y se reintenta una vez.
      for (let intento = 0; intento < 2 && !creada; intento++) {
        const codigo = await siguienteCodigo();
        const r = await sb.from('socios').insert(Object.assign({ id, codigo }, datos)).select(COLUMNAS);
        if (r.error && r.error.code === '23505' && /codigo/.test(String(r.error.message || '') + ' ' + String(r.error.details || '')) && intento === 0) continue;
        if (r.error) throw r.error;
        if (!Array.isArray(r.data) || !r.data.length) throw { sinFilas: true };
        creada = r.data[0];
      }
    } catch (e) {
      soltar();
      fallo(form, e);
      return;
    }
    // Paso 2: activar la cuenta
    let pasoCuenta;
    if (cuenta.activo === true) pasoCuenta = ['ok', 'La cuenta ya estaba activa.'];
    else if (!activar) pasoCuenta = ['no', 'La cuenta sigue desactivada (no se marcó «Activar la cuenta»).'];
    else {
      try {
        const r = await sb.from('perfiles').update({ activo: true }).eq('id', id).select(COL_PERFIL);
        if (r.error) throw r.error;
        if (!Array.isArray(r.data) || !r.data.length) throw { sinFilas: true };
        actualizarPerfil(r.data[0]);
        pasoCuenta = ['ok', 'Cuenta activada.'];
      } catch (e) { pasoCuenta = ['err', 'No se ha podido activar la cuenta: ' + mensaje(e) + ' Puedes activarla desde la ficha.']; }
    }
    // Paso 3: cuotas del curso más reciente
    let pasoCuotas;
    if (!curso) pasoCuotas = ['no', 'No se han creado cuotas: no hay cursos en la base de datos.'];
    else {
      try {
        const r = await sb.rpc('generar_cuotas', { p_curso_id: curso.id, p_socio_id: id });
        if (r.error) throw r.error;
        pasoCuotas = ['ok', textoCuotas(Number(r.data) || 0).replace(/\.$/, '') + ' (' + nombreCurso(curso) + ').'];
      } catch (e) { pasoCuotas = ['err', 'No se han podido crear las cuotas: ' + mensaje(e) + ' Puedes crearlas desde la ficha.']; }
    }
    soltar();
    Admin.estado(form, '');
    SOCIOS.push({ id, codigo: creada.codigo, nombre_completo: creada.nombre_completo, nombre_pila: creada.nombre_pila, telefono: creada.telefono, fundador: creada.fundador });
    pintarLista(); pintarPendientes();
    const pasos = [['ok', 'Ficha creada con el código ' + creada.codigo + '.'], pasoCuenta, pasoCuotas];
    if (pasos.some(x => x[0] === 'err')) {
      await preguntar('Ficha creada a medias',
        '<p>Esto es lo que ha quedado hecho:</p><ul class="soc-pasos">' + pasos.map(([k, t]) =>
          '<li class="' + k + '"><span aria-hidden="true">' + (k === 'ok' ? '✓' : k === 'err' ? '✗' : '–') + '</span> ' + esc(t) + '</li>').join('') + '</ul>',
        [{ v: 'ok', t: 'Entendido' }]);
    } else {
      Admin.aviso(pasos.map(x => x[1]).join(' '), 'ok');
    }
    cuentaCrear = null;
    // Se abre la ficha nueva en lugar del formulario ("atrás" vuelve a las fichas pendientes).
    if (Admin.visible(form)) {
      history.replaceState({ vista: 'vista-ficha' }, '');
      Admin.mostrar('vista-ficha');
      cargarFicha(id);
    }
    cargarLista(true);
  }

  // ---------- Generar cuotas de un curso ----------
  function abrirGenerar() {
    if (!CURSOS.length) {
      preguntar('Generar cuotas', '<p>No hay ningún curso en la base de datos. Hay que crearlos primero en la base de datos (tabla «cursos»); después podrás generar sus cuotas aquí.</p>', [{ v: 'ok', t: 'Entendido' }]);
      return;
    }
    const d = crearDialogo('<form id="form-generar" novalidate><h2 id="dlg-titulo">Generar cuotas</h2>' +
      '<div class="campo"><label for="g-curso">Curso</label><select class="entrada" id="g-curso">' +
      CURSOS.map(c => '<option value="' + esc(c.id) + '">' + esc(nombreCurso(c)) + '</option>').join('') + '</select></div>' +
      '<p id="dlg-texto">Se crearán la matrícula y las 10 mensualidades de los socios activos que aún no las tengan. Quien tenía la matrícula exenta sigue exento.</p>' +
      '<p class="msg" data-estado hidden></p>' +
      '<div class="botones-form"><button type="button" class="btn sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Generar cuotas</button></div></form>');
    d.setAttribute('aria-describedby', 'dlg-texto');
    const form = d.querySelector('form');
    form.querySelector('select').focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (form.getAttribute('aria-busy')) return;
      const curso = cursoDe(form.querySelector('select').value); // instantánea
      if (!curso) return;
      const n = await generar(form, curso.id, null);
      if (n == null) return;
      d.close();
      Admin.aviso(textoCuotas(n), 'ok');
      cargarLista(true);
    });
  }

  // ---------- Eventos ----------
  el('q').addEventListener('input', pintarLista);
  el('filtro').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filtro = b.dataset.f;
    el('filtro').querySelectorAll('.chip').forEach(c => { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    pintarLista();
  });
  el('lista').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) abrirFicha(b.dataset.id); });
  el('aviso-pend').addEventListener('click', e => { if (e.target.closest('[data-pendientes]')) Admin.abrir('vista-pendientes'); });
  el('pendientes').addEventListener('click', e => { const b = e.target.closest('[data-cuenta]'); if (b) abrirCrear(b.dataset.cuenta); });
  el('generar').addEventListener('click', abrirGenerar);

  // Interruptores (ficha y "Crear ficha")
  document.addEventListener('click', e => {
    const sw = e.target.closest('.perfil-switch[data-switch]');
    if (!sw || sw.disabled) return;
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    sw.querySelector('.perfil-switch-texto').textContent = on ? 'Sí' : 'No';
    if (sw.dataset.switch === 'fundador' && sw.form) prepararForm(sw.form);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-anadir]');
    if (b) { anadirPropia(b.dataset.anadir); el(b.dataset.anadir + '-propia').focus(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id && /^[fc]-propia$/.test(e.target.id)) { e.preventDefault(); anadirPropia(e.target.id[0]); }
  });
  // Al salir de los campos de redes se quitan @ y espacios, para que se vea cómo se guardará.
  document.addEventListener('focusout', e => {
    if (e.target.name === 'instagram' || e.target.name === 'tiktok') e.target.value = usuarioRed(e.target.value);
  });

  el('ficha').addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'form-ficha') guardarFicha(e.target);
  });
  el('ficha').addEventListener('click', e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-descartar]'))) descartar(b.form);
    else if ((b = t.closest('[data-activo]'))) cambiarActivo(b.form, b.dataset.activo === 'true');
    else if ((b = t.closest('[data-eliminar]'))) eliminar(b.form);
    else if ((b = t.closest('[data-generar]'))) generarDelSocio(b.form, b.dataset.generar);
    else if ((b = t.closest('#form-cuotas .tab'))) {
      ficha.curso = b.dataset.curso;
      reponer('form-cuotas', htmlCuotas());
      const nueva = document.querySelector('#form-cuotas .tab[aria-selected="true"]');
      if (nueva) nueva.focus();
    } else if ((b = t.closest('#form-cuotas [data-tipo]'))) abrirCuota(b);
  });
  el('ficha').addEventListener('change', e => { if (e.target.id === 'f-rol') cambiarRol(e.target); });
  el('form-crear').addEventListener('submit', e => { e.preventDefault(); crearFicha(e.currentTarget); });

  cargarLista();
})();
