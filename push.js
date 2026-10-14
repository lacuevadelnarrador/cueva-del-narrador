// NOTIFICACIONES AL MÓVIL (Web Push). Se carga detrás de auth.js (perfil.html). Script de la base de datos: supabase_27.
// - Cada dispositivo se activa por separado: el navegador crea una suscripción (dirección + claves) y se guarda con la
//   función guardar_suscripcion_push (solo socios activos con ficha; máximo 5 dispositivos por socio).
//   El socio solo puede leer y borrar sus filas de suscripciones_push; no puede escribirlas directamente.
// - La clave VAPID de aquí es la PÚBLICA: va en el código a propósito. Nunca se pone aquí ninguna clave privada.
// - Las notificaciones las muestra sw.js (eventos "push" y "notificationclick").
// - Nada se guarda en el dispositivo; en la consola, solo errores sin datos (Cueva.registrar).
// - Al cerrar sesión, auth.js borra la suscripción de este dispositivo (o todas las del socio) antes de salir.
Cueva.push = (function () {
  const CLAVE_PUBLICA = 'BKc7DIrgPzZNiui9ALRrA7rgdz224H87al0fcUs1cn8WRqTLHtCiHcngMJXkcFV8YD9UpU0_PN79X7Gi5_vHsEo';
  // Mensajes de la función de la base de datos (ya en castellano): se muestran tal cual. Cualquier otro, el genérico.
  const MENSAJES_BD = [
    'Inicia sesión para activar las notificaciones.',
    'Tu cuenta no tiene ficha de socio.',
    'Este dispositivo no admite notificaciones.'
  ];
  const NO_ACTIVA = 'No se han podido activar las notificaciones. Inténtalo de nuevo dentro de un momento.';
  const NO_DESACTIVA = 'No se han podido desactivar las notificaciones. Inténtalo de nuevo dentro de un momento.';

  const soportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iPad con iPadOS se presenta como un Mac: se reconoce por la pantalla táctil.
  const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = () => navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  // 'default' (sin preguntar) | 'granted' | 'denied' | 'no-admitido'
  const permiso = () => 'Notification' in window ? Notification.permission : 'no-admitido';

  // Error con el texto que se enseña al socio (paraSocio). La causa se registra antes, sin datos.
  const fallo = (e, generico) => Object.assign(new Error(
    e && MENSAJES_BD.includes(e.message) ? e.message : (e && Cueva.esErrorDeRed(e) ? Cueva.mensaje(e) : generico)), { paraSocio: true });

  // Clave pública (base64url) → bytes, como la pide pushManager.subscribe.
  function claveEnBytes(b64) {
    const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
  }

  const conLimite = (promesa, ms) => Promise.race([promesa, new Promise((ok, mal) => setTimeout(() => mal({ name: 'TiempoAgotado' }), ms))]);

  // Suscripción de este navegador (o null). getRegistration no se queda esperando si no hay service worker.
  async function local() {
    if (!soportado()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
  }

  async function guardar(sus) {
    const j = sus.toJSON();
    const k = j.keys || {};
    const sb = await Cueva.cliente();
    const r = await sb.rpc('guardar_suscripcion_push', { p_endpoint: j.endpoint, p_p256dh: k.p256dh, p_auth: k.auth });
    if (r.error) throw r.error;
  }

  // Activadas = hay suscripción en este navegador Y su fila existe en la base de datos (de esta cuenta).
  async function activo() {
    const sus = await local();
    if (!sus) return false;
    const sb = await Cueva.cliente();
    const r = await sb.from('suscripciones_push').select('id').eq('endpoint', sus.endpoint).limit(1);
    if (r.error) throw r.error;
    return (r.data || []).length > 0;
  }

  // Al abrir la página (sin pedir permisos): si el permiso ya está concedido y hay suscripción, se vuelve a guardar.
  // Así el dispositivo queda ligado a la cuenta con la que se ha entrado. Devuelve true si la ha guardado.
  async function revincular() {
    if (!soportado() || permiso() !== 'granted') return false;
    const sus = await local();
    if (!sus) return false;
    await guardar(sus);
    return true;
  }

  // Pide el permiso admitiendo también la forma antigua de Safari (con función de respuesta en vez de promesa).
  // La llamada a requestPermission es síncrona: va dentro del gesto del usuario.
  const pedirPermiso = () => new Promise(ok => {
    const r = Notification.requestPermission(ok);
    if (r && typeof r.then === 'function') r.then(ok, () => ok(Notification.permission));
  });

  // Se llama DIRECTAMENTE desde el clic: lo primero es pedir el permiso (en iPhone exige el gesto del usuario, así que
  // no puede haber esperas de red antes). Devuelve 'activado' | 'denegado' | 'sin-respuesta'.
  // Si algo falla lanza un Error con el texto para el socio y no deja nada a medias.
  async function activar() {
    const p = await pedirPermiso();
    if (p === 'denied') return 'denegado';
    if (p !== 'granted') return 'sin-respuesta';
    let sus;
    try {
      const reg = await conLimite(navigator.serviceWorker.ready, 10000);
      sus = await reg.pushManager.getSubscription() ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveEnBytes(CLAVE_PUBLICA) });
    } catch (e) {
      Cueva.registrar('No se ha podido crear la suscripción a las notificaciones', e);
      throw fallo(null, NO_ACTIVA);
    }
    try {
      await guardar(sus);
    } catch (e) {
      Cueva.registrar('No se han podido activar las notificaciones', e);
      try { await sus.unsubscribe(); } catch (e2) { Cueva.registrar('No se ha podido deshacer la suscripción', e2); }
      throw fallo(e, NO_ACTIVA);
    }
    return 'activado';
  }

  // Borra la fila de este dispositivo y después da de baja la suscripción del navegador.
  // Si la fila ya no estaba (se borró desde otro sitio), también vale. Si el borrado falla, no se toca nada.
  async function desactivar() {
    const sus = await local();
    if (!sus) return;
    try {
      const sb = await Cueva.cliente();
      const r = await sb.from('suscripciones_push').delete().eq('endpoint', sus.endpoint).select('id');
      if (r.error) throw r.error;
    } catch (e) {
      Cueva.registrar('No se han podido desactivar las notificaciones', e);
      throw fallo(e, NO_DESACTIVA);
    }
    try { await sus.unsubscribe(); } catch (e) { Cueva.registrar('No se ha podido dar de baja la suscripción', e); }
  }

  return { soportado, esIOS, instalada, permiso, activo, revincular, activar, desactivar };
})();
