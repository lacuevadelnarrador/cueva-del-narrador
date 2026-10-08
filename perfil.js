// MI PERFIL (perfil.html): datos del socio, inscripción, cuotas y asistencia.
// - Solo se leen las filas del propio socio: las políticas (RLS) de la base de datos no dejan ver otras.
// - Al guardar se envían SOLO los campos que el socio puede editar (EDITABLES). Los protegidos (código, consentimientos,
//   fecha de inscripción, fundador) nunca salen de aquí; si llegaran, la base de datos los rechazaría igualmente.
// - Todo lo que viene de la base de datos se escapa antes de pintarlo. No se escribe nada del perfil en la consola
//   ni en el dispositivo (solo la inicial del avatar, como en el resto de páginas).
(function () {
  const esc = Cueva.esc;
  const CONTACTO = 'lacuevadelnarrador@gmail.com';
  const COLUMNAS = 'id,codigo,nombre_completo,nombre_pila,edad,telefono,instagram,tiktok,foto_url,generos_favoritos,motivacion,' +
    'como_nos_conocio,libro_publicado,rgpd_imagen,rgpd_publicaciones,fecha_inscripcion,fundador';
  // codigo solo se lee (para el carné): no está en EDITABLES.
  // foto_url y foto_mini también son editables, pero la foto se guarda aparte (fotos.js): este formulario nunca las envía.
  const EDITABLES = ['nombre_completo', 'nombre_pila', 'edad', 'telefono', 'instagram', 'tiktok', 'generos_favoritos', 'motivacion', 'como_nos_conocio', 'libro_publicado'];
  const MOTIVOS = ['Terminar proyectos', 'Publicar', 'Mejora general', 'Falta de ideas', 'Síndrome del impostor', 'Ortografía', 'Maquetación', 'Crear obras largas', 'Falta de motivación'];
  const CONOCIO = ['Instagram', 'TikTok', 'Boca a boca', 'Cartel en librería', 'Otro'];
  const MAX_LISTA = 20, MAX_PROPIA = 40, MAX_CONOCIO = 120, MAX_RED = 60;
  // Mismas reglas que la base de datos: solo dígitos y espacios, con un + opcional al principio, de 6 a 20 caracteres.
  const TELEFONO = /^\+?[0-9 ]+$/;
  const USUARIO_RED = /^[A-Za-z0-9._]+$/;

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_CURSO = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

  const ICONOS = {
    persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    ficha: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    cuotas: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    asistencia: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>',
    si: '<path d="M5 12l5 5 9-10"/>',
    no: '<path d="M6 6l12 12M18 6L6 18"/>',
    reloj: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    guion: '<path d="M7 12h10"/>',
    lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    correo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    admin: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    salir: '<path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    carne: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.5 1.7-2.3 3-2.3s2.4.8 3 2.3M14 10h4M14 14h4"/>',
    bajar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    compartir: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
    camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  const ic = (k, cls) => '<svg class="perfil-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONOS[k] + '</svg>';
  const ESTADOS_CUOTA = {
    pagada: { n: 'Pagada', p: 'Pagadas', i: 'si' },
    pendiente: { n: 'Pendiente', p: 'Pendientes', i: 'reloj' },
    exenta: { n: 'Exenta', p: 'Exentas', i: 'guion' }
  };

  // ---------- Utilidades ----------
  const dos = n => String(n).padStart(2, '0');
  const partes = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? { a: +m[1], m: +m[2], d: +m[3] } : null; };
  const fechaLarga = f => { const p = partes(f); return p ? p.d + ' de ' + MESES[p.m - 1] + ' de ' + p.a : ''; };
  const mesAnio = f => { const p = partes(f); return p ? MESES[p.m - 1] + ' de ' + p.a : ''; };
  const fechaCorta = f => { const p = partes(f); return p ? dos(p.d) + '/' + dos(p.m) + '/' + p.a : ''; };
  const mesActual = () => { const d = new Date(); return d.getFullYear() + '-' + dos(d.getMonth() + 1); };
  const lista = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
  const unicos = arr => arr.filter((x, i) => arr.indexOf(x) === i);
  const largo = t => Array.from(String(t || '')).length;
  // Usuario de Instagram/TikTok: sin @ ni espacios, aunque el socio los escriba.
  const usuarioRed = v => String(v || '').replace(/[@\s]/g, '');
  const inicialDe = t => (Array.from(String(t || '').trim())[0] || '').toLocaleUpperCase('es');
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const compararCursos = (a, b) => String(b.codigo || '').localeCompare(String(a.codigo || ''), 'es', { numeric: true }) || (+b.id || 0) - (+a.id || 0);

  // ---------- Estado ----------
  let sb = null, uid = null, correo = '', esAdmin = false, nombreCuenta = '';
  let socio = null, generos = [], cursos = [], cuotas = [], asistencia = [];
  let cursoCuotas = null, editando = false, guardando = false;

  const contenido = document.getElementById('perfil-contenido');
  const titulo = document.getElementById('perfil-nombre');
  const foto = document.getElementById('perfil-foto');
  const pastillas = document.getElementById('perfil-pastillas');
  const fotoAcciones = document.getElementById('foto-acciones');
  const fotoCambiar = document.getElementById('foto-cambiar');
  const fotoQuitar = document.getElementById('foto-quitar');
  // Foto grande que se está mostrando (solo en memoria): ruta y su blob: (se libera al cambiarla o quitarla).
  // promesa: la descarga en curso (el carné la aprovecha en vez de descargar la foto otra vez).
  let fotoVista = { ruta: '', url: null, cargando: false, promesa: null }, fotoTurno = 0;

  // ---------- Botón "volver" ----------
  // Si se llegó desde otra página de la web, vuelve a ella; si no (enlace directo), va al inicio.
  document.getElementById('volver').addEventListener('click', e => {
    let deAqui = false;
    try { deAqui = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch (err) {}
    if (deAqui) { e.preventDefault(); history.back(); }
  });

  // ---------- Carga ----------
  function cargar() {
    Cueva.cargando(contenido, 'Cargando tu perfil…');
    Cueva.privada().then(async r => {
      sb = r.sb;
      esAdmin = r.perfil.rol === 'admin';
      nombreCuenta = r.perfil.nombre || '';
      const ses = await sb.auth.getSession();
      if (ses.error) throw ses.error;
      if (!ses.data.session) { location.replace('acceso.html?motivo=privado&volver=perfil.html'); return; }
      uid = ses.data.session.user.id;
      correo = ses.data.session.user.email || '';
      if (!correo) {
        const p = await sb.from('perfiles').select('email').eq('id', uid).maybeSingle();
        if (p.error) throw p.error;
        correo = (p.data && p.data.email) || '';
      }
      const s = await sb.from('socios').select(COLUMNAS).eq('id', uid).maybeSingle();
      if (s.error) throw s.error;
      if (!s.data) { socio = null; pintarSinFicha(); return; }
      const [cu, cs, as, ge] = await Promise.all([
        sb.from('cuotas').select('curso_id,tipo,mes,estado').eq('socio_id', uid),
        sb.from('cursos').select('id,codigo,nombre,periodo'),
        sb.from('asistencia').select('evento_id,asistio').eq('socio_id', uid),
        sb.from('generos').select('nombre').order('nombre')
      ]);
      const fallo = cu.error || cs.error || as.error || ge.error;
      if (fallo) throw fallo;
      const ids = unicos((as.data || []).map(a => a.evento_id).filter(x => x != null));
      let eventos = [];
      if (ids.length) {
        const ev = await sb.from('eventos').select('id,fecha,titulo,tipo').in('id', ids);
        if (ev.error) throw ev.error;
        eventos = ev.data || [];
      }
      socio = s.data;
      cuotas = cu.data || [];
      cursos = cs.data || [];
      generos = (ge.data || []).map(g => g.nombre).filter(Boolean);
      asistencia = (as.data || []).map(a => Object.assign({ evento: eventos.find(e => String(e.id) === String(a.evento_id)) || null }, a));
      cursoCuotas = null;
      pintarTodo();
    }).catch(e => Cueva.error(contenido, e, cargar));
  }

  // ---------- Cabecera ----------
  function pintarCabecera() {
    const nombre = socio ? (socio.nombre_completo || socio.nombre_pila || 'Mi perfil') : 'Mi perfil';
    titulo.textContent = nombre;
    document.title = 'Mi perfil · La Cueva del Narrador';
    const inicial = inicialDe(socio ? (socio.nombre_pila || socio.nombre_completo) : nombreCuenta);
    pintarFoto(inicial);
    document.querySelector('.perfil-eyebrow').hidden = !socio;
    const ps = [];
    if (socio) {
      if (socio.fundador) ps.push('<li class="perfil-pastilla fundador">' + ic('si') + 'Fundador/a</li>');
      if (socio.fecha_inscripcion) ps.push('<li class="perfil-pastilla">Socio/a desde ' + esc(mesAnio(socio.fecha_inscripcion)) + '</li>');
      const c = cursosConCuotas()[0];
      if (c) ps.push('<li class="perfil-pastilla">Curso ' + esc(c.codigo || c.nombre || '') + '</li>');
    }
    pastillas.innerHTML = ps.join('');
    pastillas.hidden = !ps.length;
  }

  // ---------- Foto (avatar grande) ----------
  // Mientras carga, o si no hay foto o falla, se ve la inicial. La foto se descarga con la sesión (Fotos.cargar).
  function ponerInicial(inicial) {
    foto.textContent = inicial;
    foto.setAttribute('aria-hidden', 'true');
    foto.classList.toggle('vacio', !inicial);
  }
  function ponerImagen(url, inicial) {
    const img = document.createElement('img');
    img.alt = 'Tu foto de perfil';
    img.addEventListener('error', () => ponerInicial(inicial));
    img.src = url;
    foto.textContent = '';
    foto.appendChild(img);
    foto.removeAttribute('aria-hidden');
    foto.classList.remove('vacio');
  }
  function pintarFoto(inicial) {
    const ruta = socio && typeof socio.foto_url === 'string' ? socio.foto_url : '';
    pintarBotonesFoto(!!ruta);
    if (ruta && fotoVista.ruta === ruta && fotoVista.url) { ponerImagen(fotoVista.url, inicial); return; }
    ponerInicial(inicial);
    if (ruta && fotoVista.ruta === ruta && fotoVista.cargando) return; // ya se está descargando
    Fotos.liberar(fotoVista.url);
    fotoVista = { ruta, url: null, cargando: !!ruta, promesa: null };
    if (!ruta) return;
    const turno = ++fotoTurno;
    fotoVista.promesa = Fotos.cargar(ruta).then(url => {
      if (turno !== fotoTurno || !socio || socio.foto_url !== ruta) { Fotos.liberar(url); return; }
      fotoVista = { ruta, url, cargando: false, promesa: null };
      if (url) ponerImagen(url, inicialDe(socio.nombre_pila || socio.nombre_completo));
    });
  }
  function pintarBotonesFoto(hay) {
    fotoAcciones.hidden = !socio;
    document.getElementById('foto-cambiar-tx').textContent = hay ? 'Cambiar foto' : 'Añadir foto';
    fotoQuitar.hidden = !hay;
  }
  // Tras cambiar o quitar la foto: cabecera y círculo de la barra (con la miniatura nueva, o la inicial).
  function fotoCambiada(fila) {
    if (!socio || !fila || fila.id !== socio.id) return;
    socio.foto_url = fila.foto_url || null;
    Cueva.avatarMini(fila.foto_mini || null);
    pintarCabecera();
    refrescarCarne();
  }
  function cambiarFoto(foco) {
    if (!socio || Fotos.ocupado()) return;
    Fotos.cambiar({ socioId: socio.id, rutaAnterior: socio.foto_url || null, aviso: !socio.foto_url, foco, alGuardar: fotoCambiada });
  }
  fotoCambiar.addEventListener('click', () => cambiarFoto('foto-cambiar'));
  fotoQuitar.addEventListener('click', () => {
    if (!socio || !socio.foto_url || Fotos.ocupado()) return;
    Fotos.quitar({ socioId: socio.id, ruta: socio.foto_url, foco: 'foto-cambiar', alQuitar: fotoCambiada });
  });
  window.addEventListener('pagehide', () => { Fotos.liberar(fotoVista.url); fotoVista = { ruta: '', url: null, cargando: false, promesa: null }; liberarCarne(); });
  window.addEventListener('pageshow', e => { if (e.persisted && socio) { pintarCabecera(); observarCarne(); } });

  // ---------- Tarjetas ----------
  const tarjeta = (i, id, icono, tituloT, cuerpo) =>
    '<section class="perfil-tarjeta" style="--i:' + i + '" aria-labelledby="t-' + id + '" id="perfil-' + id + '">' +
    '<h2 id="t-' + id + '"><span class="perfil-tarjeta-ic">' + ic(icono) + '</span>' + esc(tituloT) + '</h2>' + cuerpo + '</section>';

  function pintarTodo() {
    pintarCabecera();
    Cueva.guardarInicial(socio.nombre_pila || socio.nombre_completo);
    contenido.innerHTML =
      tarjeta(0, 'datos', 'persona', 'Tus datos',
        '<div id="perfil-vista">' + htmlVista() + '</div>' +
        '<form class="formulario perfil-form" id="perfil-form" novalidate hidden></form>') +
      tarjeta(1, 'inscripcion', 'ficha', 'Tu inscripción', htmlInscripcion()) +
      (window.Carne ? tarjeta(2, 'carne', 'carne', 'Mi carné', htmlCarne()) : '') +
      tarjeta(3, 'cuotas', 'cuotas', 'Mis cuotas', '<div id="perfil-cuotas-cuerpo">' + htmlCuotas() + '</div>') +
      tarjeta(4, 'asistencia', 'asistencia', 'Mi asistencia', htmlAsistencia()) +
      htmlFinal(5);
    observarCarne();
  }

  function pintarSinFicha() {
    liberarCarne();
    pintarCabecera();
    contenido.innerHTML =
      '<section class="perfil-tarjeta perfil-sin-ficha" style="--i:0" aria-labelledby="t-sin-ficha">' +
      '<h2 id="t-sin-ficha"><span class="perfil-tarjeta-ic">' + ic('persona') + '</span>Sin ficha de socio</h2>' +
      '<p>Tu cuenta aún no tiene ficha de socio. Escríbenos.</p>' +
      '<p><a class="btn" href="mailto:' + CONTACTO + '" rel="noopener noreferrer">' + ic('correo') + CONTACTO + '</a></p>' +
      (esAdmin ? '<a class="item admin" href="admin.html"><span class="ic">' + ic('admin') + '</span><span class="tx"><b>Administración</b><small>Gestiona eventos, retos, charlas y publicaciones.</small></span></a>' : '') +
      '</section>' + htmlFinal(1);
  }

  function htmlFinal(i) {
    return '<div class="menu perfil-final" style="--i:' + i + '">' +
      '<a class="item" href="privacidad.html"><span class="ic">' + ic('escudo') + '</span><span class="tx"><b>Privacidad</b><small>Qué datos guardamos y para qué.</small></span></a>' +
      '<button class="item" type="button" data-accion="salir"><span class="ic">' + ic('salir') + '</span><span class="tx"><b>Cerrar sesión</b><small>En este dispositivo o en todos.</small></span></button>' +
      '</div>';
  }

  // a) Tus datos (lectura)
  const vacio = '<span class="perfil-vacio">Sin indicar</span>';
  const valor = v => v == null || v === '' ? vacio : esc(v);
  const dato = (et, html) => '<div class="perfil-dato"><dt>' + esc(et) + '</dt><dd>' + html + '</dd></div>';
  const etiquetasLectura = arr => arr.length ? '<ul class="perfil-etiquetas">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : vacio;
  function enlaceRed(red, u) {
    if (!u) return vacio;
    if (!USUARIO_RED.test(u)) return esc('@' + u);
    const url = red === 'instagram' ? 'https://www.instagram.com/' + encodeURIComponent(u) + '/' : 'https://www.tiktok.com/@' + encodeURIComponent(u);
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">@' + esc(u) +
      '<span class="perfil-sr"> (perfil de ' + (red === 'instagram' ? 'Instagram' : 'TikTok') + ', se abre en otra pestaña)</span></a>';
  }
  function htmlVista() {
    const s = socio;
    return '<dl class="perfil-datos">' +
      dato('Nombre y apellidos', valor(s.nombre_completo)) +
      dato('Nombre de pila', valor(s.nombre_pila)) +
      dato('Edad', s.edad == null ? vacio : esc(plural(s.edad, 'año', 'años'))) +
      dato('Teléfono', valor(s.telefono)) +
      dato('Correo de acceso', '<span class="perfil-correo">' + valor(correo) + '</span><small class="perfil-nota">Para cambiarlo, <a href="mailto:' + CONTACTO + '" rel="noopener noreferrer">escríbenos</a>.</small>') +
      dato('Instagram', enlaceRed('instagram', s.instagram)) +
      dato('TikTok', enlaceRed('tiktok', s.tiktok)) +
      dato('Géneros favoritos', etiquetasLectura(lista(s.generos_favoritos))) +
      dato('Motivación', etiquetasLectura(lista(s.motivacion))) +
      dato('Cómo nos conociste', valor(s.como_nos_conocio)) +
      dato('Libro publicado', s.libro_publicado ? 'Sí' : 'No') +
      '</dl><button class="btn" type="button" id="perfil-editar">' + ic('lapiz') + 'Editar mis datos</button>';
  }

  // b) Tu inscripción
  function htmlInscripcion() {
    const s = socio;
    const fecha = s.fecha_inscripcion ? esc(fechaLarga(s.fecha_inscripcion)) : (s.fundador ? 'Fundador/a' : vacio);
    const permiso = (et, si) => '<li class="perfil-permiso ' + (si ? 'si' : 'no') + '">' + ic(si ? 'si' : 'no') +
      '<span class="perfil-permiso-et">' + esc(et) + '</span><b>' + (si ? 'Sí' : 'No') + '</b></li>';
    return '<dl class="perfil-datos">' + dato('Fecha de inscripción', fecha) + '</dl>' +
      '<h3 class="perfil-subtitulo">Consentimientos</h3>' +
      '<ul class="perfil-permisos">' +
      permiso('Uso de mi imagen en redes sociales', s.rgpd_imagen === true) +
      permiso('Publicación de mis textos', s.rgpd_publicaciones === true) +
      '</ul>' +
      '<p class="pista perfil-pie">Si quieres cambiar alguno de estos datos, escríbenos a <a href="mailto:' + CONTACTO + '" rel="noopener noreferrer">' + CONTACTO + '</a></p>';
  }

  // b2) Mi carné: lo dibuja carne.js en este navegador cuando la tarjeta aparece en pantalla. Solo el del propio socio,
  //     con los datos de su ficha. Los lienzos y archivos viven en memoria y se sueltan al salir de la página.
  let carne = { turno: 0, caras: null, archivos: null, obs: null, enlace: null };
  function htmlCarne() {
    const compartir = Carne.compartible();
    return '<p class="carne-intro">Tu carné de socio, listo para guardar en el móvil o imprimir.</p>' +
      '<p class="carne-estado" id="carne-estado" role="status"></p>' +
      '<div class="carne-cargando" id="carne-cargando" aria-hidden="true"><span class="carne-hueco"></span><span class="carne-hueco"></span></div>' +
      '<div class="carne-error" id="carne-error" hidden><button class="btn sec" type="button" data-carne="reintentar">Reintentar</button></div>' +
      '<div class="carne-vista" id="carne-vista" hidden>' +
      '<figure class="carne-cara"><div class="carne-lienzo" id="carne-anverso"></div><figcaption>Anverso</figcaption></figure>' +
      '<figure class="carne-cara"><div class="carne-lienzo" id="carne-reverso"></div><figcaption>Reverso</figcaption></figure></div>' +
      '<div class="carne-aviso" id="carne-aviso" hidden></div>' +
      '<div class="carne-botones" id="carne-botones">' +
      '<button class="btn" type="button" data-carne="pdf" disabled>' + ic('bajar') + 'Descargar PDF</button>' +
      '<button class="btn sec" type="button" data-carne="png" disabled>' + ic('bajar') + 'Descargar imagen</button>' +
      (compartir ? '<button class="btn sec" type="button" data-carne="compartir" disabled>' + ic('compartir') + 'Compartir</button>' : '') +
      '</div><div class="carne-alternativa" id="carne-alternativa" hidden></div>';
  }
  const $c = id => document.getElementById(id);
  function estadoCarne(e) { // 'cargando' | 'listo' | 'error'
    if (!$c('perfil-carne')) return;
    $c('carne-cargando').hidden = e !== 'cargando';
    $c('carne-vista').hidden = e !== 'listo';
    $c('carne-error').hidden = e !== 'error';
    $c('carne-estado').textContent = e === 'cargando' ? 'Preparando tu carné…' : e === 'error' ? 'No hemos podido preparar tu carné. Inténtalo de nuevo.' : '';
    $c('carne-estado').hidden = e === 'listo';
    document.querySelectorAll('#carne-botones button').forEach(b => { b.disabled = e !== 'listo'; });
    if (e !== 'listo') { $c('carne-anverso').textContent = ''; $c('carne-reverso').textContent = ''; $c('carne-aviso').hidden = true; }
  }
  // Genera el carné cuando la tarjeta se acerca a la pantalla (o enseguida si ya se ve).
  function observarCarne() {
    const caja = $c('perfil-carne');
    if (!caja || !socio || !window.Carne) return;
    if (carne.obs) carne.obs.disconnect();
    estadoCarne('cargando');
    if (!('IntersectionObserver' in window)) { prepararCarne(); return; }
    carne.obs = new IntersectionObserver(ents => {
      if (!ents.some(x => x.isIntersecting)) return;
      carne.obs.disconnect();
      carne.obs = null;
      prepararCarne();
    }, { rootMargin: '300px 0px' });
    carne.obs.observe(caja);
  }
  function quitarEnlace() {
    if (carne.enlace) { Carne.soltarUrl(carne.enlace); carne.enlace = null; }
    const alt = $c('carne-alternativa');
    if (alt) { alt.hidden = true; alt.textContent = ''; }
  }
  function soltarCarne() {
    carne.turno++;
    if (window.Carne) Carne.soltar(carne.caras);
    carne.caras = null;
    carne.archivos = null;
    quitarEnlace();
  }
  // Al salir de la página (o si la cuenta no tiene ficha): fuera lienzos, archivos y object URL.
  function liberarCarne() {
    soltarCarne();
    if (carne.obs) { carne.obs.disconnect(); carne.obs = null; }
    if (window.Carne) Carne.liberarUrls();
  }
  // Tras cambiar la foto o el nombre: se vuelve a dibujar con los datos nuevos.
  function refrescarCarne() {
    if (!$c('perfil-carne')) return;
    soltarCarne();
    observarCarne();
  }
  // La foto grande que ya se descargó para la cabecera se aprovecha; si no, se descarga (y se libera al terminar).
  async function fotoParaCarne(ruta) {
    if (!ruta) return { url: null, propia: false };
    if (fotoVista.ruta === ruta && !fotoVista.url && fotoVista.promesa) await fotoVista.promesa;
    if (fotoVista.ruta === ruta && fotoVista.url) return { url: fotoVista.url, propia: false };
    return { url: await Fotos.cargar(ruta), propia: true };
  }
  async function prepararCarne() {
    if (!$c('perfil-carne') || !socio) return;
    soltarCarne();
    const turno = carne.turno;
    estadoCarne('cargando');
    const ruta = typeof socio.foto_url === 'string' ? socio.foto_url : '';
    const datos = { nombre: socio.nombre_completo || socio.nombre_pila || '', codigo: socio.codigo || '' };
    let foto = { url: null, propia: false };
    try {
      foto = await fotoParaCarne(ruta);
      if (turno !== carne.turno) return;
      let r = await Carne.dibujar({ nombre: datos.nombre, codigo: datos.codigo, foto: foto.url });
      // Si la foto de la cabecera ya no se puede leer, se descarga otra vez (una sola vez).
      if (ruta && !r.conFoto && !foto.propia && turno === carne.turno) {
        Carne.soltar(r);
        foto = { url: await Fotos.cargar(ruta), propia: true };
        if (turno !== carne.turno) return;
        r = await Carne.dibujar({ nombre: datos.nombre, codigo: datos.codigo, foto: foto.url });
      }
      if (turno !== carne.turno || !$c('perfil-carne')) { Carne.soltar(r); return; }
      carne.caras = r;
      carne.archivos = Carne.archivos(r, datos.codigo);
      carne.archivos.catch(e => { if (turno === carne.turno) Cueva.registrar('No se han podido preparar los archivos del carné', e); });
      pintarCarneListo(r, datos, ruta);
    } catch (e) {
      if (turno !== carne.turno) return;
      Cueva.registrar('No se ha podido preparar el carné', e);
      estadoCarne('error');
    } finally {
      if (foto.propia) Fotos.liberar(foto.url);
    }
  }
  function pintarCarneListo(r, datos, ruta) {
    const nombre = datos.nombre || 'Socio/a', codigo = datos.codigo || 'sin código';
    [['carne-anverso', r.anverso, 'anverso'], ['carne-reverso', r.reverso, 'reverso']].forEach(([id, lienzo, cara]) => {
      lienzo.className = 'carne-canvas';
      lienzo.setAttribute('role', 'img');
      lienzo.setAttribute('aria-label', 'Carné de socio de ' + nombre + ', número ' + codigo + ', ' + cara);
      const caja = $c(id);
      caja.textContent = '';
      caja.appendChild(lienzo);
    });
    estadoCarne('listo');
    const av = $c('carne-aviso');
    if (!ruta) av.innerHTML = '<p>Tu carné saldrá sin foto hasta que la añadas.</p>' +
      '<button class="btn sec" type="button" id="carne-foto" data-carne="foto">' + ic('camara') + 'Añadir foto</button>';
    else if (!r.conFoto) av.innerHTML = '<p>No hemos podido cargar tu foto: de momento el carné sale sin ella.</p>' +
      '<button class="btn sec" type="button" data-carne="reintentar">Reintentar</button>';
    else av.innerHTML = '';
    av.hidden = !av.innerHTML;
  }
  async function accionCarne(que) {
    if (que === 'reintentar') { refrescarCarne(); return; }
    if (que === 'foto') { cambiarFoto('carne-foto'); return; }
    if (!carne.archivos) return;
    const turno = carne.turno;
    let a;
    try { a = await carne.archivos; } catch (e) { Cueva.aviso('No hemos podido preparar el archivo. Inténtalo de nuevo.', 'err'); return; }
    if (turno !== carne.turno) return;
    if (que === 'compartir') {
      try {
        if (await Carne.compartir(a) === 'no') {
          const b = document.querySelector('[data-carne="compartir"]');
          if (b) b.hidden = true;
          Cueva.aviso('Este navegador no permite compartir archivos. Usa «Descargar PDF» o «Descargar imagen».', 'err');
        }
      } catch (e) {
        Cueva.registrar('No se ha podido compartir el carné', e);
        Cueva.aviso('No se ha podido compartir. Prueba a descargarlo.', 'err');
      }
      return;
    }
    quitarEnlace();
    const pdf = que === 'pdf';
    const r = Carne.descargar(pdf ? a.pdf : a.png, pdf ? a.nombrePdf : a.nombrePng);
    if (r.modo === 'enlace') {
      carne.enlace = r.url;
      const alt = $c('carne-alternativa');
      alt.innerHTML = '<p>Este navegador no deja descargar el archivo directamente.</p>' +
        '<a class="btn sec" id="carne-abrir" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + (pdf ? 'Abrir el PDF' : 'Abrir la imagen') + ' en una pestaña nueva</a>';
      alt.hidden = false;
      $c('carne-abrir').focus();
    } else if (r.modo === 'pestana') Cueva.aviso('Tu carné se ha abierto en otra pestaña: guárdalo desde allí.', 'ok');
  }

  // c) Mis cuotas: agrupadas por curso (pestañas si hay más de uno). Sin importes.
  function cursosConCuotas() {
    const ids = unicos(cuotas.map(c => String(c.curso_id)));
    return ids.map(id => cursos.find(c => String(c.id) === id) || { id, codigo: '', nombre: 'Curso' }).sort(compararCursos);
  }
  // Año en que empieza el curso (septiembre): por las mensualidades; si no hay, por el código del curso ("2027" → 2026).
  function inicioCurso(curso, lista) {
    const anios = lista.filter(c => c.tipo === 'mensualidad').map(c => partes(c.mes)).filter(Boolean).map(p => p.m >= 9 ? p.a : p.a - 1);
    if (anios.length) return Math.min.apply(null, anios);
    const n = parseInt(curso.codigo, 10);
    if (n > 1900) return n - 1;
    const d = new Date();
    return d.getMonth() + 1 >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  }
  const insignia = estado => {
    const e = ESTADOS_CUOTA[estado];
    return e ? '<span class="perfil-estado ' + estado + '">' + ic(e.i) + e.n + '</span>' : '<span class="perfil-estado sin">Sin registrar</span>';
  };
  function htmlCuotas() {
    const cs = cursosConCuotas();
    if (!cs.length) return '<p class="empty">Todavía no hay cuotas registradas a tu nombre.</p>';
    if (!cursoCuotas || !cs.some(c => String(c.id) === cursoCuotas)) cursoCuotas = String(cs[0].id);
    const curso = cs.find(c => String(c.id) === cursoCuotas);
    const delCurso = cuotas.filter(c => String(c.curso_id) === cursoCuotas);
    const tabs = cs.length > 1
      ? '<div class="tabs perfil-tabs" role="tablist" aria-label="Cursos" style="grid-template-columns:repeat(' + cs.length + ',1fr)">' +
        cs.map(c => '<button class="tab" type="button" role="tab" data-curso="' + esc(c.id) + '" aria-selected="' + (String(c.id) === cursoCuotas) + '">' + esc(c.nombre || c.codigo) + '</button>').join('') + '</div>'
      : '<p class="perfil-curso">' + esc(curso.nombre || ('Curso ' + curso.codigo)) + '</p>';
    const cuenta = k => delCurso.filter(c => c.estado === k).length;
    const resumen = '<p class="perfil-resumen">' + Object.keys(ESTADOS_CUOTA).map(k => ESTADOS_CUOTA[k].p + ': <b>' + cuenta(k) + '</b>').join(' · ') + '</p>';
    const matricula = delCurso.find(c => c.tipo === 'matricula');
    const a0 = inicioCurso(curso, delCurso), hoy = mesActual();
    const fichas = MESES_CURSO.map(m => {
      const a = m >= 9 ? a0 : a0 + 1, clave = a + '-' + dos(m);
      const c = delCurso.find(x => x.tipo === 'mensualidad' && String(x.mes || '').slice(0, 7) === clave);
      const estado = c && ESTADOS_CUOTA[c.estado] ? c.estado : 'sin';
      const actual = clave === hoy;
      return '<li class="perfil-mes ' + estado + (actual ? ' actual' : '') + '"' + (actual ? ' aria-current="date"' : '') + '>' +
        (actual ? '<span class="perfil-punto" aria-hidden="true"></span>' : '') +
        '<span class="perfil-mes-nombre" aria-hidden="true">' + MESES_CORTOS[m - 1] + '</span>' +
        '<span class="perfil-mes-anio" aria-hidden="true">' + a + '</span>' +
        '<span class="perfil-sr">' + MESES[m - 1] + ' de ' + a + (actual ? ' (mes actual)' : '') + ': </span>' +
        insignia(c && c.estado) + '</li>';
    }).join('');
    return tabs + resumen +
      '<div class="perfil-matricula"><span>Matrícula</span>' + insignia(matricula && matricula.estado) + '</div>' +
      '<h3 class="perfil-subtitulo">Mensualidades</h3>' +
      '<ul class="perfil-meses">' + fichas + '</ul>' +
      '<p class="pista perfil-leyenda"><span class="perfil-punto" aria-hidden="true"></span> Mes actual</p>';
  }

  // d) Mi asistencia
  function htmlAsistencia() {
    const n = asistencia.length;
    if (!n) return '<p class="empty">Todavía no hay registros de asistencia. Cuando pasemos lista en una sesión, la verás aquí.</p>';
    const x = asistencia.filter(a => a.asistio === true).length;
    const pct = Math.round(x / n * 100);
    const R = 42, C = 2 * Math.PI * R;
    const anillo = '<div class="perfil-anillo"><svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<circle class="fondo" cx="50" cy="50" r="' + R + '"/>' +
      (x ? '<circle class="valor" cx="50" cy="50" r="' + R + '" style="--c:' + C.toFixed(2) + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - x / n)).toFixed(2) + '" transform="rotate(-90 50 50)"/>' : '') +
      '</svg><span class="perfil-anillo-pct">' + pct + '<small>%</small></span></div>';
    const fecha = a => (a.evento && a.evento.fecha) || '';
    const filas = asistencia.slice().sort((a, b) => fecha(b).localeCompare(fecha(a))).map(a => {
      const ev = a.evento || {}, t = tipo(ev.tipo), si = a.asistio === true;
      return '<li class="perfil-sesion ' + (si ? 'si' : 'no') + '">' +
        '<span class="perfil-sesion-fecha">' + esc(fechaCorta(ev.fecha) || 'Sin fecha') + '</span>' +
        '<b class="perfil-sesion-titulo">' + esc(ev.titulo || 'Sesión') + '</b>' +
        '<span class="perfil-sesion-pie"><span class="perfil-tipo" style="background:' + t.c + ';color:' + t.t + '">' + esc(t.n) + '</span>' +
        '<span class="perfil-asis ' + (si ? 'si' : 'no') + '">' + ic(si ? 'si' : 'no') + (si ? 'Asististe' : 'No asististe') + '</span></span></li>';
    }).join('');
    return '<div class="perfil-asistencia-resumen">' + anillo +
      '<p><b>Asististe a ' + x + ' de ' + plural(n, 'sesión', 'sesiones') + '</b><span class="pista">Cuenta solo las sesiones en las que se pasó lista.</span></p></div>' +
      '<h3 class="perfil-subtitulo">Sesiones</h3><ul class="perfil-sesiones">' + filas + '</ul>';
  }

  // ---------- Formulario de edición ----------
  function campo(n, et, v, o) {
    o = o || {};
    const desc = (o.pista ? 'p-' + n + ' ' : '') + 'e-' + n;
    return '<div class="campo"><label for="f-' + n + '">' + esc(et) + (o.req ? ' <span class="ast" aria-hidden="true">*</span>' : '') + '</label>' +
      (o.pista ? '<p class="pista" id="p-' + n + '">' + esc(o.pista) + '</p>' : '') +
      (o.arroba ? '<div class="perfil-arroba"><span aria-hidden="true">@</span>' : '') +
      '<input class="entrada' + (o.corta ? ' perfil-corta' : '') + '" id="f-' + n + '" name="' + n + '" type="' + (o.tipo || 'text') + '"' +
      ' value="' + esc(v == null ? '' : v) + '" autocomplete="' + (o.ac || 'off') + '"' +
      (o.modo ? ' inputmode="' + o.modo + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.lista ? ' list="' + o.lista + '"' : '') +
      (o.arroba ? ' autocapitalize="none" spellcheck="false"' : '') + (o.req ? ' aria-required="true"' : '') +
      ' aria-describedby="' + desc + '">' + (o.arroba ? '</div>' : '') +
      '<p class="error-campo" id="e-' + n + '" hidden></p></div>';
  }
  const etiqueta = (n, v, on) => '<label class="etiqueta"><input type="checkbox" name="' + n + '" value="' + esc(v) + '"' + (on ? ' checked' : '') + '><span>' + esc(v) + '</span></label>';
  function grupo(n, et, opciones, marcadas, pista, propia) {
    return '<fieldset class="opciones" id="g-' + n + '" aria-describedby="p-' + n + ' e-' + n + '"><legend>' + esc(et) + '</legend>' +
      '<p class="pista" id="p-' + n + '">' + esc(pista) + '</p>' +
      '<div class="etiquetas" id="l-' + n + '">' + opciones.map(o => etiqueta(n, o, marcadas.includes(o))).join('') + '</div>' +
      '<p class="error-campo" id="e-' + n + '" hidden></p>' +
      (propia ? '<div class="campo perfil-propia"><label for="f-propia">Añadir otra</label>' +
        '<div class="en-linea"><input class="entrada" id="f-propia" type="text" maxlength="' + MAX_PROPIA + '" autocomplete="off" aria-describedby="p-propia e-propia">' +
        '<button class="btn sec" type="button" id="perfil-anadir">Añadir</button></div>' +
        '<p class="pista" id="p-propia">Máximo ' + MAX_PROPIA + ' caracteres.</p>' +
        '<p class="error-campo" id="e-propia" hidden></p><p class="perfil-sr" role="status" id="perfil-anadida"></p></div>' : '') +
      '</fieldset>';
  }
  function htmlFormulario() {
    const s = socio, libro = s.libro_publicado === true;
    const misGeneros = lista(s.generos_favoritos), misMotivos = lista(s.motivacion);
    return '<p class="pista perfil-obligatorio"><span class="ast" aria-hidden="true">*</span> obligatorio</p>' +
      '<fieldset class="perfil-bloqueo" id="perfil-bloqueo">' +
      campo('nombre_completo', 'Nombre y apellidos', s.nombre_completo, { req: true, ac: 'name' }) +
      campo('nombre_pila', 'Nombre de pila', s.nombre_pila, { req: true, ac: 'given-name', pista: 'Es como te llamaremos en la app.' }) +
      campo('edad', 'Edad', s.edad, { modo: 'numeric', corta: true, max: 3 }) +
      campo('telefono', 'Teléfono', s.telefono, { tipo: 'tel', ac: 'tel', pista: 'Solo números y espacios; puede empezar por +. Entre 6 y 20 caracteres.' }) +
      campo('instagram', 'Instagram', s.instagram, { arroba: true, pista: 'Tu nombre de usuario, sin @.' }) +
      campo('tiktok', 'TikTok', s.tiktok, { arroba: true, pista: 'Tu nombre de usuario, sin @.' }) +
      grupo('generos', 'Géneros favoritos', unicos(generos.concat(misGeneros)), misGeneros, 'Marca los que quieras (máximo ' + MAX_LISTA + ').') +
      grupo('motivacion', 'Motivación', unicos(MOTIVOS.concat(misMotivos)), misMotivos, '¿Qué te gustaría trabajar en el club? (máximo ' + MAX_LISTA + ')', true) +
      campo('como_nos_conocio', '¿Cómo nos conociste?', s.como_nos_conocio, { lista: 'perfil-conocio', max: MAX_CONOCIO, pista: 'Elige una sugerencia o escríbelo con tus palabras.' }) +
      '<datalist id="perfil-conocio">' + CONOCIO.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<div class="campo perfil-campo-switch"><span class="perfil-switch-et" id="et-libro">¿Has publicado algún libro?</span>' +
      '<button class="perfil-switch" type="button" id="f-libro" role="switch" aria-checked="' + libro + '" aria-labelledby="et-libro">' +
      '<span class="perfil-switch-pista" aria-hidden="true"><span></span></span><span class="perfil-switch-texto" aria-hidden="true">' + (libro ? 'Sí' : 'No') + '</span></button></div>' +
      '<div class="campo"><label for="f-correo">Correo de acceso</label>' +
      '<input class="entrada" id="f-correo" type="email" value="' + esc(correo) + '" disabled aria-describedby="p-correo">' +
      '<p class="pista" id="p-correo">Es el correo con el que entras. Para cambiarlo, <a href="mailto:' + CONTACTO + '" rel="noopener noreferrer">escríbenos</a>.</p></div>' +
      '<p class="perfil-form-msg" id="perfil-form-msg" hidden></p>' +
      '<div class="botones-form"><button class="btn" type="submit" id="perfil-guardar">Guardar</button>' +
      '<button class="btn sec" type="button" id="perfil-cancelar">Cancelar</button></div>' +
      '</fieldset>';
  }

  const form = () => document.getElementById('perfil-form');
  const vista = () => document.getElementById('perfil-vista');

  function abrirEdicion() {
    if (editando || !socio) return;
    const f = form();
    f.innerHTML = htmlFormulario();
    vista().hidden = true;
    f.hidden = false;
    editando = true;
    history.pushState({ perfil: 'editar' }, '');
    document.getElementById('perfil-datos').scrollIntoView({ block: 'start' });
    document.getElementById('f-nombre_completo').focus({ preventScroll: true });
  }
  function ocultarEdicion() {
    editando = false;
    const f = form();
    if (f) { f.hidden = true; f.innerHTML = ''; }
    if (vista()) vista().hidden = false;
    const b = document.getElementById('perfil-editar');
    if (b) { b.focus({ preventScroll: true }); b.scrollIntoView({ block: 'center' }); }
  }
  // Cancelar (o terminar de guardar) = como el botón "atrás" del móvil: deshace la entrada que añadió abrirEdicion().
  function cerrarEdicion() {
    if (history.state && history.state.perfil === 'editar') history.back();
    else ocultarEdicion();
  }
  window.addEventListener('popstate', () => {
    if (!editando) return;
    // Mientras se guarda no se cierra: así un error no hace perder lo escrito.
    if (guardando) { history.pushState({ perfil: 'editar' }, ''); return; }
    if (!(history.state && history.state.perfil === 'editar')) ocultarEdicion();
  });
  // Si se recarga la página con el formulario abierto, se empieza otra vez por la vista de lectura.
  if (history.state && history.state.perfil) history.replaceState(null, '');
  // El desplazamiento lo decide la página (al abrir y cerrar el formulario), no el navegador al ir "atrás".
  try { history.scrollRestoration = 'manual'; } catch (e) {}

  // Instantánea de lo escrito (se toma antes de cualquier espera).
  function leer() {
    const f = form(), el = f.elements;
    const t = n => String(el[n].value || '').trim();
    const marcadas = n => [...f.querySelectorAll('input[name="' + n + '"]:checked')].map(i => i.value);
    const edadTexto = t('edad');
    return {
      nombre_completo: t('nombre_completo'),
      nombre_pila: t('nombre_pila'),
      edadTexto,
      edad: /^\d+$/.test(edadTexto) ? parseInt(edadTexto, 10) : null,
      telefono: t('telefono') || null,
      instagram: usuarioRed(el.instagram.value) || null,
      tiktok: usuarioRed(el.tiktok.value) || null,
      generos_favoritos: marcadas('generos'),
      motivacion: marcadas('motivacion'),
      como_nos_conocio: t('como_nos_conocio') || null,
      libro_publicado: document.getElementById('f-libro').getAttribute('aria-checked') === 'true'
    };
  }
  function validar(d) {
    const e = {};
    if (!d.nombre_completo) e.nombre_completo = 'Escribe tu nombre y apellidos.';
    if (!d.nombre_pila) e.nombre_pila = 'Escribe tu nombre de pila.';
    if (d.edadTexto && (!/^\d{1,3}$/.test(d.edadTexto) || d.edad > 120)) e.edad = 'La edad debe ser un número entero entre 0 y 120.';
    if (d.telefono && (!TELEFONO.test(d.telefono) || d.telefono.length < 6 || d.telefono.length > 20))
      e.telefono = 'El teléfono solo puede llevar números y espacios, con un + opcional al principio, y tener entre 6 y 20 caracteres.';
    ['instagram', 'tiktok'].forEach(k => {
      if (d[k] && (!USUARIO_RED.test(d[k]) || d[k].length > MAX_RED))
        e[k] = 'Escribe solo tu usuario: letras, números, puntos y guiones bajos (máximo ' + MAX_RED + ').';
    });
    if (d.generos_favoritos.length > MAX_LISTA) e.generos = 'Puedes marcar como máximo ' + MAX_LISTA + ' géneros.';
    if (d.motivacion.length > MAX_LISTA) e.motivacion = 'Puedes marcar como máximo ' + MAX_LISTA + ' motivaciones.';
    if (d.como_nos_conocio && largo(d.como_nos_conocio) > MAX_CONOCIO) e.como_nos_conocio = 'Máximo ' + MAX_CONOCIO + ' caracteres.';
    return e;
  }
  const ORDEN_ERRORES = ['nombre_completo', 'nombre_pila', 'edad', 'telefono', 'instagram', 'tiktok', 'generos', 'propia', 'motivacion', 'como_nos_conocio'];
  function controlesDe(k) {
    const f = form();
    if (k === 'generos' || k === 'motivacion') return [...f.querySelectorAll('input[name="' + k + '"]')];
    const c = document.getElementById('f-' + k);
    return c ? [c] : [];
  }
  function marcarError(k, texto) {
    const p = document.getElementById('e-' + k);
    if (p) { p.textContent = texto || ''; p.hidden = !texto; }
    controlesDe(k).forEach(c => { if (texto) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); });
  }
  function pintarErrores(errores) {
    ORDEN_ERRORES.forEach(k => marcarError(k, errores[k]));
    const primero = ORDEN_ERRORES.find(k => errores[k]);
    if (primero) { const c = controlesDe(primero)[0]; if (c) c.focus(); }
    return !!primero;
  }
  function mensajeForm(texto) {
    const m = document.getElementById('perfil-form-msg');
    if (m) { m.textContent = texto || ''; m.hidden = !texto; }
  }

  // Añade una motivación propia (o marca la que ya existía con el mismo nombre).
  function anadirPropia() {
    const inp = document.getElementById('f-propia');
    if (!inp) return true;
    const v = inp.value.trim().replace(/\s+/g, ' ');
    marcarError('propia', '');
    if (!v) return true;
    if (largo(v) > MAX_PROPIA) { marcarError('propia', 'Máximo ' + MAX_PROPIA + ' caracteres.'); return false; }
    const caja = document.getElementById('l-motivacion');
    const ya = [...caja.querySelectorAll('input[name="motivacion"]')].find(i => i.value.toLocaleLowerCase('es') === v.toLocaleLowerCase('es'));
    if (ya) ya.checked = true;
    else caja.insertAdjacentHTML('beforeend', etiqueta('motivacion', v, true));
    inp.value = '';
    document.getElementById('perfil-anadida').textContent = 'Añadida y marcada: ' + v;
    return true;
  }

  function bloquear(si) {
    const f = form();
    if (!f) return;
    if (si) f.setAttribute('aria-busy', 'true'); else f.removeAttribute('aria-busy');
    document.getElementById('perfil-bloqueo').disabled = si;
    document.getElementById('perfil-guardar').textContent = si ? 'Guardando…' : 'Guardar';
  }

  // Mensaje amable para cada tipo de error (nunca el texto técnico de la base de datos).
  function mensajeGuardado(e) {
    if (e && e.sinFilas) return 'No se han guardado los cambios: tu cuenta no tiene permiso para modificar esta ficha. Lo que has escrito sigue aquí. Si se repite, escríbenos a ' + CONTACTO + '.';
    if (Cueva.esErrorDeRed(e)) return 'No se ha podido guardar porque no hay conexión. Lo que has escrito sigue aquí: inténtalo de nuevo cuando vuelvas a tener internet.';
    if (e && /no puedes modificar ese dato/i.test(e.message || '')) return 'Alguno de esos datos solo lo puede cambiar el club. Si necesitas cambiarlo, escríbenos a ' + CONTACTO + '.';
    if (e && e.code === '23514') return 'Algún dato no tiene el formato correcto. Revísalo e inténtalo de nuevo.';
    return 'No hemos podido guardar los cambios. Lo que has escrito sigue aquí: inténtalo de nuevo dentro de un momento.';
  }

  async function guardar(ev) {
    ev.preventDefault();
    if (guardando) return;
    mensajeForm('');
    if (!anadirPropia()) { document.getElementById('f-propia').focus(); return; }
    const d = leer();
    if (pintarErrores(validar(d))) return;
    // Solo los campos editables: nada de código, consentimientos, fecha de inscripción ni fundador.
    const cambios = {};
    EDITABLES.forEach(k => { cambios[k] = d[k]; });
    guardando = true;
    bloquear(true);
    let ok = false;
    const nombreAntes = socio.nombre_completo + '\n' + socio.nombre_pila;
    try {
      const r = await sb.from('socios').update(cambios).eq('id', uid).select(COLUMNAS);
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || r.data.length !== 1) throw { sinFilas: true };
      socio = r.data[0];
      ok = true;
    } catch (e) {
      const texto = mensajeGuardado(e);
      mensajeForm(texto);
      Cueva.aviso(texto, 'err');
    } finally {
      guardando = false;
      bloquear(false);
    }
    if (!ok) return;
    Cueva.guardarInicial(socio.nombre_pila || socio.nombre_completo);
    vista().innerHTML = htmlVista();
    pintarCabecera();
    if (socio.nombre_completo + '\n' + socio.nombre_pila !== nombreAntes) refrescarCarne();
    cerrarEdicion();
    Cueva.aviso('Tus datos se han guardado.', 'ok');
  }

  // ---------- Eventos ----------
  contenido.addEventListener('click', e => {
    if (e.target.closest('#perfil-editar')) { abrirEdicion(); return; }
    const bc = e.target.closest('[data-carne]');
    if (bc) { if (!bc.disabled) accionCarne(bc.dataset.carne); return; }
    if (e.target.closest('#perfil-cancelar')) { if (!guardando) cerrarEdicion(); return; }
    if (e.target.closest('#perfil-anadir')) { anadirPropia(); document.getElementById('f-propia').focus(); return; }
    const sw = e.target.closest('#f-libro');
    if (sw) {
      const si = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(si));
      sw.querySelector('.perfil-switch-texto').textContent = si ? 'Sí' : 'No';
      return;
    }
    const tab = e.target.closest('#perfil-cuotas .tab');
    if (tab) {
      cursoCuotas = tab.dataset.curso;
      document.getElementById('perfil-cuotas-cuerpo').innerHTML = htmlCuotas();
      const nueva = document.querySelector('#perfil-cuotas .tab[aria-selected="true"]');
      if (nueva) nueva.focus();
    }
  });
  contenido.addEventListener('submit', e => { if (e.target.id === 'perfil-form') guardar(e); });
  contenido.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'f-propia') { e.preventDefault(); anadirPropia(); }
  });
  // Al salir de los campos de redes, se quitan @ y espacios para que se vea cómo se guardará.
  contenido.addEventListener('focusout', e => {
    if (e.target.id === 'f-instagram' || e.target.id === 'f-tiktok') e.target.value = usuarioRed(e.target.value);
  });

  cargar();
})();
