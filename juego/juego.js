// JUEGO «¿Estás preparado para ser escritor?» (quiz.html)
// Fase 2: solo el modo público. Todo ocurre en el navegador: ni el motor ni la fuente de preguntas llaman a ningún
// servidor; lo único que se pide son los JSON estáticos de juego/ (premios y, al elegir categoría, su banco).
// Lo que haga auth.js con la barra, el avatar y la campana es aparte y no depende del juego.
//
// Tres piezas separadas, para que el modo de socios (fase 3, con servidor) solo tenga que añadir otra fuente:
// - Fuente de preguntas: empezar, pregunta, responder, cincuenta y puedeSaltar. Todo devuelve promesas y la pregunta
//   llega a la pantalla SIN la respuesta correcta: la decide responder(). Una fuente que hable con el servidor encaja
//   igual, sin tocar el motor ni las pantallas.
// - Estantería: leer y ganar. Ahora en sessionStorage (o en memoria si está bloqueado).
// - Motor: un único objeto de estado (E) y funciones que lo cambian; cada cambio acaba en pintar().
// El contador se mide con la hora (Date.now() contra la hora de inicio de la pregunta), no contando ticks: si el
// navegador pausa o ralentiza la pestaña, el tiempo sigue siendo correcto. Se para mientras se ve la explicación.
(function () {
  'use strict';

  const MODO = 'publico';         // fase 3: 'socios' elegirá la fuente del servidor
  const SOLO_REVISADAS = false;   // true: solo se usan las preguntas con "revisada": true
  const SEGUNDOS = 45;
  const POR_NIVEL = 5;
  const NIVELES = ['facil', 'media', 'dificil'];
  const NOMBRE_NIVEL = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
  const TOTAL = POR_NIVEL * NIVELES.length;
  const SEGUROS = [5, 10];
  const AVISOS_TIEMPO = [30, 10, 5];
  const LETRAS = ['A', 'B', 'C', 'D'];
  // banco: true = existe juego/banco/<id>.json. Las demás salen como «Próximamente».
  const CATEGORIAS = [
    { id: 'ideas', nombre: 'Ideas y premisa' },
    { id: 'worldbuilding', nombre: 'Worldbuilding' },
    { id: 'personajes', nombre: 'Personajes' },
    { id: 'trama', nombre: 'Trama y estructura' },
    { id: 'estilo', nombre: 'Estilo y técnica', banco: true },
    { id: 'gramatica', nombre: 'Gramática y ortografía', banco: true },
    { id: 'historia', nombre: 'Historia de la literatura y géneros' },
    { id: 'edicion', nombre: 'Edición y publicación' },
    { id: 'marketing', nombre: 'Marketing literario' },
    { id: 'proceso', nombre: 'Proceso y hábitos' }
  ];
  const categoria = id => CATEGORIAS.find(c => c.id === id);

  const $ = id => document.getElementById(id);
  const crear = (etiqueta, clase, texto) => {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  };

  // ---------- Utilidades ----------
  // Guarda en sessionStorage; si está bloqueado o lleno, se queda en memoria mientras la página siga abierta.
  function almacen(clave, inicial) {
    let memoria = inicial, soloMemoria = false;
    return {
      leer() {
        if (soloMemoria) return memoria;
        try { const v = sessionStorage.getItem(clave); return v === null ? inicial : JSON.parse(v); } catch (e) { return memoria; }
      },
      guardar(v) {
        memoria = v;
        try { sessionStorage.setItem(clave, JSON.stringify(v)); } catch (e) { soloMemoria = true; }
      }
    };
  }
  function azar(n) {
    if (window.crypto && crypto.getRandomValues) { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; }
    return Math.floor(Math.random() * n);
  }
  function barajar(lista) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = azar(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------- Fuente pública: el banco estático de cada categoría ----------
  function FuentePublica() {
    const bancos = {};                                  // categoría -> promesa con sus preguntas válidas
    const vistas = almacen('cueva-juego-vistas', {});   // { categoría: [ids] } ya salidos en esta sesión
    const servidas = {};                                // id -> { p, orden } de las preguntas ya mostradas
    let cat = null, porNivel = null, usadas = new Set(); // usadas: ids de esta partida

    const valida = p => p && typeof p.id === 'string' && NIVELES.includes(p.nivel) && typeof p.pregunta === 'string' &&
      Array.isArray(p.opciones) && p.opciones.length === 4 && p.opciones.every(o => typeof o === 'string') &&
      Number.isInteger(p.correcta) && p.correcta >= 0 && p.correcta < 4 && (!SOLO_REVISADAS || p.revisada === true);
    function descargar(c) {
      if (!bancos[c]) {
        bancos[c] = fetch('juego/banco/' + c + '.json').then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(datos => (Array.isArray(datos) ? datos : []).filter(valida));
        bancos[c].catch(() => { delete bancos[c]; }); // si falla, el siguiente intento vuelve a descargar
      }
      return bancos[c];
    }
    function leerVistas() {
      const v = vistas.leer();
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    function marcar(id) {
      const v = leerVistas();
      const l = Array.isArray(v[cat]) ? v[cat] : [];
      if (!l.includes(id)) { v[cat] = l.concat(id); vistas.guardar(v); }
    }
    // Vacía el registro de un nivel (salvo las preguntas de la partida en curso, que no pueden repetirse en ella).
    function vaciarNivel(nivel) {
      const v = leerVistas();
      const delNivel = new Set(porNivel[nivel].map(p => p.id));
      v[cat] = (Array.isArray(v[cat]) ? v[cat] : []).filter(id => !delNivel.has(id) || usadas.has(id));
      vistas.guardar(v);
    }
    function nuevas(nivel) {
      const v = new Set(leerVistas()[cat] || []);
      return porNivel[nivel].filter(p => !v.has(p.id) && !usadas.has(p.id));
    }

    return {
      // Prepara una partida. { jugable: false } si algún nivel tiene menos de 5 preguntas.
      async empezar(c) {
        const preguntas = await descargar(c);
        cat = c; usadas = new Set(); porNivel = {};
        NIVELES.forEach(n => { porNivel[n] = preguntas.filter(p => p.nivel === n); });
        const jugable = NIVELES.every(n => porNivel[n].length >= POR_NIVEL);
        // Si a un nivel no le quedan 5 preguntas nuevas, su registro empieza de cero.
        if (jugable) NIVELES.forEach(n => { if (nuevas(n).length < POR_NIVEL) vaciarNivel(n); });
        return { jugable };
      },
      // Una pregunta del nivel, con las opciones barajadas y sin decir cuál es la correcta.
      async pregunta(nivel) {
        let libres = nuevas(nivel);
        if (!libres.length) { vaciarNivel(nivel); libres = nuevas(nivel); }
        if (!libres.length) throw new Error('No quedan preguntas de este nivel');
        const p = libres[azar(libres.length)];
        usadas.add(p.id);
        marcar(p.id);
        const orden = barajar([0, 1, 2, 3]);
        servidas[p.id] = { p, orden };
        return { id: p.id, nivel, texto: p.pregunta, opciones: orden.map(i => p.opciones[i]) };
      },
      // indice: la posición elegida en pantalla, o null si se acabó el tiempo.
      async responder(id, indice) {
        const s = servidas[id];
        const bien = s.orden.indexOf(s.p.correcta);
        return { correcta: indice === bien, indiceCorrecto: bien, explicacion: typeof s.p.explicacion === 'string' ? s.p.explicacion : '' };
      },
      // Las dos posiciones incorrectas que se quitan.
      async cincuenta(id) {
        const s = servidas[id];
        const bien = s.orden.indexOf(s.p.correcta);
        return barajar([0, 1, 2, 3].filter(i => i !== bien)).slice(0, 2).sort();
      },
      // ¿Se puede cambiar la pregunta? Solo si, después de cambiarla, siguen quedando preguntas del nivel que no hayan
      // salido en esta partida para todas las que faltan (faltan: las que quedan de este nivel, contando la actual).
      async puedeSaltar(nivel, faltan) {
        return porNivel[nivel].filter(p => !usadas.has(p.id)).length >= faltan;
      }
    };
  }

  // ---------- Estantería: categorías ganadas en esta sesión del navegador ----------
  const Estanteria = (function () {
    const a = almacen('cueva-juego-estanteria', []);
    const lista = () => { const v = a.leer(); return Array.isArray(v) ? v.filter(c => categoria(c)) : []; };
    return {
      async leer() { return lista(); },
      async ganar(cat) {
        const l = lista();
        if (l.includes(cat)) return { nuevo: false };
        a.guardar(l.concat(cat));
        return { nuevo: true };
      }
    };
  })();

  // Libros-premio (juego/premios.json). Mientras no llegan (o si fallan), el lomo sale sin título: el color y el texto
  // para lectores de pantalla (la categoría) bastan.
  let premios = {};
  const premio = cat => premios[cat] || { titulo: '', autor: '', color: '#3E6F77' };
  function cargarPremios() {
    return fetch('juego/premios.json').then(r => r.ok ? r.json() : []).then(lista => {
      (Array.isArray(lista) ? lista : []).forEach(p => {
        if (!p || !categoria(p.categoria) || typeof p.titulo !== 'string') return;
        premios[p.categoria] = {
          titulo: p.titulo,
          autor: typeof p.autor === 'string' ? p.autor : '',
          color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#3E6F77'
        };
      });
    }).catch(() => {});
  }

  // ---------- Motor ----------
  const fuente = MODO === 'publico' ? FuentePublica() : null;
  const E = {
    pantalla: 'inicio',       // 'inicio' | 'partida' | 'resultado'
    categoria: null,
    cargando: null,           // categoría que se está preparando
    aviso: '',                // mensaje en la pantalla de inicio
    avisoCat: null,           // categoría a la que se refiere el aviso (se pinta justo debajo de ella)
    numero: 0,                // 1..15
    pregunta: null,           // { id, nivel, texto, opciones }
    quitadas: [],             // posiciones quitadas por el 50/50
    comodines: { cincuenta: true, saltar: true },
    puedeSaltar: false,
    inicio: 0,                // Date.now() al mostrar la pregunta
    restante: SEGUNDOS,
    avisados: [],
    ocupado: false,           // esperando a la fuente: no se aceptan clics
    respuesta: null,          // { elegida, correcta, indiceCorrecto, explicacion, agotado }
    final: null,              // { gano, nuevo } o { gano: false, llego, seguro, agotado }
    ganadas: []
  };
  const nivelDe = numero => NIVELES[Math.floor((numero - 1) / POR_NIVEL)];
  const seguroAntesDe = numero => SEGUROS.filter(s => s < numero).pop() || 0;

  let reloj = null;
  const restante = () => Math.max(0, Math.ceil((E.inicio + SEGUNDOS * 1000 - Date.now()) / 1000));
  function arrancarReloj() {
    pararReloj();
    E.inicio = Date.now();
    E.restante = SEGUNDOS;
    E.avisados = [];
    reloj = setInterval(tic, 250);
    pintarReloj();
  }
  function pararReloj() { clearInterval(reloj); reloj = null; }
  function tic() {
    if (!reloj) return;
    const r = restante();
    if (r !== E.restante) {
      E.restante = r;
      pintarReloj();
      // Solo se anuncia el último umbral cruzado (si la pestaña estuvo en pausa, pueden haberse cruzado varios).
      const cruzados = AVISOS_TIEMPO.filter(t => r <= t && !E.avisados.includes(t));
      if (cruzados.length) {
        E.avisados = E.avisados.concat(cruzados);
        if (r > 0) anunciar('Quedan ' + Math.min.apply(null, cruzados) + ' segundos.');
      }
    }
    if (r <= 0) responder(null);
  }
  document.addEventListener('visibilitychange', tic);

  async function empezar(cat) {
    if (E.cargando) return;
    E.cargando = cat; E.aviso = ''; E.avisoCat = cat;
    pintar();
    try {
      const r = await fuente.empezar(cat);
      if (!r.jugable) E.aviso = 'Esta categoría aún no tiene suficientes preguntas.';
      else {
        Object.assign(E, { categoria: cat, numero: 1, comodines: { cincuenta: true, saltar: true }, final: null });
        await nuevaPregunta();
        E.pantalla = 'partida';
      }
    } catch (e) {
      Object.assign(E, { pantalla: 'inicio', ocupado: false, aviso: 'No se han podido cargar las preguntas. Comprueba tu conexión y vuelve a intentarlo.' });
    }
    E.cargando = null;
    pintar();
    if (E.pantalla === 'partida') { arriba(); enfocar($('j-numero')); }
  }

  async function nuevaPregunta() {
    pararReloj();
    E.ocupado = true;
    const nivel = nivelDe(E.numero);
    E.pregunta = await fuente.pregunta(nivel);
    E.quitadas = []; E.respuesta = null;
    E.puedeSaltar = E.comodines.saltar && await fuente.puedeSaltar(nivel, POR_NIVEL - (E.numero - 1) % POR_NIVEL);
    E.ocupado = false;
    arrancarReloj();
  }

  // indice null = se acabó el tiempo.
  async function responder(indice) {
    if (E.pantalla !== 'partida' || E.ocupado || E.respuesta) return;
    if (indice !== null && restante() <= 0) indice = null;
    pararReloj();
    E.ocupado = true;
    pintar();
    try {
      const r = await fuente.responder(E.pregunta.id, indice);
      E.respuesta = Object.assign({ elegida: indice, agotado: indice === null }, r);
    } catch (e) { return abandonar(); }
    E.ocupado = false;
    if (E.respuesta.agotado) { E.restante = 0; pintarReloj(); }
    pintar();
    const v = E.respuesta.agotado ? 'Se acabó el tiempo.' : E.respuesta.correcta ? '¡Correcto!' : 'Incorrecto.';
    const correcta = E.respuesta.correcta ? '' : ' La respuesta correcta era la ' + LETRAS[E.respuesta.indiceCorrecto] + ': ' + E.pregunta.opciones[E.respuesta.indiceCorrecto] + '.';
    anunciar(v + correcta + ' ' + E.respuesta.explicacion);
    enfocar($('j-siguiente'), true);
  }

  async function siguiente() {
    if (!E.respuesta || E.ocupado) return;
    if (!E.respuesta.correcta) {
      E.final = { gano: false, llego: E.numero, seguro: seguroAntesDe(E.numero), agotado: E.respuesta.agotado };
      return terminar();
    }
    if (E.numero === TOTAL) {
      E.ocupado = true; // un segundo clic no vuelve a dar el premio
      const r = await Estanteria.ganar(E.categoria);
      E.ganadas = await Estanteria.leer();
      E.final = { gano: true, nuevo: r.nuevo };
      return terminar();
    }
    E.numero++;
    try { await nuevaPregunta(); } catch (e) { return abandonar(); }
    pintar();
    arriba();
    enfocar($('j-numero'));
  }

  function terminar() {
    pararReloj();
    E.pantalla = 'resultado';
    E.ocupado = false;
    pintar();
    arriba();
    anunciar($('j-res-t').textContent + ' ' + $('j-res-texto').textContent);
    enfocar($('j-res-t'));
  }

  // Si la fuente falla a mitad de partida (en la fase 3, el servidor), se vuelve al inicio con un aviso.
  function abandonar() {
    pararReloj();
    Object.assign(E, { pantalla: 'inicio', ocupado: false, respuesta: null, avisoCat: null, aviso: 'Ha habido un problema y la partida se ha interrumpido. Vuelve a intentarlo.' });
    pintar();
    arriba();
    enfocar($('j-categorias-t'));
  }

  async function usarCincuenta() {
    if (!E.comodines.cincuenta || E.ocupado || E.respuesta) return;
    E.comodines.cincuenta = false;
    E.ocupado = true;
    try { E.quitadas = await fuente.cincuenta(E.pregunta.id); } catch (e) { return abandonar(); }
    E.ocupado = false;
    pintar();
    anunciar('Se han quitado las respuestas ' + E.quitadas.map(i => LETRAS[i]).join(' y ') + '.');
    const primera = $('j-opciones').querySelector('button:not(:disabled)');
    if (primera) enfocar(primera, true);
  }

  async function usarSaltar() {
    if (!E.comodines.saltar || !E.puedeSaltar || E.ocupado || E.respuesta) return;
    E.comodines.saltar = false;
    pararReloj();
    try { await nuevaPregunta(); } catch (e) { return abandonar(); }
    pintar();
    anunciar('Pregunta cambiada.');
    enfocar($('j-numero'));
  }

  function volverAlInicio() {
    pararReloj();
    Object.assign(E, { pantalla: 'inicio', aviso: '', respuesta: null, final: null });
    pintar();
    arriba();
    enfocar($('j-estanteria-t'));
  }

  // ---------- Pantallas ----------
  function anunciar(texto) {
    const el = $('j-anuncio');
    el.textContent = '';
    setTimeout(() => { el.textContent = texto; }, 50);
  }
  function enfocar(el, conScroll) { if (el && !el.hidden) el.focus({ preventScroll: !conScroll }); }
  function arriba() { window.scrollTo(0, 0); }

  function lomo(cat, ganado, grande) {
    const li = crear(grande ? 'div' : 'li', 'j-lomo' + (ganado ? '' : ' j-hueco') + (grande ? ' j-lomo-grande' : ''));
    const c = categoria(cat);
    if (ganado) {
      const p = premio(cat);
      li.style.setProperty('--lomo', p.color);
      if (p.titulo) li.appendChild(crear('span', 'j-lomo-titulo', p.titulo));
      if (p.autor) li.appendChild(crear('span', 'j-lomo-autor', p.autor));
      li.appendChild(crear('span', 'perfil-sr', ' (premio de ' + c.nombre + ')'));
    } else {
      li.appendChild(crear('span', 'perfil-sr', 'Hueco libre: ' + c.nombre));
    }
    return li;
  }

  function pintarEstante() {
    const libros = $('j-libros');
    libros.textContent = '';
    CATEGORIAS.forEach(c => libros.appendChild(lomo(c.id, E.ganadas.includes(c.id))));
    const n = E.ganadas.length;
    $('j-cuenta').textContent = n + ' de ' + CATEGORIAS.length;
    libros.setAttribute('aria-label', 'Tu estantería: ' + n + (n === 1 ? ' libro' : ' libros') + ' de ' + CATEGORIAS.length);
  }

  function pintarInicio() {
    pintarEstante();

    const aviso = $('j-aviso');

    const lista = $('j-categorias');
    lista.before(aviso); // el aviso puede haberse quedado dentro de la lista (debajo de una categoría)
    const conFoco = lista.contains(document.activeElement) ? document.activeElement.dataset.cat : null;
    lista.textContent = '';
    CATEGORIAS.forEach(c => {
      const b = crear('button', 'item j-cat-btn');
      b.type = 'button';
      b.dataset.cat = c.id;
      const ic = crear('span', 'ic');
      ic.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v13"/></svg>';
      const tx = crear('span', 'tx');
      tx.appendChild(crear('b', null, c.nombre));
      b.append(ic, tx);
      if (!c.banco) {
        b.classList.add('off');
        b.disabled = true;
        b.appendChild(crear('span', 'pronto', 'Próximamente'));
      } else if (E.cargando === c.id) {
        tx.appendChild(crear('small', null, 'Preparando las preguntas…'));
        b.setAttribute('aria-busy', 'true');
      } else {
        tx.appendChild(crear('small', null, E.ganadas.includes(c.id) ? 'Superada. Puedes volver a jugarla.' : '15 preguntas'));
        if (E.ganadas.includes(c.id)) b.classList.add('j-ganada');
      }
      lista.appendChild(b);
    });
    if (conFoco) { const b = lista.querySelector('[data-cat="' + conFoco + '"]'); if (b) b.focus({ preventScroll: true }); }
    const ancla = E.aviso && E.avisoCat && lista.querySelector('[data-cat="' + E.avisoCat + '"]');
    if (ancla) ancla.after(aviso);
    // El texto se pone después de colocarlo, para que el lector de pantalla lo anuncie (role="alert").
    aviso.textContent = E.aviso;
    aviso.hidden = !E.aviso;
  }

  function pintarReloj() {
    $('j-segundos').textContent = E.restante;
    $('j-arco').style.strokeDashoffset = String(1 - E.restante / SEGUNDOS);
    $('j-reloj').classList.toggle('poco', E.restante <= 10);
  }

  function pintarPartida() {
    const nivel = nivelDe(E.numero);
    $('j-cat').textContent = categoria(E.categoria).nombre;
    $('j-numero').textContent = 'Pregunta ' + E.numero + ' de ' + TOTAL;
    $('j-nivel').textContent = { facil: 'Nivel fácil', media: 'Nivel medio', dificil: 'Nivel difícil' }[nivel] + (SEGUROS.includes(E.numero) ? ' · Punto seguro' : '');
    $('j-nivel').dataset.nivel = nivel;

    const escalera = $('j-escalera');
    if (!escalera.children.length) {
      for (let i = 1; i <= TOTAL; i++) {
        const li = crear('li', SEGUROS.includes(i) ? 'segura' : '');
        li.appendChild(crear('span', 'j-esc-num', String(i)));
        li.appendChild(crear('span', 'j-esc-nivel', NOMBRE_NIVEL[nivelDe(i)]));
        escalera.appendChild(li);
      }
    }
    Array.from(escalera.children).forEach((li, i) => {
      const n = i + 1;
      li.classList.toggle('hecha', n < E.numero || (n === E.numero && !!E.respuesta && E.respuesta.correcta));
      li.classList.toggle('actual', n === E.numero);
      li.classList.toggle('fallada', n === E.numero && !!E.respuesta && !E.respuesta.correcta);
    });

    $('j-enunciado').textContent = E.pregunta.texto;

    const r = E.respuesta;
    const opciones = $('j-opciones');
    opciones.textContent = '';
    E.pregunta.opciones.forEach((texto, i) => {
      const b = crear('button', 'j-opcion');
      b.type = 'button';
      b.dataset.i = i;
      b.appendChild(crear('span', 'j-letra', LETRAS[i]));
      b.appendChild(crear('span', 'j-op-texto', texto));
      const quitada = E.quitadas.includes(i);
      let nota = '';
      if (quitada) { b.classList.add('quitada'); nota = ' (quitada por el 50/50)'; }
      if (r) {
        if (i === r.indiceCorrecto) { b.classList.add('ok'); nota = ' (respuesta correcta)'; }
        else if (i === r.elegida) { b.classList.add('mal'); nota = ' (tu respuesta)'; }
      }
      if (nota) b.appendChild(crear('span', 'perfil-sr', nota));
      b.disabled = quitada || !!r || E.ocupado;
      opciones.appendChild(b);
    });

    const c50 = $('j-cincuenta'), cs = $('j-saltar');
    c50.disabled = !E.comodines.cincuenta || E.ocupado;
    $('j-cincuenta-txt').textContent = E.comodines.cincuenta ? 'Quita dos incorrectas' : 'Ya usado';
    cs.disabled = !E.comodines.saltar || !E.puedeSaltar || E.ocupado;
    $('j-saltar-txt').textContent = !E.comodines.saltar ? 'Ya usado' : E.puedeSaltar ? 'Otra del mismo nivel' : 'No quedan más de este nivel';
    $('j-comodines').hidden = !!r;

    const tras = $('j-tras');
    tras.hidden = !r;
    if (r) {
      tras.classList.toggle('bien', r.correcta);
      $('j-veredicto').textContent = r.agotado ? 'Se acabó el tiempo' : r.correcta ? '¡Correcto!' : 'Incorrecto';
      $('j-explicacion').textContent = r.explicacion;
      $('j-siguiente').textContent = !r.correcta ? 'Ver resultado' : E.numero === TOTAL ? 'Ver tu premio' : 'Siguiente pregunta';
    }
    pintarReloj();
  }

  function pintarResultado() {
    const f = E.final, c = categoria(E.categoria);
    const libro = $('j-res-libro');
    libro.textContent = '';
    $('j-res').classList.toggle('gano', f.gano);
    if (f.gano) {
      const p = premio(E.categoria);
      $('j-res-t').textContent = '¡Lo has conseguido!';
      const nombre = p.titulo ? '«' + p.titulo + '»' + (p.autor ? ' de ' + p.autor : '') : 'el libro de esta categoría';
      $('j-res-texto').textContent = 'Has acertado las 15 preguntas de ' + c.nombre + '. ' +
        (f.nuevo ? 'Tu premio, ' + nombre + ', ya está en tu estantería.' : 'Ya tenías ' + nombre + ' en tu estantería.');
      libro.appendChild(lomo(E.categoria, true, true));
    } else {
      $('j-res-t').textContent = f.agotado ? 'Se acabó el tiempo' : 'Fin de la partida';
      $('j-res-texto').textContent = 'Llegaste a la pregunta ' + f.llego + ' (último punto seguro: ' + (f.seguro || 'ninguno') + ').';
    }
  }

  function pintar() {
    ['inicio', 'partida', 'resultado'].forEach(p => { $('j-' + p).hidden = E.pantalla !== p; });
    document.body.classList.toggle('j-jugando', E.pantalla === 'partida');
    if (E.pantalla === 'inicio') pintarInicio();
    else if (E.pantalla === 'partida') pintarPartida();
    else pintarResultado();
  }

  // ---------- Eventos ----------
  $('j-categorias').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]');
    if (b && !b.disabled) empezar(b.dataset.cat);
  });
  $('j-opciones').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b && !b.disabled) responder(+b.dataset.i);
  });
  $('j-cincuenta').addEventListener('click', usarCincuenta);
  $('j-saltar').addEventListener('click', usarSaltar);
  $('j-siguiente').addEventListener('click', siguiente);
  $('j-otra').addEventListener('click', () => { const c = E.categoria; volverAlInicio(); empezar(c); });
  $('j-cambiar').addEventListener('click', volverAlInicio);

  if (!fuente) return;
  // Se pinta en cuanto se lee la estantería; cuando llegan los premios, se repinta solo la estantería.
  Estanteria.leer().then(ganadas => {
    E.ganadas = ganadas;
    pintar();
    cargarPremios().then(() => { if (E.pantalla === 'inicio') pintarEstante(); });
  });
})();
