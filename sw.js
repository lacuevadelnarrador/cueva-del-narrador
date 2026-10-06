// Service worker de La Cueva del Narrador
// Al cambiar archivos importantes, sube el número de versión para forzar la actualización.
// Aquí solo se guardan los archivos de la propia web (páginas, estilos, imágenes), que no llevan datos.
// Los datos de socios vienen de Supabase y NUNCA se guardan en caché: sin sesión o sin conexión no están disponibles.
// Las fotos de los socios tampoco: vienen del almacén privado de Supabase y se descargan con la sesión.
const VERSION = 'cueva-v22';
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
  'admin.html',
  'admin-eventos.html',
  'admin-retos.html',
  'admin-publicaciones.html',
  'admin-libros.html',
  'admin-socios.html',
  'admin.js',
  'admin-portadas.js',
  'admin-socios.js',
  'admin-asistencia.js',
  'fotos.js',
  'styles.css',
  'tipos.js',
  'supabase-config.js',
  'auth.js',
  'manifest.webmanifest',
  'img/logo-arco.png',
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
