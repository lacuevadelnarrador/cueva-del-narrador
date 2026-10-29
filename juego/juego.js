// JUEGO «¿Estás preparado para ser escritor?» (quiz.html)
// Dos modos con el mismo motor y las mismas pantallas:
// - Público (sin sesión de socio): todo en el navegador, con los JSON estáticos de juego/banco/ (solo las preguntas
//   públicas). Ni el motor ni la fuente llaman a ningún servidor.
// - Socios (sesión con la cuenta activa, según Cueva.sesionActiva): las preguntas del club, la respuesta correcta, el
//   tiempo oficial, los libros y el ranking los lleva el servidor (funciones juego_* de Supabase). El navegador no
//   conoce la respuesta correcta hasta que responde. Si el servidor no está disponible al empezar, se juega en modo
//   público con el aviso de que la partida no cuenta para el ranking; si falla a mitad de partida, se abandona con aviso.
//
// Piezas separadas:
// - Fuente de preguntas: empezar, pregunta, saltar, responder, cincuenta, puedeSaltar y abandonar (y, en socios,
//   reportar y ranking). Todo devuelve promesas y la pregunta llega SIN la respuesta correcta.
// - Logros de cada fuente (estanteria): leer, mejor y anotar. Cada categoría da tres insignias: bronce al superar la
//   pregunta 5, plata en la 10 y oro + el libro en la 15 (pública: sessionStorage o memoria; socios: el servidor).
// - Motor: un único objeto de estado (E) y funciones que lo cambian; cada cambio acaba en pintar().
// - Lomos, insignias, categorías y premios: juego/estante.js (los comparte el perfil).
// Flujo de una pregunta: se responde → explicación (y, en la 5 y la 10, la pantalla de la insignia) → «Seguir» pide
// la siguiente pregunta (en socios, juego_siguiente) y SOLO entonces empieza su cuenta atrás, en pantalla y en el
// servidor. Si esa petición falla por red, el botón sigue ahí para reintentar y no corre ningún tiempo.
// El contador de pantalla se mide con la hora (Date.now() contra la hora de inicio de la pregunta), no contando ticks,
// y se para mientras se ve la explicación. En modo socios es solo visual: el tiempo que cuenta lo mide el servidor.
(function () {
  'use strict';

  const SOLO_REVISADAS = false;   // true: solo se usan las preguntas con "revisada": true (modo público)
  const SEGUNDOS = 45;
  const POR_NIVEL = 5;
  const NIVELES = ['facil', 'media', 'dificil'];
  const NOMBRE_NIVEL = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };
  const TOTAL = POR_NIVEL * NIVELES.length;
  const SEGUROS = [5, 10];        // puntos seguros: insignia de bronce (5) y de plata (10)
  const AVISOS_TIEMPO = [30, 10, 5];
  const LETRAS = ['A', 'B', 'C', 'D'];
  const { CATEGORIAS, categoria, crear } = Estante;
  // Mensajes de error del servidor (modo socios) que se pueden mostrar tal cual o usar para decidir qué hacer.
  const CATEGORIA_NO_DISPONIBLE = 'Esa categoría no está disponible.';
  const YA_SALTADA = 'Ya has saltado una pregunta en esta partida.';
  const CINCUENTA_USADO = 'El 50/50 ya se ha usado.';
  const MENSAJES_SERVIDOR = ['Esa pregunta ya está respondida.', 'La partida ya no está en curso.', 'Tu cuenta no está activa.',
    CATEGORIA_NO_DISPONIBLE, YA_SALTADA, CINCUENTA_USADO];
  const mensajeServidor = e => e && MENSAJES_SERVIDOR.includes(e.message) ? e.message : null;

  const $ = id => document.getElementById(id);

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
    async function pregunta(nivel) {
      let libres = nuevas(nivel);
      if (!libres.length) { vaciarNivel(nivel); libres = nuevas(nivel); }
      if (!libres.length) throw new Error('No quedan preguntas de este nivel');
      const p = libres[azar(libres.length)];
      usadas.add(p.id);
      marcar(p.id);
      const orden = barajar([0, 1, 2, 3]);
      servidas[p.id] = { p, orden };
      return { id: p.id, nivel, texto: p.pregunta, opciones: orden.map(i => p.opciones[i]) };
    }

    return {
      modo: 'publico',
      estanteria: EstanteriaPublica,
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
      pregunta,
      saltar: pregunta,
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
      },
      abandonar() {}
    };
  }

  // Logros públicos: { categoría: nivel más alto } en esta sesión del navegador. Sin tiempos (no hay servidor).
  // La versión anterior guardaba una lista de categorías con libro: se lee como oro (nivel 3).
  const EstanteriaPublica = (function () {
    const a = almacen('cueva-juego-logros', null);
    const viejo = almacen('cueva-juego-estanteria', []);
    function mapa() {
      const v = a.leer();
      const m = {};
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        CATEGORIAS.forEach(c => { const n = v[c.id] | 0; if (n > 0) m[c.id] = Math.min(3, n); });
      } else {
        const l = viejo.leer();
        (Array.isArray(l) ? l : []).forEach(c => { if (categoria(c)) m[c] = 3; });
      }
      return m;
    }
    return {
      async leer() { return mapa(); },
      mejor() { return null; },
      // Guarda el nivel (si es mejor que el que había) y devuelve el logro con la misma forma que el servidor.
      async anotar(cat, nivel) {
        const m = mapa();
        const nuevo = (m[cat] | 0) < nivel;
        if (nuevo) { m[cat] = nivel; a.guardar(m); }
        return { nivel, insignia: Estante.INSIGNIAS[nivel], nuevo, mejor_marca: false, mejor_tiempo_ms: null };
      }
    };
  })();

  // ---------- Fuente de socios: funciones juego_* del servidor (scripts 32 y 33) ----------
  // juego_iniciar_partida(p_categoria)  → { partida_id, numero, nivel, pregunta, puede_saltar }  (empieza su reloj)
  // juego_responder(p_partida_id, p_pregunta_id, p_opcion | null)
  //   → { correcta, opcion_correcta, explicacion, agotado, numero, tiempo_ms, tiempo_total_ms, fin, siguiente: null,
  //       hay_siguiente }
  //   numero: el de la pregunta que se acaba de responder. La siguiente ya NO viene aquí: hay_siguiente es true cuando
  //   se acierta y no es la 15; false en derrota y premio.
  //   fin: null | 'hito' (5 y 10) | 'derrota' | 'premio' (15).
  //   En 'hito' y 'premio': logro { nivel 1|2|3, insignia 'bronce'|'plata'|'oro', nuevo, mejor_marca, mejor_tiempo_ms }.
  //   En 'premio', además, nuevo_libro (solo si el oro es nuevo), mejor_marca y mejor_tiempo_ms en el nivel superior.
  //   En 'derrota': asegurado (0, 1 o 2 = niveles ya guardados en esa partida); sin logro.
  //   tiempo_total_ms: suma de lo que se tardó en cada pregunta servida, incluida la saltada, con un máximo de 45 s por
  //   pregunta; lo mide el servidor. Es el que se muestra en el resultado.
  // juego_siguiente(p_partida_id)       → { numero, nivel, pregunta, puede_saltar }. El reloj de esa pregunta empieza
  //                                       cuando el servidor la sirve, es decir, al llamarla (al pulsar «Seguir»).
  //                                       Antes de pedirla, 50/50 y Saltar responden «Pide primero la siguiente pregunta».
  //                                       Si se vuelve a llamar con la pregunta ya servida y sin responder (script 34),
  //                                       devuelve la MISMA (mismas opciones y orden), sin reiniciar su reloj, y añade
  //                                       reintento: true, transcurrido_ms (desde que se sirvió, máx. 45000) y quitadas
  //                                       (las del 50/50 si ya se usó; [] si no).
  // juego_cincuenta(p_partida_id)       → { quitadas: [i, j] }
  // juego_saltar(p_partida_id)          → { numero, nivel, pregunta, puede_saltar: false } (el tiempo de la saltada cuenta)
  // juego_abandonar(p_partida_id)       → nada (no falla si la partida ya terminó)
  // juego_mis_logros()                  → una fila por categoría y nivel: [{ categoria, nivel, ganado_en, mejor_tiempo_ms }]
  //                                       (temporada actual)
  // juego_ranking()                     → [{ nombre_pila, foto_mini, logros, libros, bronces, platas, tiempo_total_ms,
  //                                       es_yo }], ya ordenadas por logros (desc) y tiempo (asc); máximo 30 logros
  // juego_reportar_pregunta(p_pregunta_id, p_motivo, p_detalle)
  //   p_motivo: respuesta_incorrecta | enunciado_confuso | errata | otra; p_detalle: hasta 300 caracteres (o null).
  // pregunta = { id, texto, opciones: [4 textos ya barajados] }; las posiciones (p_opcion, opcion_correcta, quitadas)
  // son siempre las de la pantalla. El tiempo agotado llega como un fallo normal (agotado: true, fin: 'derrota').
  // Rechazos de los comodines: «Ya has saltado una pregunta en esta partida.» y «El 50/50 ya se ha usado.». Con ellos la
  // partida sigue con la misma pregunta y el comodín queda como usado (ver usarSaltar y usarCincuenta).
  // Si una respuesta no tiene la forma esperada se lanza un error FormatoServidor que dice qué función y qué campo
  // fallan (sin datos de la pregunta ni del socio): sale en la consola al abandonar la partida.
  const formato = texto => Object.assign(new Error(texto), { name: 'FormatoServidor' });
  function FuenteSocios(sb) {
    let partida = null, pendiente = null, saltable = false;
    let logros = {}, tiempos = {};   // { categoría: nivel más alto }, { categoría: { nivel: mejor_tiempo_ms } }
    async function llamar(nombre, args) {
      const r = await sb.rpc(nombre, args);
      if (r.error) throw r.error;
      return r.data;
    }
    // Lo que llega del servidor se comprueba antes de pintarlo. donde: qué función y qué campo, para el registro.
    function limpia(p, nivel, donde) {
      if (!p || typeof p !== 'object') throw formato(donde + ': falta la pregunta');
      if (p.id == null) throw formato(donde + ': la pregunta no tiene id');
      if (typeof p.texto !== 'string') throw formato(donde + ': la pregunta no tiene texto');
      if (!Array.isArray(p.opciones) || p.opciones.length !== 4 || !p.opciones.every(o => typeof o === 'string')) throw formato(donde + ': las opciones no son 4 textos');
      return { id: String(p.id), nivel, texto: p.texto, opciones: p.opciones.slice() };
    }
    function limpiaLogro(l, nivelEsperado) {
      if (!l || typeof l !== 'object' || !Number.isInteger(l.nivel) || l.nivel < 1 || l.nivel > 3) throw formato('juego_responder: logro mal formado');
      if (nivelEsperado && l.nivel !== nivelEsperado) throw formato('juego_responder: logro.nivel no corresponde a la pregunta');
      return { nivel: l.nivel, insignia: Estante.INSIGNIAS[l.nivel], nuevo: l.nuevo === true, mejor_marca: l.mejor_marca === true,
        mejor_tiempo_ms: Number.isFinite(l.mejor_tiempo_ms) ? l.mejor_tiempo_ms : null };
    }
    const estanteria = {
      async leer() {
        const filas = await llamar('juego_mis_logros');
        logros = {}; tiempos = {};
        (Array.isArray(filas) ? filas : []).forEach(f => {
          if (!f || !categoria(f.categoria) || !Number.isInteger(f.nivel) || f.nivel < 1 || f.nivel > 3) return;
          logros[f.categoria] = Math.max(logros[f.categoria] | 0, f.nivel);
          (tiempos[f.categoria] || (tiempos[f.categoria] = {}))[f.nivel] = Number.isFinite(f.mejor_tiempo_ms) ? f.mejor_tiempo_ms : null;
        });
        return Object.assign({}, logros);
      },
      // Mejor tiempo del nivel más alto conseguido en la categoría.
      mejor(cat) { const n = logros[cat] | 0; const t = n && tiempos[cat] ? tiempos[cat][n] : null; return Number.isFinite(t) ? t : null; },
      // El servidor ya ha guardado el logro al responder: aquí solo se apunta para pintar sin volver a pedirlo.
      async anotar(cat, logro) {
        logros[cat] = Math.max(logros[cat] | 0, logro.nivel);
        if (Number.isFinite(logro.mejor_tiempo_ms)) (tiempos[cat] || (tiempos[cat] = {}))[logro.nivel] = logro.mejor_tiempo_ms;
        return logro;
      }
    };
    return {
      modo: 'socios',
      estanteria,
      async empezar(cat) {
        const d = await llamar('juego_iniciar_partida', { p_categoria: cat });
        if (!d || d.partida_id == null) throw formato('juego_iniciar_partida: falta partida_id');
        partida = d.partida_id;
        pendiente = limpia(d.pregunta, d.nivel || 'facil', 'juego_iniciar_partida.pregunta');
        saltable = d.puede_saltar === true;
        return { jugable: true };
      },
      // La primera pregunta llegó al iniciar; las demás se piden al pulsar «Seguir» (y su reloj empieza entonces).
      async pregunta(nivel) {
        if (pendiente) { const p = pendiente; pendiente = null; p.nivel = nivel; return p; }
        const d = await llamar('juego_siguiente', { p_partida_id: partida });
        if (!d || typeof d !== 'object') throw formato('juego_siguiente: respuesta vacía');
        saltable = d.puede_saltar === true;
        const p = limpia(d.pregunta, nivel, 'juego_siguiente.pregunta');
        // Reintento (script 34): la pregunta ya estaba servida (se perdió la respuesta anterior). Es la misma, con su
        // reloj en marcha desde entonces y, si ya se usó el 50/50, las opciones que quitó.
        if (d.reintento === true) {
          const t = Number(d.transcurrido_ms);
          p.transcurridoMs = Number.isFinite(t) ? Math.min(Math.max(t, 0), SEGUNDOS * 1000) : 0;
          const q = Array.isArray(d.quitadas) ? d.quitadas.filter(i => Number.isInteger(i) && i >= 0 && i < 4) : [];
          if (q.length !== 0 && q.length !== 2) throw formato('juego_siguiente: quitadas no son 0 ni 2 posiciones de 0-3');
          p.quitadas = q.sort();
        }
        return p;
      },
      async saltar(nivel) {
        const d = await llamar('juego_saltar', { p_partida_id: partida });
        saltable = !!d && d.puede_saltar === true;
        return limpia(d && d.pregunta, nivel, 'juego_saltar.pregunta');
      },
      async puedeSaltar() { return saltable; },
      async responder(id, indice, numero) {
        const d = await llamar('juego_responder', { p_partida_id: partida, p_pregunta_id: id, p_opcion: indice });
        if (!d || typeof d !== 'object') throw formato('juego_responder: respuesta vacía');
        if (typeof d.correcta !== 'boolean') throw formato('juego_responder: correcta no es true/false');
        if (!Number.isInteger(d.opcion_correcta) || d.opcion_correcta < 0 || d.opcion_correcta > 3) throw formato('juego_responder: opcion_correcta fuera de 0-3');
        if (d.fin != null && !['hito', 'derrota', 'premio'].includes(d.fin)) throw formato('juego_responder: fin desconocido');
        const termina = d.fin === 'premio' || d.fin === 'derrota';
        if (termina) partida = null;
        else if (d.hay_siguiente !== true) throw formato('juego_responder: hay_siguiente no es true y la partida sigue');
        const r = {
          correcta: d.correcta, indiceCorrecto: d.opcion_correcta, explicacion: typeof d.explicacion === 'string' ? d.explicacion : '',
          agotado: d.agotado === true, fin: d.fin || null,
          tiempoMs: Number.isFinite(d.tiempo_total_ms) ? d.tiempo_total_ms : null
        };
        if (d.fin === 'hito' || d.fin === 'premio') {
          r.logro = limpiaLogro(d.logro, d.fin === 'premio' ? 3 : SEGUROS.indexOf(numero) + 1 || null);
        }
        if (d.fin === 'premio') {
          r.nuevoLibro = d.nuevo_libro === true;
          r.mejorMarca = d.mejor_marca === true;
          r.mejorMs = Number.isFinite(d.mejor_tiempo_ms) ? d.mejor_tiempo_ms : null;
        }
        if (d.fin === 'derrota') r.asegurado = Number.isInteger(d.asegurado) && d.asegurado >= 0 && d.asegurado <= 2 ? d.asegurado : 0;
        return r;
      },
      async cincuenta() {
        const d = await llamar('juego_cincuenta', { p_partida_id: partida });
        const q = (d && Array.isArray(d.quitadas) ? d.quitadas : []).filter(i => Number.isInteger(i) && i >= 0 && i < 4);
        if (q.length !== 2) throw formato('juego_cincuenta: quitadas no son 2 posiciones de 0-3');
        return q.sort();
      },
      // Al salir de la página o si algo falla. Sin esperar: si no llega, la siguiente partida cancela esta.
      abandonar() {
        if (partida == null) return;
        const id = partida; partida = null;
        Promise.resolve().then(() => sb.rpc('juego_abandonar', { p_partida_id: id })).catch(() => {});
      },
      reportar: (id, motivo, detalle) => llamar('juego_reportar_pregunta', { p_pregunta_id: id, p_motivo: motivo, p_detalle: detalle || null }),
      ranking: () => llamar('juego_ranking')
    };
  }

  // ---------- Motor ----------
  let fuente = FuentePublica();
  const E = {
    pantalla: 'inicio',       // 'inicio' | 'partida' | 'hito' (insignia de la 5 o la 10) | 'resultado'
    vista: 'jugar',           // en el inicio de los socios: 'jugar' | 'ranking'
    preparando: false,        // comprobando si hay sesión de socio
    libre: false,             // hay sesión pero se juega en modo público: no cuenta para el ranking
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
    errorSeguir: '',          // no se ha podido pedir la siguiente pregunta (red): se puede reintentar
    respuesta: null,          // { elegida, correcta, indiceCorrecto, explicacion, agotado, fin, logro, asegurado, ... }
    final: null,              // { gano: true, logro, nuevoLibro, tiempoMs, mejorMs, mejorMarca }
                              // o { gano: false, llego, seguro, agotado, asegurado }
    logros: {},               // { categoría: nivel más alto (1 bronce, 2 plata, 3 oro + libro) }
    reportadas: new Set()
  };
  const nivelDe = numero => NIVELES[Math.floor((numero - 1) / POR_NIVEL)];
  const seguroAntesDe = numero => SEGUROS.filter(s => s < numero).pop() || 0;
  const socios = () => fuente.modo === 'socios';
  const nombreInsignia = n => Estante.INSIGNIAS[n];

  let reloj = null;
  const restante = () => Math.max(0, Math.ceil((E.inicio + SEGUNDOS * 1000 - Date.now()) / 1000));
  // transcurrido: ms ya gastados en esta pregunta (reintento de juego_siguiente); la cuenta atrás sigue desde ahí.
  function arrancarReloj(transcurrido) {
    pararReloj();
    E.inicio = Date.now() - (transcurrido || 0);
    E.restante = restante();
    E.avisados = AVISOS_TIEMPO.filter(t => E.restante <= t); // no se anuncian los avisos que ya habían pasado
    reloj = setInterval(tic, 250);
    pintarReloj();
    if (E.restante <= 0) tic();
  }
  function pararReloj() { clearInterval(reloj); reloj = null; }
  // Sigue contando la misma pregunta (sin volver a 45): tras un Saltar que el servidor no ha permitido.
  function seguirReloj() { pararReloj(); reloj = setInterval(tic, 250); tic(); }
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

  // Pasa al modo público (sin servidor): las partidas no cuentan para el ranking.
  async function pasarALibre() {
    fuente = FuentePublica();
    E.libre = true;
    E.vista = 'jugar';
    E.logros = await fuente.estanteria.leer();
  }

  async function empezar(cat) {
    if (E.cargando || E.preparando) return;
    E.cargando = cat; E.aviso = ''; E.avisoCat = cat;
    pintar();
    let r = null, noDisponible = false;
    try {
      r = await fuente.empezar(cat);
    } catch (e) {
      // Socios: si el servidor no responde (o la cuenta ya no está activa), se juega igual, en modo público y avisando.
      // Si la categoría no está disponible en el servidor, se avisa y se sigue en modo socios.
      if (socios()) {
        { const m = motivoError(e); Cueva.registrar('No se ha podido iniciar la partida en el servidor' + (m ? ': ' + m : ''), e); }
        if (mensajeServidor(e) === CATEGORIA_NO_DISPONIBLE) noDisponible = true;
        else {
          await pasarALibre();
          try { r = await fuente.empezar(cat); } catch (e2) { r = null; }
        }
      }
    }
    try {
      if (noDisponible) E.aviso = CATEGORIA_NO_DISPONIBLE;
      else if (!r) throw new Error('Sin banco');
      else if (!r.jugable) E.aviso = 'Esta categoría aún no tiene suficientes preguntas.';
      else {
        Object.assign(E, { categoria: cat, numero: 0, comodines: { cincuenta: true, saltar: true }, final: null, errorSeguir: '' });
        await nuevaPregunta(false, 1);
        E.pantalla = 'partida';
      }
    } catch (e) {
      Object.assign(E, { pantalla: 'inicio', ocupado: false, aviso: 'No se han podido cargar las preguntas. Comprueba tu conexión y vuelve a intentarlo.' });
    }
    E.cargando = null;
    pintar();
    if (E.pantalla === 'partida') { arriba(); enfocar($('j-numero')); }
  }

  // Trae la pregunta número «numero» (o, con saltando, la que sustituye a la actual) y arranca su cuenta atrás.
  // Si falla, el estado no cambia (sigue la explicación o la insignia, sin reloj): quien llama decide qué hacer.
  async function nuevaPregunta(saltando, numero) {
    if (numero == null) numero = E.numero;
    pararReloj();
    E.ocupado = true;
    const nivel = nivelDe(numero);
    try {
      E.pregunta = await (saltando ? fuente.saltar(nivel) : fuente.pregunta(nivel));
    } catch (e) { E.ocupado = false; throw e; }
    E.numero = numero;
    E.respuesta = null; E.errorSeguir = '';
    // En un reintento, la pregunta trae lo que ya había pasado: las opciones quitadas por el 50/50 y el tiempo gastado.
    E.quitadas = Array.isArray(E.pregunta.quitadas) ? E.pregunta.quitadas.slice() : [];
    if (E.quitadas.length) E.comodines.cincuenta = false;
    E.puedeSaltar = E.comodines.saltar && await fuente.puedeSaltar(nivel, POR_NIVEL - (numero - 1) % POR_NIVEL);
    E.ocupado = false;
    arrancarReloj(E.pregunta.transcurridoMs || 0);
  }

  // indice null = se acabó el tiempo.
  async function responder(indice) {
    if (E.pantalla !== 'partida' || E.ocupado || E.respuesta) return;
    if (indice !== null && restante() <= 0) indice = null;
    pararReloj();
    E.ocupado = true;
    pintar();
    try {
      const r = await fuente.responder(E.pregunta.id, indice, E.numero);
      const R = Object.assign({ elegida: indice }, r, { agotado: indice === null || r.agotado === true });
      if (!socios()) {
        // Público: el final y los logros los decide el motor (el servidor de los socios los manda hechos).
        const nivel = E.numero === TOTAL ? 3 : SEGUROS.indexOf(E.numero) + 1;
        if (!R.correcta) { R.fin = 'derrota'; R.asegurado = SEGUROS.filter(s => s < E.numero).length; }
        else if (nivel > 0) {
          R.fin = nivel === 3 ? 'premio' : 'hito';
          R.logro = await fuente.estanteria.anotar(E.categoria, nivel);
          if (nivel === 3) R.nuevoLibro = R.logro.nuevo;
        } else R.fin = null;
      } else if (R.logro) await fuente.estanteria.anotar(E.categoria, R.logro);
      if (R.logro) E.logros[E.categoria] = Math.max(E.logros[E.categoria] | 0, R.logro.nivel);
      E.respuesta = R;
    } catch (e) { return abandonar(e); }
    E.ocupado = false;
    if (E.respuesta.agotado) { E.restante = 0; pintarReloj(); }
    pintar();
    const v = E.respuesta.agotado ? 'Se acabó el tiempo.' : E.respuesta.correcta ? '¡Correcto!' : 'Incorrecto.';
    const correcta = E.respuesta.correcta ? '' : ' La respuesta correcta era la ' + LETRAS[E.respuesta.indiceCorrecto] + ': ' + E.pregunta.opciones[E.respuesta.indiceCorrecto] + '.';
    anunciar(v + correcta + ' ' + E.respuesta.explicacion);
    enfocar($('j-siguiente'), true);
  }

  // Botón principal de la explicación: resultado, premio, insignia (5 y 10) o siguiente pregunta.
  async function siguiente() {
    if (!E.respuesta || E.ocupado) return;
    const r = E.respuesta;
    if (r.fin === 'derrota') {
      E.final = { gano: false, llego: E.numero, seguro: seguroAntesDe(E.numero), agotado: r.agotado, asegurado: r.asegurado | 0 };
      return terminar();
    }
    if (r.fin === 'premio') {
      E.final = { gano: true, logro: r.logro, nuevoLibro: r.nuevoLibro === true, tiempoMs: r.tiempoMs, mejorMs: r.mejorMs, mejorMarca: r.mejorMarca === true };
      return terminar();
    }
    if (r.fin === 'hito' && r.logro) return mostrarHito();
    return seguir();
  }

  // Pantalla de la insignia de la pregunta 5 o 10. «Seguir» pide la siguiente pregunta.
  function mostrarHito() {
    E.pantalla = 'hito';
    E.errorSeguir = '';
    pintar();
    arriba();
    anunciar($('j-hito-t').textContent + ' ' + $('j-hito-texto').textContent);
    enfocar($('j-hito-t'));
  }

  // Pide la siguiente pregunta (en socios, juego_siguiente: su reloj empieza ahora). Si falla por red, se queda la
  // pantalla que había (explicación o insignia) con el aviso y el mismo botón para reintentar; no corre ningún tiempo.
  async function seguir() {
    if (E.ocupado) return;
    E.errorSeguir = '';
    E.ocupado = true;
    pintar();
    try { await nuevaPregunta(false, E.numero + 1); } catch (e) {
      if (socios() && Cueva.esErrorDeRed(e)) {
        E.errorSeguir = 'No se ha podido cargar la siguiente pregunta. Comprueba la conexión y vuelve a pulsar el botón.';
        pintar();
        enfocar(E.pantalla === 'hito' ? $('j-seguir') : $('j-siguiente'));
        return;
      }
      return abandonar(e);
    }
    E.pantalla = 'partida';
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

  // Si la fuente falla a mitad de partida (en socios, el servidor), se abandona y se vuelve al inicio con un aviso.
  // Motivo del error para la consola, sin datos personales: los errores de forma propios (FormatoServidor: función y
  // campo), los mensajes conocidos del servidor y la falta de red. Cualquier otro mensaje del servidor puede traer
  // datos de la fila (ver Cueva.registrar), así que de esos solo se escribe el código.
  function motivoError(e) {
    if (!e) return '';
    if (e.name === 'FormatoServidor' || mensajeServidor(e)) return e.message;
    if (Cueva.esErrorDeRed(e)) return 'sin conexión con el servidor';
    if (e instanceof Error && !e.code) return String(e.message || '').slice(0, 120); // error del propio navegador
    return '';
  }
  function abandonar(e) {
    if (e) { const m = motivoError(e); Cueva.registrar('La partida se ha interrumpido' + (m ? ': ' + m : ''), e); }
    pararReloj();
    fuente.abandonar();
    Object.assign(E, { pantalla: 'inicio', vista: 'jugar', ocupado: false, respuesta: null, errorSeguir: '', avisoCat: null, aviso: 'Ha habido un problema y la partida se ha interrumpido. Vuelve a intentarlo.' });
    pintar();
    arriba();
    enfocar($('j-categorias-t'));
  }

  async function usarCincuenta() {
    if (!E.comodines.cincuenta || E.ocupado || E.respuesta) return;
    E.comodines.cincuenta = false;
    E.ocupado = true;
    pintar();
    try { E.quitadas = await fuente.cincuenta(E.pregunta.id); } catch (e) {
      // Socios: si el servidor dice que el 50/50 ya se usó, se sigue con la misma pregunta (el reloj no se ha parado).
      if (!socios() || mensajeServidor(e) !== CINCUENTA_USADO) return abandonar(e);
      E.ocupado = false;
      pintar();
      anunciar('El 50/50 ya se había usado en esta partida.');
      enfocar($('j-opciones').querySelector('button:not(:disabled)'), true);
      return;
    }
    E.ocupado = false;
    pintar();
    anunciar('Se han quitado las respuestas ' + E.quitadas.map(i => LETRAS[i]).join(' y ') + '.');
    const primera = $('j-opciones').querySelector('button:not(:disabled)');
    if (primera) enfocar(primera, true);
  }

  async function usarSaltar() {
    if (!E.comodines.saltar || !E.puedeSaltar || E.ocupado || E.respuesta) return;
    E.comodines.saltar = false;
    pintar();
    try { await nuevaPregunta(true); } catch (e) {
      // Socios: si el servidor dice que ya se saltó una pregunta, la actual sigue en pantalla con su tiempo.
      if (!socios() || mensajeServidor(e) !== YA_SALTADA || !E.pregunta) return abandonar(e);
      E.ocupado = false;
      E.puedeSaltar = false;
      seguirReloj();
      pintar();
      anunciar('Ya habías saltado una pregunta en esta partida.');
      enfocar($('j-opciones').querySelector('button:not(:disabled)'), true);
      return;
    }
    pintar();
    anunciar('Pregunta cambiada.');
    enfocar($('j-numero'));
  }

  function volverAlInicio() {
    pararReloj();
    Object.assign(E, { pantalla: 'inicio', aviso: '', respuesta: null, final: null, errorSeguir: '' });
    pintar();
    arriba();
    enfocar($('j-estanteria-t'));
  }

  // ---------- Ranking (solo socios) ----------
  let rankingPedido = false;
  function cambiarVista(v) {
    if (!socios() || E.vista === v) return;
    E.vista = v;
    pintar();
    if (v === 'ranking' && !rankingPedido) cargarRanking();
  }
  function cargarRanking() {
    rankingPedido = true;
    const caja = $('j-ranking');
    Cueva.cargando(caja, 'Cargando el ranking…');
    Promise.resolve().then(() => fuente.ranking()).then(filas => pintarRanking(Array.isArray(filas) ? filas : []))
      .catch(e => Cueva.error(caja, e, cargarRanking));
  }
  const entero = v => Number.isInteger(v) && v > 0 ? v : 0;
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  function pintarRanking(filas) {
    const caja = $('j-ranking');
    caja.textContent = '';
    if (!filas.length) { caja.appendChild(crear('p', 'empty', 'Aún no hay nadie en el ranking.')); return; }
    const ol = crear('ol', 'j-ranking-lista');
    filas.forEach((f, i) => {
      const li = crear('li', 'card j-ranking-fila' + (f.es_yo === true ? ' yo' : ''));
      li.appendChild(crear('span', 'j-pos', String(i + 1)));
      const av = crear('span', 'j-rk-avatar');
      const nombre = typeof f.nombre_pila === 'string' && f.nombre_pila.trim() ? f.nombre_pila.trim() : 'Socio/a';
      if (Cueva.miniValida(f.foto_mini)) {
        const img = crear('img');
        img.src = f.foto_mini; img.alt = ''; img.width = 40; img.height = 40;
        img.addEventListener('error', () => { img.remove(); av.textContent = Array.from(nombre)[0].toLocaleUpperCase('es'); });
        av.appendChild(img);
      } else av.textContent = Array.from(nombre)[0].toLocaleUpperCase('es');
      av.setAttribute('aria-hidden', 'true');
      const tx = crear('span', 'j-rk-tx');
      tx.appendChild(crear('b', null, nombre + (f.es_yo === true ? ' (tú)' : '')));
      const logros = Math.min(Estante.MAX_LOGROS, entero(f.logros));
      const detalle = [plural(entero(f.bronces), 'bronce', 'bronces'), plural(entero(f.platas), 'plata', 'platas'), plural(entero(f.libros), 'libro', 'libros')];
      if (logros && Number.isFinite(f.tiempo_total_ms)) detalle.push(Estante.tiempo(f.tiempo_total_ms));
      tx.appendChild(crear('small', null, logros ? detalle.join(' · ') : 'Sin logros todavía'));
      // Valor principal: logros sobre el máximo (30).
      const val = crear('span', 'j-rk-logros');
      val.appendChild(crear('b', null, String(logros)));
      val.appendChild(crear('span', 'j-rk-max', '/' + Estante.MAX_LOGROS));
      val.appendChild(crear('small', null, 'logros'));
      val.setAttribute('aria-label', logros + ' de ' + Estante.MAX_LOGROS + ' logros');
      li.append(av, tx, val);
      ol.appendChild(li);
    });
    caja.appendChild(ol);
  }

  // ---------- Reportar pregunta (solo socios, después de responder) ----------
  const dialogo = $('j-dialogo-reporte');
  function abrirReporte() {
    if (!socios() || !E.respuesta || E.reportadas.has(E.pregunta.id) || dialogo.open) return;
    $('j-form-reporte').reset();
    $('j-rep-msg').textContent = '';
    dialogo.dataset.pregunta = E.pregunta.id;
    dialogo.showModal();
  }
  function cerrarReporte() {
    if (dialogo.open) dialogo.close();
  }
  dialogo.addEventListener('close', () => { const b = $('j-reportar'); if (!b.hidden && !b.disabled) b.focus({ preventScroll: true }); else enfocar($('j-siguiente')); });
  dialogo.addEventListener('cancel', e => { if (dialogo.getAttribute('aria-busy') === 'true') e.preventDefault(); });
  $('j-rep-cancelar').addEventListener('click', cerrarReporte);
  $('j-form-reporte').addEventListener('submit', async e => {
    e.preventDefault();
    if (dialogo.getAttribute('aria-busy') === 'true') return;
    const marcado = $('j-form-reporte').querySelector('input[name="motivo"]:checked');
    const msg = $('j-rep-msg');
    if (!marcado) { msg.textContent = 'Elige qué le pasa a la pregunta.'; return; }
    const texto = $('j-rep-texto').value.trim().slice(0, 300);
    const id = dialogo.dataset.pregunta;
    dialogo.setAttribute('aria-busy', 'true');
    msg.textContent = '';
    dialogo.querySelectorAll('button, input, textarea').forEach(x => { x.disabled = true; });
    try {
      await fuente.reportar(id, marcado.value, texto);
      E.reportadas.add(id);
      dialogo.removeAttribute('aria-busy');
      cerrarReporte();
      pintar();
      Cueva.aviso('Gracias. Revisaremos la pregunta.', 'ok');
    } catch (err) {
      { const m = motivoError(err); Cueva.registrar('No se ha podido reportar la pregunta' + (m ? ': ' + m : ''), err); }
      msg.textContent = Cueva.mensaje(err);
    } finally {
      dialogo.removeAttribute('aria-busy');
      dialogo.querySelectorAll('button, input, textarea').forEach(x => { x.disabled = false; });
    }
  });

  // ---------- Pantallas ----------
  function anunciar(texto) {
    const el = $('j-anuncio');
    el.textContent = '';
    setTimeout(() => { el.textContent = texto; }, 50);
  }
  function enfocar(el, conScroll) { if (el && !el.hidden) el.focus({ preventScroll: !conScroll }); }
  function arriba() { window.scrollTo(0, 0); }

  function pintarEstante() {
    const libros = Estante.pintar($('j-libros'), E.logros);
    $('j-cuenta').textContent = Estante.contar(E.logros) + '/' + Estante.MAX_LOGROS + ' logros · ' + plural(libros, 'libro', 'libros');
  }

  function pintarInicio() {
    $('j-pestanas').hidden = !socios();
    document.querySelectorAll('#j-pestanas [data-vista]').forEach(b => {
      const on = b.dataset.vista === E.vista;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('j-vista-jugar').hidden = E.vista !== 'jugar';
    $('j-vista-ranking').hidden = E.vista !== 'ranking';
    $('j-nota-estante').textContent = 'Cada categoría da tres insignias: bronce al superar la pregunta 5, plata en la 10 y oro con su libro en la 15. ' +
      (socios() ? 'Se guardan en tu cuenta del club.' : 'Duran mientras no cierres el navegador.');
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
      const nivel = E.logros[c.id] | 0;
      if (!c.banco && !socios()) {
        b.classList.add('off');
        b.disabled = true;
        b.appendChild(crear('span', 'pronto', 'Próximamente'));
      } else if (E.preparando || E.cargando === c.id) {
        tx.appendChild(crear('small', null, E.preparando ? 'Preparando…' : 'Preparando las preguntas…'));
        b.setAttribute('aria-busy', 'true');
      } else {
        const mejor = fuente.estanteria.mejor(c.id);
        tx.appendChild(crear('small', null, !nivel ? '15 preguntas'
          : 'Hasta ' + nombreInsignia(nivel) + (mejor != null ? ' · tu mejor tiempo: ' + Estante.tiempo(mejor) : '')));
        if (nivel >= 3) b.classList.add('j-ganada');
        b.appendChild(Estante.insignias(nivel));
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

  // Aviso de «no se ha podido pedir la siguiente pregunta» en la pantalla que esté a la vista.
  function pintarErrorSeguir(id) {
    const el = $(id);
    el.textContent = E.errorSeguir;
    el.hidden = !E.errorSeguir;
  }

  function pintarPartida() {
    const nivel = nivelDe(E.numero);
    $('j-cat').textContent = categoria(E.categoria).nombre;
    $('j-numero').textContent = 'Pregunta ' + E.numero + ' de ' + TOTAL;
    $('j-nivel').textContent = { facil: 'Nivel fácil', media: 'Nivel medio', dificil: 'Nivel difícil' }[nivel] +
      (SEGUROS.includes(E.numero) ? ' · Insignia de ' + nombreInsignia(SEGUROS.indexOf(E.numero) + 1) : E.numero === TOTAL ? ' · Insignia de oro' : '');
    $('j-nivel').dataset.nivel = nivel;

    const escalera = $('j-escalera');
    if (!escalera.children.length) {
      for (let i = 1; i <= TOTAL; i++) {
        const li = crear('li', SEGUROS.includes(i) || i === TOTAL ? 'segura' : '');
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
      const sig = $('j-siguiente');
      sig.textContent = r.fin === 'derrota' ? 'Ver resultado' : r.fin === 'premio' ? 'Ver tu premio'
        : r.fin === 'hito' && r.logro ? 'Ver tu insignia' : E.ocupado ? 'Cargando…' : 'Siguiente pregunta';
      sig.disabled = E.ocupado;
      pintarErrorSeguir('j-tras-error');
      const rep = $('j-reportar'), hecho = E.reportadas.has(E.pregunta.id);
      rep.hidden = !socios();
      rep.disabled = hecho;
      rep.textContent = hecho ? 'Pregunta reportada' : 'Reportar pregunta';
    }
    pintarReloj();
  }

  // Pantalla de la insignia (pregunta 5 o 10).
  function pintarHito() {
    const l = E.respuesta.logro, c = categoria(E.categoria);
    const caja = $('j-hito-ins');
    caja.textContent = '';
    caja.appendChild(Estante.insignia(l.nivel, true, true));
    $('j-hito-t').textContent = '¡Insignia de ' + l.insignia + ' en ' + c.nombre + '!';
    let t = 'Has superado la pregunta ' + E.numero + '.';
    if (l.nuevo) t += ' Es nueva en tu colección.';
    else if (l.mejor_marca) t += ' Ya la tenías, y has mejorado tu marca.';
    else t += ' Ya la tenías.';
    if (E.respuesta.tiempoMs != null) t += ' Tiempo hasta aquí: ' + Estante.tiempo(E.respuesta.tiempoMs) + '.';
    if (!l.nuevo && !l.mejor_marca && l.mejor_tiempo_ms != null) t += ' Tu mejor marca sigue siendo ' + Estante.tiempo(l.mejor_tiempo_ms) + '.';
    $('j-hito-texto').textContent = t;
    const b = $('j-seguir');
    b.disabled = E.ocupado;
    b.textContent = E.ocupado ? 'Cargando…' : 'Seguir';
    pintarErrorSeguir('j-hito-error');
  }

  function pintarResultado() {
    const f = E.final, c = categoria(E.categoria);
    const libro = $('j-res-libro');
    libro.textContent = '';
    $('j-res').classList.toggle('gano', f.gano);
    $('j-res-nuevo').hidden = !(f.gano && f.nuevoLibro);
    if (f.gano) {
      const p = Estante.premio(E.categoria);
      $('j-res-t').textContent = '¡Insignia de oro en ' + c.nombre + '!';
      const nombre = p.titulo ? '«' + p.titulo + '»' + (p.autor ? ' de ' + p.autor : '') : 'el libro de esta categoría';
      let tiempo = '';
      if (f.tiempoMs != null) {
        tiempo = ' Tu tiempo: ' + Estante.tiempo(f.tiempoMs) + '.';
        if (f.mejorMarca) tiempo += ' Es tu mejor marca en esta categoría.';
        else if (f.mejorMs != null) tiempo += ' Tu mejor marca sigue siendo ' + Estante.tiempo(f.mejorMs) + '.';
      }
      $('j-res-texto').textContent = 'Has acertado las 15 preguntas.' + tiempo + ' ' +
        (f.nuevoLibro ? 'Tu premio, ' + nombre + ', ya está en tu estantería.' : 'Ya tenías ' + nombre + ' en tu estantería.');
      libro.appendChild(Estante.insignia(3, true, true));
      libro.appendChild(Estante.lomo(E.categoria, true, true));
    } else {
      const a = Math.min(2, f.asegurado | 0);
      $('j-res-t').textContent = f.agotado ? 'Se acabó el tiempo' : 'Fin de la partida';
      $('j-res-texto').textContent = 'Llegaste a la pregunta ' + f.llego + ' (último punto seguro: ' + (f.seguro || 'ninguno') + '). ' +
        (a === 2 ? 'Te quedas con la insignia de bronce y la de plata en esta categoría.'
          : a === 1 ? 'Te quedas con la insignia de bronce en esta categoría.' : 'Esta vez sin insignia.');
      for (let n = 1; n <= a; n++) libro.appendChild(Estante.insignia(n, true, true));
    }
  }

  function pintar() {
    ['inicio', 'partida', 'hito', 'resultado'].forEach(p => { $('j-' + p).hidden = E.pantalla !== p; });
    document.body.classList.toggle('j-jugando', E.pantalla === 'partida');
    $('j-libre').hidden = !E.libre;
    if (E.pantalla === 'inicio') pintarInicio();
    else if (E.pantalla === 'partida') pintarPartida();
    else if (E.pantalla === 'hito') pintarHito();
    else pintarResultado();
  }

  // ---------- Eventos ----------
  $('j-categorias').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]');
    if (b && !b.disabled) empezar(b.dataset.cat);
  });
  $('j-pestanas').addEventListener('click', e => {
    const b = e.target.closest('button[data-vista]');
    if (b) cambiarVista(b.dataset.vista);
  });
  $('j-opciones').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b && !b.disabled) responder(+b.dataset.i);
  });
  $('j-cincuenta').addEventListener('click', usarCincuenta);
  $('j-saltar').addEventListener('click', usarSaltar);
  $('j-siguiente').addEventListener('click', siguiente);
  $('j-seguir').addEventListener('click', seguir);
  $('j-reportar').addEventListener('click', abrirReporte);
  $('j-otra').addEventListener('click', () => { const c = E.categoria; volverAlInicio(); empezar(c); });
  $('j-cambiar').addEventListener('click', volverAlInicio);
  // Si se cierra o se recarga la página a mitad de partida, la partida se pierde (en socios, se avisa al servidor).
  window.addEventListener('pagehide', () => { if (E.pantalla === 'partida' || E.pantalla === 'hito') fuente.abandonar(); });

  // ---------- Arranque ----------
  // Sin sesión guardada: modo público al instante. Con sesión: se espera a saber si la cuenta está activa (la misma
  // consulta que usan la barra y la campana); si el servidor no responde, modo público con aviso.
  async function arrancar() {
    Estante.cargarPremios().then(() => { if (E.pantalla === 'inicio') pintarEstante(); });
    if (typeof Cueva === 'undefined' || !Cueva.haySesionLocal()) {
      E.logros = await fuente.estanteria.leer();
      pintar();
      return;
    }
    E.preparando = true;
    pintar();
    let ses = null;
    try { ses = await Cueva.sesionActiva(); } catch (e) { ses = null; }
    if (ses) {
      const f = FuenteSocios(ses.sb);
      try { E.logros = await f.estanteria.leer(); fuente = f; }
      catch (e) { const m = motivoError(e); Cueva.registrar('No se han podido leer tus logros del juego' + (m ? ': ' + m : ''), e); await pasarALibre(); }
    } else await pasarALibre();
    E.preparando = false;
    pintar();
  }
  arrancar();
})();
