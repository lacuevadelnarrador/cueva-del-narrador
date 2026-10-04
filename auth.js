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

  function cargando(el, texto) {
    el.innerHTML = '<p class="empty cargando" role="status">' + esc(texto || 'Cargando…') + '</p>';
  }
  function error(el, e, reintentar) {
    console.error(e);
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
  function pintarAvatar() {
    document.querySelectorAll('.avatar').forEach(a => { a.textContent = leer(CLAVE_INICIAL) || ''; });
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
      if (!error && !data.session) { borrar(CLAVE_SESION); borrar(CLAVE_INICIAL); pintarSesion(false); }
    }).catch(() => {});
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-accion="salir"]');
    if (!b) return;
    b.disabled = true;
    salir().then(() => location.replace('index.html'));
  });

  if (document.body && document.body.dataset.acceso === 'publico') publica();
  if (document.body) avisoDeLaUrl();

  return { esc, urlSegura, cliente, haySesionLocal, privada, admin, esAdmin, aviso, perfilActivo, guardarInicial, salir, esErrorDeRed, mensaje, cargando, error, cargar };
})();
