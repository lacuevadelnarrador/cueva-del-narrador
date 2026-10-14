// Service worker de La Cueva del Narrador
// Al cambiar archivos importantes, sube el número de versión para forzar la actualización.
// Aquí solo se guardan los archivos de la propia web (páginas, estilos, imágenes), que no llevan datos.
// Los datos de socios vienen de Supabase y NUNCA se guardan en caché: sin sesión o sin conexión no están disponibles.
// Las fotos de los socios tampoco: vienen del almacén privado de Supabase y se descargan con la sesión.
const VERSION = 'cueva-v33';
const ARCHIVOS = [
  './',
  'index.html',
  'acceso.html',
  'inicio.html',
  'nuestra-biblioteca.html',
  'calendario.html',
  'biblioteca.html',
  'curso.html',
  'mas.html',
  'club.html',
  'contacto.html',
  'instalar.html',
  'entidades.html',
  'entidades.js',
  'privacidad.html',
  'perfil.html',
  'perfil.js',
  'retos.html',
  'entregas.js',
  'admin.html',
  'admin-eventos.html',
  'admin-retos.html',
  'admin-publicaciones.html',
  'admin-libros.html',
  'admin-socios.html',
  'admin-informes.html',
  'admin-copia.html',
  'admin-avisos.html',
  'admin.js',
  'admin-portadas.js',
  'admin-socios.js',
  'admin-asistencia.js',
  'admin-informes.js',
  'admin-copia.js',
  'admin-avisos.js',
  'admin-entregas.js',
  'zip.js',
  'fotos.js',
  'carne.js',
  'styles.css',
  'tipos.js',
  'supabase-config.js',
  'auth.js',
  'campana.js',
  'push.js',
  'manifest.webmanifest',
  'img/logo-arco.png',
  'img/logo-completo.png',
  'fonts/GreatVibes-Regular.woff2',
  'img/icon-192.png',
  'img/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(claves =>
      Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Primero red (para ver siempre lo último); si no hay conexión, usa lo guardado.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Todo lo que no sea de esta web (Supabase, la librería del CDN, las fuentes) pasa directo a la red, sin guardarse.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        // Las direcciones con parámetros (acceso.html?motivo=...) no se guardan: valdrá la copia sin parámetros.
        if (r.ok && !url.search) {
          const copia = r.clone();
          caches.open(VERSION).then(c => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- Notificaciones al móvil (Web Push, push.js) ----------
// El servidor envía { id, titulo, texto, enlace } (enlace: null o una página como 'retos.html').
// Siempre se muestra una notificación, aunque el mensaje venga mal (iPhone lo exige).
self.addEventListener('push', e => {
  let d = null;
  try { d = e.data ? e.data.json() : null; } catch (err) { d = null; }
  if (!d || typeof d !== 'object') d = {};
  const titulo = typeof d.titulo === 'string' && d.titulo.trim() ? d.titulo : 'La Cueva del Narrador';
  const opciones = {
    body: typeof d.texto === 'string' ? d.texto : '',
    icon: 'img/icon-192.png',
    lang: 'es',
    data: { enlace: typeof d.enlace === 'string' ? d.enlace : null }
  };
  if (d.id != null) opciones.tag = 'aviso-' + d.id;
  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

// Al tocarla: abre la página del aviso (solo nombres de página de esta web; si no, el inicio). Si la app ya está
// abierta, la trae al frente y la lleva allí; si no, abre una ventana nueva.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const enlace = e.notification.data && e.notification.data.enlace;
  const destino = new URL(typeof enlace === 'string' && /^[a-z0-9-]+\.html$/.test(enlace) ? enlace : 'inicio.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = ventanas.find(c => c.url.startsWith(self.registration.scope));
    if (app) {
      try {
        const enfocada = await app.focus();
        if (typeof (enfocada || app).navigate === 'function') { await (enfocada || app).navigate(destino); return; }
      } catch (err) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(destino);
  })());
});
