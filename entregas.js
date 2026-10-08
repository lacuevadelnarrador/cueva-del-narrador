// ESTADO DE LAS ENTREGAS DE LOS RETOS (código común a retos.html, inicio.html e index.html)
// Decide, para el socio con sesión, en qué punto está cada reto: entregado, abierto (puede subir su texto) o cerrado.
// - Sin sesión guardada en el dispositivo no se hace ninguna petición: los visitantes no cargan nada nuevo.
// - Solo un socio con ficha puede entregar: sin ficha (por ejemplo, la cuenta del club) se trata como un visitante.
// - "Entregado" = fila de entregas con subido = true. Una fila con subido = false es una subida empezada: no cuenta.
// - La fecha límite (plazo) es solo orientativa: lo que abre o cierra las entregas es retos.entregas_abiertas.
// Privacidad: no se guarda nada en el dispositivo; los errores los registra quien llama (Cueva.registrar, sin datos).

const EstadoEntrega = (function () {
  // Id del usuario con sesión, o null. Sin sesión guardada no pregunta nada a Supabase.
  async function sesion(sb) {
    if (!Cueva.haySesionLocal()) return null;
    try {
      const r = await sb.auth.getSession();
      const s = r.data && r.data.session;
      return s ? s.user.id : null;
    } catch (e) { return null; }
  }

  // ¿Tiene ficha? y sus entregas de esos retos: { ficha: true|false, mias: Map(reto_id en texto → fila) }.
  // Lanza el error si falla alguna de las dos consultas.
  async function leer(sb, uid, idsRetos) {
    const [ficha, ent] = await Promise.all([
      sb.from('socios').select('id').eq('id', uid).maybeSingle(),
      sb.from('entregas').select('reto_id,nombre_archivo,subido,entregado').eq('socio_id', uid).in('reto_id', idsRetos)
    ]);
    if (ficha.error || ent.error) throw ficha.error || ent.error;
    return { ficha: !!ficha.data, mias: new Map((ent.data || []).map(e => [String(e.reto_id), e])) };
  }

  // 'entregado' | 'abierta' | 'cerrada'
  const de = (reto, entrega) => entrega && entrega.subido === true ? 'entregado' : reto && reto.entregas_abiertas !== false ? 'abierta' : 'cerrada';

  // Día de Madrid (AAAA-MM-DD) de una fecha con hora de la base de datos.
  function diaMadrid(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return '';
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  // Pastilla de la tarjeta del reto actual (inicio.html e index.html): "Ver los retos" mientras no se sepa otra cosa;
  // "Sube tu reto" si puede entregar y "Reto entregado" con un check en SVG si ya lo hizo. Siempre lleva a la pestaña Retos.
  // reto: el reto actual con id y entregas_abiertas (o null). Si algo falla, se queda en "Ver los retos".
  async function enlaceInicio(enlace, sb, reto, uid) {
    if (!enlace || !reto || reto.id == null || !uid) return;
    try {
      const r = await leer(sb, uid, [reto.id]);
      if (!r.ficha) return;
      const estado = de(reto, r.mias.get(String(reto.id)));
      // Pastilla rellena para subir; en tono suave cuando ya está entregado; con borde (la de partida) en los demás casos.
      if (estado === 'abierta') { enlace.textContent = 'Sube tu reto'; enlace.classList.add('on'); }
      else if (estado === 'entregado') { enlace.innerHTML = 'Reto entregado <svg class="perfil-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12l5 5 9-10"/></svg>'; enlace.classList.add('suave'); }
    } catch (e) {
      Cueva.registrar('No se ha podido comprobar tu entrega', e);
    }
  }

  return { sesion, leer, de, diaMadrid, enlaceInicio };
})();
