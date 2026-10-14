// CAMPANA DE AVISOS (inicio, calendario, curso, biblioteca, perfil y "Más")
// - Páginas privadas: se crea cuando la guardia (Cueva.privada) ha terminado bien (Cueva.alEntrar).
// - "Más" es pública: solo se crea si hay sesión y la cuenta está activa (Cueva.sesionActiva). Sin sesión no se crea
//   nada ni se consulta nada.
// - Solo lee y marca como leídos los avisos del propio socio: las políticas (RLS) de la tabla avisos no dejan ver los
//   ajenos (tampoco a un administrador) y solo dejan cambiar la columna "leido".
// - Consultas: el contador al cargar la página; la lista (30 últimos) al abrir el panel. Al volver a primer plano se
//   refresca como mucho una vez por minuto. Nada se guarda en el dispositivo.
// - Los textos se pintan siempre con textContent. Solo se navega a enlaces internos del tipo "pagina.html".

(function () {
  if (!document.body || typeof Cueva !== 'object') return;
  const ENLACE = /^[a-z0-9-]+\.html$/;
  const REFRESCO = 60000;
  const MAXIMO = 30;
  const ESCRITORIO = '(min-width: 600px)';
  const ICONO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16z"/><path d="M10 21h4"/></svg>';
  const CERRAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  let sb = null, boton = null, insignia = null, panel = null, cuerpo = null, msg = null, todas = null;
  let noLeidos = 0, avisos = null, ultima = 0, ocupado = false;

  // ---------- Fechas (día de Madrid, como el resto de la app) ----------
  const diaMadrid = d => {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  };
  const ayerDe = f => { const [a, m, d] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10); };
  function cuando(creado) {
    const d = new Date(creado);
    if (isNaN(d)) return '';
    const f = diaMadrid(d), hoy = diaMadrid(new Date());
    if (f === hoy) return 'Hoy';
    if (f === ayerDe(hoy)) return 'Ayer';
    return f.slice(8, 10) + '/' + f.slice(5, 7);
  }

  // ---------- Botón e insignia ----------
  function crearBoton() {
    const avatar = document.querySelector('.top .avatar');
    if (!avatar) return false;
    const grupo = document.createElement('div');
    grupo.className = 'campana-grupo';
    avatar.replaceWith(grupo);
    boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'campana';
    boton.setAttribute('aria-haspopup', 'dialog');
    boton.innerHTML = ICONO + '<span class="campana-insignia" aria-hidden="true" hidden></span>';
    insignia = boton.querySelector('.campana-insignia');
    grupo.append(boton, avatar);
    boton.addEventListener('click', abrir);
    pintarInsignia(0);
    return true;
  }
  function pintarInsignia(n) {
    noLeidos = Math.max(0, n | 0);
    insignia.textContent = noLeidos > 9 ? '9+' : String(noLeidos);
    insignia.hidden = noLeidos === 0;
    boton.setAttribute('aria-label', noLeidos ? 'Avisos, ' + noLeidos + ' sin leer' : 'Avisos');
    if (todas) todas.disabled = noLeidos === 0 || ocupado;
  }

  // ---------- Consultas ----------
  async function contar() {
    const r = await sb.from('avisos').select('id', { count: 'exact', head: true }).eq('leido', false);
    if (r.error) throw r.error;
    pintarInsignia(r.count || 0);
  }
  function refrescar() {
    ultima = Date.now();
    contar().catch(e => Cueva.registrar('No se ha podido comprobar los avisos', e));
    // La lista se vuelve a pedir al abrir el panel (o ahora, si está abierto y no se está guardando nada)
    if (panel && panel.open) { if (!ocupado) cargarLista(); } else avisos = null;
  }
  function cargarLista() {
    mensaje('');
    Cueva.cargar(cuerpo,
      () => sb.from('avisos').select('id,tipo,titulo,texto,enlace,leido,creado').order('creado', { ascending: false }).limit(MAXIMO),
      d => { avisos = d; pintarLista(); });
  }

  // ---------- Panel ----------
  function crearPanel() {
    panel = document.createElement('dialog');
    panel.className = 'campana-panel';
    panel.setAttribute('aria-labelledby', 'campana-titulo');
    panel.innerHTML = '<div class="campana-cab"><h2 id="campana-titulo">Avisos</h2>' +
      '<button type="button" class="campana-cerrar" aria-label="Cerrar">' + CERRAR + '</button></div>' +
      '<p class="campana-msg" role="alert"></p>' +
      '<div class="campana-cuerpo"></div>' +
      '<div class="campana-pie"><button type="button" class="btn sec campana-todas">Marcar todas como leídas</button></div>';
    document.body.appendChild(panel);
    cuerpo = panel.querySelector('.campana-cuerpo');
    msg = panel.querySelector('.campana-msg');
    todas = panel.querySelector('.campana-todas');
    panel.querySelector('.campana-cerrar').addEventListener('click', cerrar);
    todas.addEventListener('click', marcarTodas);
    // Escape: se cierra en el acto, sin esperar al evento "close" (puede retrasarse con la página en segundo plano)
    panel.addEventListener('cancel', e => { e.preventDefault(); cerrar(); });
    panel.addEventListener('close', alCerrar);
    panel.addEventListener('click', e => {
      if (e.target === panel) { cerrar(); return; } // pulsar fuera (en el fondo) cierra
      const b = e.target.closest('.campana-aviso');
      if (b) abrirAviso(b);
    });
  }
  function colocar() {
    // Escritorio: desplegable bajo la campana. Móvil: hoja inferior (lo hace el CSS).
    if (!window.matchMedia || !matchMedia(ESCRITORIO).matches) { panel.style.removeProperty('--campana-top'); panel.style.removeProperty('--campana-izq'); return; }
    const r = boton.getBoundingClientRect(), ancho = Math.min(360, window.innerWidth - 32);
    const izq = Math.max(16, Math.min(r.right - ancho, window.innerWidth - ancho - 16));
    panel.style.setProperty('--campana-top', Math.round(r.bottom + 8) + 'px');
    panel.style.setProperty('--campana-izq', Math.round(izq) + 'px');
  }
  function abrir() {
    if (!panel) crearPanel();
    if (panel.open) return;
    colocar();
    mensaje('');
    todas.disabled = noLeidos === 0;
    panel.showModal();
    boton.setAttribute('aria-expanded', 'true');
    panel.querySelector('.campana-cerrar').focus();
    if (avisos) pintarLista(); else cargarLista();
  }
  let cerrando = false;
  function cerrar() {
    if (cerrando) return;
    cerrando = true;
    if (panel.open) panel.close();
    alCerrar();
    cerrando = false;
  }
  function alCerrar() {
    if (boton.getAttribute('aria-expanded') !== 'true') return;
    boton.setAttribute('aria-expanded', 'false');
    if (boton.isConnected) boton.focus({ preventScroll: true });
  }
  window.addEventListener('resize', () => { if (panel && panel.open) colocar(); });

  function mensaje(t) { if (msg) msg.textContent = t; }

  function pintarLista() {
    cuerpo.textContent = '';
    if (!avisos.length) {
      const p = document.createElement('p');
      p.className = 'empty campana-vacio';
      p.textContent = 'No tienes avisos';
      cuerpo.appendChild(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'campana-lista';
    avisos.forEach(a => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'campana-aviso' + (a.leido ? '' : ' nuevo');
      b.dataset.id = String(a.id);
      b.innerHTML = '<span class="campana-punto" aria-hidden="true"></span><span class="campana-tx">' +
        '<span class="perfil-sr campana-sr"></span><b class="campana-at"></b><span class="campana-texto"></span><small class="campana-fecha"></small></span>';
      b.querySelector('.campana-sr').textContent = a.leido ? '' : 'Sin leer: ';
      b.querySelector('.campana-at').textContent = a.titulo || '';
      const tx = b.querySelector('.campana-texto');
      if (a.texto) tx.textContent = a.texto; else tx.remove();
      b.querySelector('.campana-fecha').textContent = cuando(a.creado);
      li.appendChild(b);
      ul.appendChild(li);
    });
    cuerpo.appendChild(ul);
  }

  // ---------- Marcar como leídos ----------
  const MENSAJE_MARCAR = 'No se ha podido marcar como leído. Inténtalo de nuevo dentro de un momento.';
  const mensajeMarcar = e => Cueva.esErrorDeRed(e) ? 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.' : MENSAJE_MARCAR;
  function ocupar(si) {
    ocupado = si;
    if (si) panel.setAttribute('aria-busy', 'true'); else panel.removeAttribute('aria-busy');
    panel.querySelectorAll('.campana-aviso').forEach(b => { b.disabled = si; });
    todas.disabled = si || noLeidos === 0;
  }
  async function abrirAviso(b) {
    if (ocupado || !avisos) return;
    const a = avisos.find(x => String(x.id) === b.dataset.id);
    if (!a) return;
    const destino = typeof a.enlace === 'string' && ENLACE.test(a.enlace) ? a.enlace : null;
    if (!a.leido) {
      mensaje('');
      ocupar(true);
      try {
        const r = await sb.from('avisos').update({ leido: true }).eq('id', a.id).select('id');
        if (r.error) throw r.error;
        if (!Array.isArray(r.data) || r.data.length !== 1) throw { sinFilas: true };
      } catch (e) {
        Cueva.registrar('No se ha podido marcar el aviso como leído', e);
        ocupar(false);
        mensaje(mensajeMarcar(e));
        b.focus();
        return;
      }
      ocupar(false);
      a.leido = true;
      b.classList.remove('nuevo');
      b.querySelector('.campana-sr').textContent = '';
      pintarInsignia(noLeidos - 1);
    }
    if (destino) location.href = destino;
  }
  async function marcarTodas() {
    if (ocupado || noLeidos === 0) return;
    mensaje('');
    ocupar(true);
    let filas;
    try {
      const r = await sb.from('avisos').update({ leido: true }).eq('leido', false).select('id');
      if (r.error) throw r.error;
      filas = Array.isArray(r.data) ? r.data : [];
      if (!filas.length) throw { sinFilas: true };
    } catch (e) {
      Cueva.registrar('No se han podido marcar los avisos como leídos', e);
      ocupar(false);
      mensaje(e && e.sinFilas ? 'No se ha podido marcar ningún aviso como leído. Inténtalo de nuevo dentro de un momento.' : mensajeMarcar(e));
      todas.focus();
      return;
    }
    const ids = new Set(filas.map(f => String(f.id)));
    (avisos || []).forEach(a => { if (ids.has(String(a.id))) a.leido = true; });
    ocupado = false;
    panel.removeAttribute('aria-busy');
    pintarInsignia(noLeidos - filas.length);
    if (avisos) pintarLista();
    panel.querySelector('.campana-cerrar').focus();
  }

  // ---------- Arranque ----------
  function iniciar(cliente) {
    if (sb || !cliente) return;
    sb = cliente;
    if (!crearBoton()) return;
    refrescar();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima >= REFRESCO) refrescar();
    });
  }

  if (document.body.dataset.acceso === 'publico') {
    if (!Cueva.haySesionLocal()) return;
    Cueva.sesionActiva().then(r => { if (r) iniciar(r.sb); });
  } else {
    Cueva.alEntrar(iniciar);
  }
})();
