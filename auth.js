// ACCESO DE SOCIOS (código común a todas las páginas)
// - Páginas privadas: llaman a Cueva.privada(). Sin sesión, redirige a acceso.html.
// - Páginas públicas: llevan <body data-acceso="publico">. Si hay sesión, se cambia la barra
//   inferior por la de socios y se muestra el avatar.
// Ocultar botones no protege nada: la seguridad real la dan las políticas de la base de datos.

const Cueva = (function () {
  // supabase-js con versión fijada. Si cambias la versión, cambia también el código de integridad.
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const LIB_SRI = 'sha256-WdOUh8NYmEO0EDItij1WLOAiq6HlzLFomO8/sqDaLs0=';
  // Lo único que se guarda en el dispositivo: la sesión y la inicial del nombre. Se borran al cerrar sesión.
  const CLAVE_SESION = 'cueva-sesion';
  const CLAVE_INICIAL = 'cueva-inicial';

  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Solo se aceptan enlaces http(s): evita que un dato mal escrito acabe ejecutando código.
  const urlSegura = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

  const leer = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const borrar = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const haySesionLocal = () => !!leer(CLAVE_SESION);

  // ---------- Cliente de Supabase (se descarga solo cuando hace falta) ----------
  let promesaCliente = null;
  function cliente() {
    if (!promesaCliente) {
      promesaCliente = new Promise((ok, mal) => {
        const crear = () => ok(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { storageKey: CLAVE_SESION, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        }));
        if (window.supabase && window.supabase.createClient) return crear();
        const s = document.createElement('script');
        s.src = LIB; s.integrity = LIB_SRI; s.crossOrigin = 'anonymous';
        s.onload = crear;
        s.onerror = () => { s.remove(); promesaCliente = null; mal({ red: true, message: 'No se pudo cargar supabase-js' }); };
        document.head.appendChild(s);
      });
    }
    return promesaCliente;
  }

  // ---------- Mensajes de carga y de error ----------
  const esErrorDeRed = e => !navigator.onLine || !!(e && (e.red || e.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed|network request failed/i.test(e.message || '')));
  const mensaje = e => esErrorDeRed(e)
    ? 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.'
    : 'No hemos podido cargar los datos. Inténtalo de nuevo dentro de un momento.';

  // Registro de errores en la consola SIN datos: solo un texto corto y el código del error. Nunca el objeto completo:
  // los errores de la base de datos traen en "details" (y a veces en "message") la fila entera, con datos personales.
  function registrar(texto, e) {
    const codigo = e && (e.code || e.status || e.statusCode || e.name);
    console.error(texto + (codigo ? ' (código: ' + codigo + ')' : ''));
  }

  function cargando(el, texto) {
    el.innerHTML = '<p class="empty cargando" role="status">' + esc(texto || 'Cargando…') + '</p>';
  }
  function error(el, e, reintentar) {
    registrar('No se han podido cargar los datos', e);
    el.innerHTML = '<div class="empty fallo" role="alert"><p>' + esc(mensaje(e)) + '</p>' + (reintentar ? '<button type="button" class="chip">Reintentar</button>' : '') + '</div>';
    if (reintentar) el.querySelector('button').addEventListener('click', reintentar);
  }
  // Pinta "Cargando…", lanza la consulta y pinta el resultado o el error (con botón de reintentar).
  function cargar(el, consulta, pintar) {
    cargando(el);
    Promise.resolve().then(consulta).then(r => {
      if (r.error) throw r.error;
      pintar(r.data || []);
    }).catch(e => error(el, e, () => cargar(el, consulta, pintar)));
  }

  // ---------- Avatar y barra inferior ----------
  const ICONOS = {
    inicio: '<path d="M4 21V11a8 8 0 0116 0v10M9 21v-6a3 3 0 016 0v6"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    curso: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v13"/>',
    biblioteca: '<path d="M5 3h4v18H5zM11 3h4v18h-4zM17 5l3.5 1-4 15-3.5-1z"/>',
    mas: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
  };
  const NAV_SOCIO = [['inicio', 'Inicio'], ['calendario', 'Calendario'], ['curso', 'Curso'], ['biblioteca', 'Biblioteca'], ['mas', 'Más']];
  // En las páginas públicas, la pestaña marcada para un socio es siempre "Más".
  const navSocio = () => NAV_SOCIO.map(([k, n]) =>
    '<a href="' + k + '.html"' + (k === 'mas' ? ' class="on" aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONOS[k] + '</svg>' + n + '</a>').join('');

  const inicialDe = nombre => (Array.from(String(nombre || '').trim())[0] || '').toLocaleUpperCase('es');
  function guardarInicial(nombre) {
    const i = inicialDe(nombre);
    if (i) guardar(CLAVE_INICIAL, i); else borrar(CLAVE_INICIAL);
    pintarAvatar();
  }
  // Solo cambia el texto (la inicial): si hay miniatura encima, se queda donde está y no parpadea.
  function pintarAvatar() {
    const inicial = leer(CLAVE_INICIAL) || '';
    document.querySelectorAll('.avatar').forEach(a => {
      [...a.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
      a.insertBefore(document.createTextNode(inicial), a.firstChild);
      if (miniAvatar) ponerMini(a, miniAvatar);
    });
  }

  // ---------- Miniatura de la foto (socios.foto_mini) ----------
  // Data URI JPEG de 128x128 que guarda la base de datos (mismas reglas que ella). Se asigna SIEMPRE con la propiedad
  // src de un <img> creado aquí, nunca con innerHTML. La del avatar de la barra vive solo en memoria (miniAvatar):
  // no se guarda en el dispositivo ni en caché. Si falta o algo falla, se ve la inicial que hay debajo.
  const MINI = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  const miniValida = t => typeof t === 'string' && t.length <= 14000 && MINI.test(t);
  let miniAvatar = null, miniFijada = false;
  function ponerMini(el, mini) {
    if (!el) return false;
    let img = [...el.children].find(n => n.classList.contains('foto-mini'));
    if (!miniValida(mini)) { if (img) img.remove(); return false; }
    if (!img) {
      img = document.createElement('img');
      img.className = 'foto-mini';
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', () => img.remove());
      el.classList.add('foto-circulo');
      el.appendChild(img);
    }
    if (img.getAttribute('src') !== mini) img.src = mini;
    return true;
  }
  // Cambia la miniatura del avatar de la barra (null = volver a la inicial). La usa "Mi perfil" al cambiar la foto.
  function avatarMini(mini) {
    miniFijada = true;
    miniAvatar = miniValida(mini) ? mini : null;
    document.querySelectorAll('.avatar').forEach(a => ponerMini(a, miniAvatar));
  }
  // Consulta pequeña de la propia ficha, sin esperarla: la página se pinta antes con la inicial.
  // Si falla (sin conexión, sin permiso, sin ficha) no se muestra nada: se queda la inicial.
  let miniPedida = false;
  function cargarMiniAvatar(sb, uid) {
    if (miniPedida || !uid) return;
    miniPedida = true;
    Promise.resolve().then(() => sb.from('socios').select('foto_mini').eq('id', uid).maybeSingle()).then(r => {
      if (miniFijada || r.error || !r.data || !miniValida(r.data.foto_mini)) return;
      miniAvatar = r.data.foto_mini;
      document.querySelectorAll('.avatar').forEach(a => ponerMini(a, miniAvatar));
    }).catch(() => {});
  }
  // El círculo de la inicial lleva a "Mi perfil". Las páginas lo traen como <div class="avatar">; aquí se cambia por
  // un enlace de verdad con los mismos atributos (así sigue oculto para los visitantes con data-solo="socio" hidden).
  function enlazarAvatares() {
    const enPerfil = (location.pathname.split('/').pop() || '') === 'perfil.html';
    document.querySelectorAll('div.avatar').forEach(d => {
      const a = document.createElement('a');
      for (const at of d.attributes) a.setAttribute(at.name, at.value);
      a.href = 'perfil.html';
      a.setAttribute('aria-label', 'Tu perfil');
      if (enPerfil) a.setAttribute('aria-current', 'page');
      a.textContent = d.textContent;
      d.replaceWith(a);
    });
  }

  let navVisitante = null;
  function pintarSesion(activa) {
    document.querySelectorAll('[data-solo]').forEach(el => { el.hidden = (el.dataset.solo === 'socio') !== activa; });
    pintarAvatar();
    const nav = document.querySelector('.nav');
    if (!nav || document.body.dataset.acceso !== 'publico') return;
    nav.classList.toggle('visitante', !activa);
    if (activa) {
      if (navVisitante === null) navVisitante = nav.innerHTML;
      nav.innerHTML = navSocio();
    } else if (navVisitante !== null) {
      nav.innerHTML = navVisitante;
    }
  }

  // ---------- Sesión ----------
  async function perfilActivo(sb, uid) {
    const r = await sb.from('perfiles').select('nombre,activo,rol').eq('id', uid).maybeSingle();
    if (r.error) throw Object.assign(r.error, { status: r.status });
    return r.data && r.data.activo === true ? r.data : null;
  }

  async function salir() {
    try { const sb = await cliente(); await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    borrar(CLAVE_SESION); borrar(CLAVE_INICIAL);
  }

  const nunca = () => new Promise(() => {});
  function irAcceso(motivo) {
    borrar(CLAVE_SESION); borrar(CLAVE_INICIAL);
    const pagina = location.pathname.split('/').pop() || '';
    location.replace('acceso.html?motivo=' + motivo + (pagina ? '&volver=' + encodeURIComponent(pagina) : ''));
    return nunca();
  }

  // Guardia de las páginas privadas. Devuelve { sb, perfil } o redirige a acceso.html.
  // Si falla la conexión lanza el error, para que la página lo muestre con "Reintentar".
  async function privada() {
    pintarAvatar();
    if (!haySesionLocal()) return irAcceso('privado');
    const sb = await cliente();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    if (!data.session) return irAcceso('privado');
    let perfil;
    try {
      perfil = await perfilActivo(sb, data.session.user.id);
    } catch (e) {
      if (e.status === 401) return irAcceso('privado');
      throw e;
    }
    if (!perfil) { await salir(); location.replace('acceso.html?motivo=inactiva'); return nunca(); }
    guardarInicial(perfil.nombre);
    cargarMiniAvatar(sb, data.session.user.id);
    return { sb, perfil };
  }

  // Guardia del panel de administración: como privada() (sesión y cuenta activa) y además exige rol = 'admin'.
  // Si el socio no es administrador, vuelve a inicio.html con un aviso.
  async function admin() {
    const r = await privada();
    if (r.perfil.rol !== 'admin') { location.replace('inicio.html?aviso=solo-admin'); return nunca(); }
    return r;
  }

  // ¿Es administrador el usuario de esta sesión? Se pregunta siempre a la base de datos
  // (nunca a un valor guardado en el dispositivo). Ante cualquier duda, responde false.
  async function esAdmin() {
    if (!haySesionLocal()) return false;
    try {
      const sb = await cliente();
      const { data } = await sb.auth.getSession();
      if (!data.session) return false;
      const perfil = await perfilActivo(sb, data.session.user.id);
      return !!perfil && perfil.rol === 'admin';
    } catch (e) { return false; }
  }

  // ---------- Avisos flotantes ----------
  // Mensaje que se cierra solo. tipo: '' (información), 'ok' o 'err'.
  function aviso(texto, tipo) {
    let caja = document.getElementById('avisos');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'avisos'; caja.className = 'avisos';
      document.body.appendChild(caja);
    }
    const p = document.createElement('p');
    p.className = 'toast' + (tipo ? ' ' + tipo : '');
    p.setAttribute('role', tipo === 'err' ? 'alert' : 'status');
    p.textContent = texto;
    caja.appendChild(p);
    setTimeout(() => p.remove(), tipo === 'err' ? 8000 : 4000);
  }
  // Avisos que llegan en la dirección (?aviso=código). Solo se aceptan códigos conocidos y se
  // muestra un texto fijo: nunca se pinta lo que venga en la URL.
  const AVISOS = { 'solo-admin': 'Esa sección es solo para administradores.' };
  function avisoDeLaUrl() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (!params.has('aviso')) return;
    const texto = AVISOS[params.get('aviso')];
    params.delete('aviso');
    const q = params.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (e) {}
    if (texto) aviso(texto, 'err');
  }

  // Páginas públicas: se adaptan al momento si hay sesión guardada y luego se comprueba que sigue viva.
  function publica() {
    if (!haySesionLocal()) return;
    pintarSesion(true);
    cliente().then(sb => sb.auth.getSession()).then(({ data, error }) => {
      if (!error && !data.session) { borrar(CLAVE_SESION); borrar(CLAVE_INICIAL); pintarSesion(false); return; }
      if (!error) return cliente().then(sb => cargarMiniAvatar(sb, data.session.user.id));
    }).catch(() => {});
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-accion="salir"]');
    if (!b) return;
    b.disabled = true;
    salir().then(() => location.replace('index.html'));
  });

  if (document.body) enlazarAvatares();
  if (document.body && document.body.dataset.acceso === 'publico') publica();
  if (document.body) avisoDeLaUrl();

  return { esc, urlSegura, cliente, haySesionLocal, privada, admin, esAdmin, aviso, perfilActivo, guardarInicial, salir, esErrorDeRed, mensaje, registrar, cargando, error, cargar,
    miniValida, ponerMini, avatarMini };
})();

// INTERFAZ DEL MÓVIL (todas las páginas): aviso "Gira el móvil" y "arrastrar para refrescar" en la app instalada.
// Solo cambia la interfaz: no lee ni escribe datos.
(function () {
  if (!document.body) return;

  // ---------- A) Aviso "Gira el móvil" ----------
  // Solo en teléfonos en horizontal. Se decide por la PANTALLA, nunca por la ventana: con el teclado abierto
  // en vertical la ventana se encoge (y parece horizontal), pero la pantalla no cambia.
  // Teléfono = pantalla táctil con el lado menor por debajo de 600 px. Si el navegador no da las medidas
  // de la pantalla (0 o vacías, como en algunas vistas incrustadas), no se considera teléfono.
  const tactil = () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const esTelefono = () => { const l = Math.min(screen.width, screen.height); return l > 0 && l < 600 && tactil(); };
  function horizontal() {
    const o = screen.orientation && screen.orientation.type;
    if (o) return o.indexOf('landscape') === 0;
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
    return screen.width > screen.height;
  }
  const raiz = document.documentElement;
  const gira = document.createElement('div');
  gira.className = 'gira';
  gira.tabIndex = -1;
  gira.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="6" width="24" height="40" rx="4"/><path d="M29 40h6"/>' +
    '<path d="M50 30a18 18 0 01-14 22"/><path d="M40 47l-4 5 6 2"/></svg><div role="alert"></div>';
  document.body.appendChild(gira);
  const texto = gira.querySelector('[role="alert"]');
  // Mientras se ve, html.girado oculta (visibility) todo lo demás del body: no se puede tocar, ni llegar con el
  // teclado, ni leer con el lector de pantalla. También bloquea el scroll del fondo.
  function comprobarGiro() {
    const si = esTelefono() && horizontal();
    if (si === raiz.classList.contains('girado')) return;
    raiz.classList.toggle('girado', si);
    if (si) {
      texto.innerHTML = '<p class="gira-titulo">Gira el móvil</p><p>La Cueva del Narrador se usa en vertical.</p>';
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      gira.focus({ preventScroll: true });
    } else {
      texto.textContent = '';
    }
  }
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', comprobarGiro);
  window.addEventListener('orientationchange', comprobarGiro);
  window.addEventListener('resize', comprobarGiro);
  comprobarGiro();

  // ---------- B) Arrastrar para refrescar (solo en la app instalada) ----------
  // En el navegador normal ya existe el gesto nativo, así que aquí no se hace nada.
  const instalada = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (instalada()) raiz.classList.add('instalada');
  const UMBRAL = 70, MAXIMO = 100, PAUSA = 2000, CLAVE = 'cueva-recarga';
  // Resistencia: hasta el umbral la píldora sigue casi al dedo (y queda entera a la vista); después, cada vez menos.
  const recorrido = dy => Math.min(dy <= UMBRAL ? dy * 0.9 : UMBRAL * 0.9 + (dy - UMBRAL) * 0.3, MAXIMO);
  const ind = document.createElement('div');
  ind.className = 'tirar';
  ind.setAttribute('role', 'status');
  ind.innerHTML = '<span class="tirar-giro" aria-hidden="true"></span><span class="tirar-texto"></span>';
  document.body.appendChild(ind);
  const indTexto = ind.querySelector('.tirar-texto');
  let gesto = null, recargando = false;

  const ultimaRecarga = () => { try { return +sessionStorage.getItem(CLAVE) || 0; } catch (e) { return 0; } };
  const visible = el => !el.closest('[hidden]') && el.getClientRects().length > 0;
  const arriba = () => window.scrollY <= 0 && (document.scrollingElement || raiz).scrollTop <= 0;
  const campo = el => el && el.closest && el.closest('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]');
  // ¿Hay algo que impida el gesto en toda la página? (formulario del panel abierto, diálogo, guardando, aviso de giro)
  const pagina = () => raiz.classList.contains('girado') || document.querySelector('dialog[open], [aria-busy="true"]') ||
    [...document.querySelectorAll('form.formulario')].some(visible) || campo(document.activeElement);
  // ¿Empezó el dedo en un sitio donde no debe activarse? (campos; calendario, estanterías, chips y pestañas aunque
  // ahora no desborden; cualquier otra cosa que se desplace en horizontal; o contenedores desplazados hacia abajo)
  function origen(el) {
    if (campo(el) || el.closest('.cal, .shelf, .chips, .tabs')) return true;
    for (let n = el; n && n !== document.body && n !== raiz; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true;
    }
    return false;
  }
  function pintarInd(dist, listo) {
    ind.classList.add('activo');
    ind.style.transform = 'translate(-50%,' + (dist - 56) + 'px)';
    const t = listo ? 'Suelta para actualizar' : 'Arrastra para actualizar';
    if (indTexto.textContent !== t) indTexto.textContent = t;
  }
  function soltar() {
    gesto = null;
    ind.classList.remove('activo', 'cargando');
    ind.style.transform = '';
    indTexto.textContent = '';
  }

  document.addEventListener('touchstart', e => {
    gesto = null;
    if (recargando || e.touches.length !== 1 || !instalada()) return;
    if (Date.now() - ultimaRecarga() < PAUSA || !arriba() || pagina() || origen(e.target)) return;
    const t = e.touches[0];
    gesto = { x: t.clientX, y: t.clientY, dy: 0, decidido: false };
    raiz.classList.add('instalada');
  }, { passive: true });

  // No pasivo: solo se llama a preventDefault cuando ya está claro que es un arrastre hacia abajo desde arriba del todo.
  document.addEventListener('touchmove', e => {
    if (!gesto) return;
    if (e.touches.length !== 1) { soltar(); return; }
    const t = e.touches[0], dx = t.clientX - gesto.x, dy = t.clientY - gesto.y;
    if (!gesto.decidido) {
      if (dy < -5 || (Math.abs(dx) > 10 && Math.abs(dx) >= dy)) { gesto = null; return; } // hacia arriba o de lado: scroll normal
      if (dy <= 10 || dy <= Math.abs(dx)) return;
      if (!arriba()) { gesto = null; return; }
      gesto.decidido = true;
    }
    if (e.cancelable) e.preventDefault();
    gesto.dy = dy;
    pintarInd(recorrido(dy), dy >= UMBRAL);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!gesto) return;
    const listo = gesto.decidido && gesto.dy >= UMBRAL;
    if (!listo) { soltar(); return; }
    gesto = null;
    recargando = true;
    ind.classList.add('cargando');
    ind.style.transform = 'translate(-50%,' + (recorrido(UMBRAL) - 56) + 'px)';
    indTexto.textContent = 'Actualizando…';
    try { sessionStorage.setItem(CLAVE, String(Date.now())); } catch (e) {}
    location.reload();
  });
  document.addEventListener('touchcancel', () => { if (gesto) soltar(); });
})();
