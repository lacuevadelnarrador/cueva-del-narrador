// PASAR LISTA (admin-eventos.html): asistencia de los socios a cada evento.
// - Tabla asistencia(evento_id, socio_id, asistio): una fila por socio y evento (clave primaria compuesta).
//   "Hay lista" = existe alguna fila de ese evento, aunque nadie esté marcado (todas con asistio = false).
// - Bloque "Asistencia" dentro del formulario de un evento ya guardado, vista "Pasar lista" y resumen "X/N" de la lista.
// - Son datos personales: todo se escapa con Admin.esc, los errores pasan por Admin.escribir / Cueva.registrar
//   (solo el código, nunca la fila) y no se guarda nada en el dispositivo.
// - Solo se usa la publishable key con la sesión del usuario (Admin.sb()). Quién puede escribir lo decide RLS.

const Asistencia = (function () {
  const esc = Admin.esc, el = id => document.getElementById(id);
  const formAsis = el('form-asis');
  const norm = t => String(t == null ? '' : t).toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const inicialDe = t => (Array.from(String(t || '').trim())[0] || '?').toLocaleUpperCase('es');
  const nSocios = n => n + (n === 1 ? ' socio' : ' socios');
  const futuro = ev => !!ev && !!ev.fecha && ev.fecha > Admin.hoy(); // texto AAAA-MM-DD frente a la fecha local de hoy

  let refrescar = async () => {}; // la pone admin-eventos.html: recarga y vuelve a pintar el evento abierto
  let formEvento = null;          // formulario del evento (para el bloqueo al borrar la lista)

  // ---------- Resumen por evento (una sola lectura de toda la tabla, agrupada aquí) ----------
  // Map evento_id → { x: asistieron, n: filas }. Sin entrada = todavía no se ha pasado lista.
  let RESUMEN = new Map();
  const clave = id => String(id);
  // PostgREST devuelve como mucho 1000 filas por petición: se pide por páginas hasta que llega una incompleta.
  // Con pocos eventos es una sola petición; nunca una por evento.
  const PAGINA = 1000;
  async function leerResumen(sb) {
    const filas = [];
    for (let desde = 0; ; desde += PAGINA) {
      const r = await sb.from('asistencia').select('evento_id,asistio').order('evento_id').order('socio_id').range(desde, desde + PAGINA - 1);
      if (r.error) return { data: null, error: r.error };
      filas.push(...(r.data || []));
      if (!r.data || r.data.length < PAGINA) break;
    }
    return { data: filas, error: null };
  }
  function ponerResumen(filas) {
    RESUMEN = new Map();
    (filas || []).forEach(f => {
      const k = clave(f.evento_id);
      const r = RESUMEN.get(k) || { x: 0, n: 0 };
      r.n++; if (f.asistio === true) r.x++;
      RESUMEN.set(k, r);
    });
  }
  const resumen = id => RESUMEN.get(clave(id)) || null;

  // ---------- Bloque "Asistencia" del formulario del evento ----------
  function pintarBloque(ev) {
    const caja = el('asistencia');
    if (!caja) return;
    caja.hidden = !ev;
    if (!ev) { caja.innerHTML = ''; return; }
    const r = resumen(ev.id), espera = futuro(ev);
    caja.innerHTML =
      '<h3 id="asis-bloque-titulo">Asistencia</h3>' +
      '<p class="asis-resumen" id="asis-resumen">' + (r ? 'Asistieron <b>' + r.x + '</b> de ' + esc(nSocios(r.n)) : 'Todavía no se ha pasado lista') + '</p>' +
      '<button type="button" class="btn" id="asis-abrir"' + (espera ? ' disabled aria-describedby="asis-espera"' : '') + '>' + (r ? 'Editar lista' : 'Pasar lista') + '</button>' +
      (espera ? '<p class="pista" id="asis-espera">Podrás pasar lista cuando llegue el día del evento.</p>' : '') +
      (r ? '<div class="asis-zona-borrar"><button type="button" class="btn peligro" id="asis-borrar">Borrar la lista de este evento</button></div>' : '');
  }

  // ---------- Vista "Pasar lista" ----------
  // estado: evento (instantánea), socios de la lista (ordenados), marcas actuales y las iniciales (para saber si hay cambios).
  let estado = null, turno = 0;
  const marcados = () => estado.socios.filter(s => estado.marcas.get(s.id)).length;
  const hayCambios = () => !!estado && estado.socios.some(s => !!estado.marcas.get(s.id) !== !!estado.iniciales.get(s.id));
  const filtro = () => norm(el('asis-q') ? el('asis-q').value : '');
  const visibles = () => { const q = filtro(); return estado.socios.filter(s => !q || s.busca.includes(q)); };

  function abrir(ev) {
    if (!ev || futuro(ev)) return;
    const evento = { id: ev.id, titulo: ev.titulo, fecha: ev.fecha }; // instantánea
    const yo = ++turno;
    estado = null;
    el('asis-evento').innerHTML = '<b>' + esc(evento.titulo || 'Evento sin título') + '</b>' + (evento.fecha ? ' · ' + esc(Admin.fecha(evento.fecha)) : '');
    el('asis-guardar').hidden = true;
    Admin.limpiar(formAsis);
    Admin.abrir('vista-asistencia');
    Cueva.cargar(el('asis-cuerpo'),
      () => Admin.iniciar().then(sb => Promise.all([
        sb.from('socios').select('id,codigo,nombre_completo'),
        sb.from('perfiles').select('id,activo'),
        sb.from('asistencia').select('socio_id,asistio').eq('evento_id', evento.id)
      ])).then(([so, pe, as]) => ({ error: so.error || pe.error || as.error, data: { socios: so.data || [], perfiles: pe.data || [], filas: as.data || [] } })),
      ({ socios, perfiles, filas }) => {
        if (yo !== turno) return; // se abrió otra lista mientras cargaba
        const activo = new Map(perfiles.map(p => [String(p.id), p.activo === true]));
        const guardada = new Map(filas.map(f => [String(f.socio_id), f.asistio === true]));
        // Salen los socios activos con ficha y, además, cualquiera (aunque ahora esté inactivo) con fila de este evento.
        const lista = socios.filter(s => activo.get(String(s.id)) || guardada.has(String(s.id))).map(s => ({
          id: s.id, codigo: s.codigo || '', nombre: s.nombre_completo || s.codigo || 'Sin nombre',
          inactivo: !activo.get(String(s.id)),
          busca: norm(s.nombre_completo) + ' ' + norm(s.codigo) + ' ' + norm(s.codigo).replace(/[^a-z0-9]/g, '')
        })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || String(a.codigo).localeCompare(String(b.codigo)));
        // Con lista guardada, cada uno con su valor; sin lista, todos desmarcados.
        const iniciales = new Map(lista.map(s => [s.id, guardada.get(String(s.id)) === true]));
        estado = { evento, socios: lista, iniciales, marcas: new Map(iniciales) };
        pintarVista();
      });
  }

  function pintarVista() {
    const cuerpo = el('asis-cuerpo');
    if (!estado.socios.length) {
      el('asis-guardar').hidden = true;
      cuerpo.innerHTML = '<p class="empty">Todavía no hay socios activos con ficha, así que no hay a quién pasar lista. Cuando des de alta socios en Administración › Socios, aparecerán aquí.</p>';
      return;
    }
    el('asis-guardar').hidden = false;
    cuerpo.innerHTML =
      '<p class="asis-contador" id="asis-contador" aria-live="polite"></p>' +
      '<input class="buscador" id="asis-q" type="search" placeholder="Buscar por nombre o código" aria-label="Buscar socios por nombre o código" autocomplete="off" spellcheck="false">' +
      '<div class="asis-masivo">' +
        '<button type="button" class="chip" id="asis-todos"></button>' +
        '<button type="button" class="chip" id="asis-ninguno"></button>' +
      '</div>' +
      '<p class="pista" id="asis-pista">Marcar o desmarcar no guarda nada: pulsa «Guardar» al terminar.</p>' +
      '<p class="cuenta" id="asis-vistos" aria-live="polite"></p>' +
      '<ul class="asis-lista" id="asis-lista">' + estado.socios.map((s, i) => {
        const on = !!estado.marcas.get(s.id);
        return '<li class="asis-fila' + (s.inactivo ? ' inactiva' : '') + '" data-i="' + i + '">' +
          '<span class="soc-inicial" aria-hidden="true">' + esc(inicialDe(s.nombre)) + '</span>' +
          '<span class="st"><b id="asis-n-' + i + '">' + esc(s.nombre) + '</b><small>' + esc([s.codigo, s.inactivo ? 'Cuenta inactiva' : ''].filter(Boolean).join(' · ')) + '</small></span>' +
          '<button type="button" class="perfil-switch asis-switch" role="switch" data-i="' + i + '" aria-checked="' + on + '" aria-labelledby="asis-et-' + i + ' asis-n-' + i + '">' +
            '<span class="perfil-sr" id="asis-et-' + i + '">Asistió:</span>' +
            '<span class="perfil-switch-pista" aria-hidden="true"><span></span></span>' +
            '<span class="perfil-switch-texto asis-estado" aria-hidden="true">' + (on ? 'Asistió' : 'No asistió') + '</span>' +
          '</button></li>';
      }).join('') + '</ul>' +
      '<p class="empty" id="asis-nadie" hidden></p>';
    pintarContador();
    pintarFiltro();
  }

  function pintarContador() {
    el('asis-contador').innerHTML = '<b>' + marcados() + '</b> de ' + estado.socios.length + ' asistieron';
  }
  function pintarInterruptor(i) {
    const b = el('asis-lista').querySelector('.asis-switch[data-i="' + i + '"]');
    if (!b) return;
    const on = !!estado.marcas.get(estado.socios[i].id);
    b.setAttribute('aria-checked', on);
    b.querySelector('.asis-estado').textContent = on ? 'Asistió' : 'No asistió';
  }
  // Buscador y textos de los botones masivos: con filtro actúan solo sobre las personas que se ven.
  function pintarFiltro() {
    const q = filtro(), vis = new Set(visibles());
    el('asis-lista').querySelectorAll('.asis-fila').forEach(li => { li.hidden = !vis.has(estado.socios[+li.dataset.i]); });
    const n = vis.size;
    const todos = el('asis-todos'), ninguno = el('asis-ninguno');
    if (q) {
      todos.textContent = n === 1 ? 'Marcar a la 1 que se ve' : 'Marcar a las ' + n + ' que se ven';
      ninguno.textContent = n === 1 ? 'Desmarcar a la 1 que se ve' : 'Desmarcar a las ' + n + ' que se ven';
    } else {
      todos.textContent = 'Marcar a todos';
      ninguno.textContent = 'Desmarcar a todos';
    }
    // Sin nadie a la vista no hay nada que marcar. (Durante el guardado, Admin.bloquear ya los desactiva.)
    if (!formAsis.getAttribute('aria-busy')) { todos.disabled = !n; ninguno.disabled = !n; }
    el('asis-vistos').textContent = q ? (n === 1 ? 'Se ve 1 de ' : 'Se ven ' + n + ' de ') + estado.socios.length : '';
    const nadie = el('asis-nadie');
    nadie.hidden = !!n;
    nadie.textContent = n ? '' : 'Nadie coincide con «' + el('asis-q').value.trim() + '».';
  }
  function marcarVisibles(valor) {
    visibles().forEach(s => estado.marcas.set(s.id, valor));
    estado.socios.forEach((s, i) => pintarInterruptor(i));
    pintarContador();
  }

  formAsis.addEventListener('click', e => {
    if (!estado || formAsis.getAttribute('aria-busy')) return;
    const sw = e.target.closest('.asis-switch');
    if (sw) {
      const s = estado.socios[+sw.dataset.i]; if (!s) return;
      estado.marcas.set(s.id, !estado.marcas.get(s.id));
      pintarInterruptor(+sw.dataset.i);
      pintarContador();
      return;
    }
    if (e.target.closest('#asis-todos')) marcarVisibles(true);
    else if (e.target.closest('#asis-ninguno')) marcarVisibles(false);
  });
  formAsis.addEventListener('input', e => { if (estado && e.target.id === 'asis-q') pintarFiltro(); });
  // Intro en el buscador no envía el formulario (no debe guardar).
  formAsis.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'asis-q') e.preventDefault(); });

  // Cancelar: descarta lo marcado. Si hay cambios sin guardar, se pregunta antes.
  el('asis-cancelar').addEventListener('click', async () => {
    if (formAsis.getAttribute('aria-busy')) return;
    if (hayCambios() && !await Admin.confirmar('Se descartará lo que has marcado y no has guardado.', 'Descartar')) return;
    turno++; estado = null;
    Admin.cerrar(formAsis);
  });

  // Guardar: UNA escritura con una fila por cada socio de la lista (asistio true/false), aunque nadie esté marcado.
  formAsis.addEventListener('submit', async e => {
    e.preventDefault();
    if (formAsis.getAttribute('aria-busy') || !estado || !estado.socios.length) return; // ya se está guardando
    // Instantánea ANTES de cualquier espera: lo que se envía es lo que había al pulsar.
    const ev = estado.evento;
    const filas = estado.socios.map(s => ({ evento_id: ev.id, socio_id: s.id, asistio: estado.marcas.get(s.id) === true }));
    const sb = Admin.sb();
    const hecho = await Admin.escribir(formAsis, async () => {
      const r = await sb.from('asistencia').upsert(filas, { onConflict: 'evento_id,socio_id' }).select('evento_id,socio_id');
      if (r.error) return r;
      const n = Array.isArray(r.data) ? r.data.length : 0;
      if (n === 0) throw { sinFilas: true };
      if (n !== filas.length) throw { mensaje: 'La base de datos solo ha confirmado ' + n + ' de ' + filas.length + ' filas. Lo que has marcado sigue aquí: vuelve a pulsar «Guardar».' };
      return r;
    }, 'Lista de asistencia guardada.');
    if (!hecho) return; // el error queda escrito arriba y lo marcado no se toca
    if (estado && estado.evento === ev) estado.iniciales = new Map(estado.marcas);
    Admin.cerrar(formAsis);
    await refrescar(ev.id);
  });

  // ---------- Borrar la lista (bloque del evento) ----------
  async function borrarLista(ev) {
    if (!ev || !formEvento || formEvento.getAttribute('aria-busy')) return;
    const id = ev.id; // instantánea
    const si = await Admin.confirmar('Se borrará la asistencia de este evento. Esto cambia las estadísticas de asistencia de todos los socios.', 'Borrar la lista');
    if (!si) return;
    const sb = Admin.sb();
    const ok = await Admin.escribir(formEvento, () => sb.from('asistencia').delete().eq('evento_id', id).select('socio_id'), 'Lista de asistencia borrada.');
    if (ok) await refrescar(id);
  }

  // Cuántas filas de asistencia tiene un evento (para el aviso de borrado del evento). null si no se puede saber.
  async function contar(id) {
    try {
      const r = await Admin.sb().from('asistencia').select('socio_id', { count: 'exact', head: true }).eq('evento_id', id);
      return r.error ? null : r.count || 0;
    } catch (e) { return null; }
  }

  // admin-eventos.html: evento() devuelve el evento abierto; alRefrescar(id) recarga y repinta ese evento.
  function configurar(o) {
    formEvento = o.form;
    refrescar = o.alRefrescar;
    el('asistencia').addEventListener('click', e => {
      const ev = o.evento();
      if (e.target.closest('#asis-abrir')) abrir(ev);
      else if (e.target.closest('#asis-borrar')) borrarLista(ev);
    });
  }

  return { configurar, leerResumen, ponerResumen, resumen, pintarBloque, contar };
})();
