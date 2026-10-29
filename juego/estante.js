// ESTANTERÍA DEL JUEGO (juego/estante.js): categorías, libros-premio (juego/premios.json), lomos dibujados con CSS e
// insignias de logro en SVG (bronce, plata y oro), con sus estilos en juego/estante.css. La usan quiz.html (juego/juego.js) y perfil.html (tarjeta «Mis libros del juego», que solo
// existe con JUEGO_VISIBLE). Solo pinta: no guarda nada ni llama a ningún servidor; los textos van con textContent.
const Estante = (function () {
  // banco: true = existe juego/banco/<id>.json (modo público). Las demás salen como «Próximamente».
  const CATEGORIAS = [
    { id: 'ideas', nombre: 'Ideas y premisa', banco: true },
    { id: 'worldbuilding', nombre: 'Worldbuilding', banco: true },
    { id: 'personajes', nombre: 'Personajes', banco: true },
    { id: 'trama', nombre: 'Trama y estructura', banco: true },
    { id: 'estilo', nombre: 'Estilo y técnica', banco: true },
    { id: 'gramatica', nombre: 'Gramática y ortografía', banco: true },
    { id: 'historia', nombre: 'Historia de la literatura y géneros', banco: true },
    { id: 'edicion', nombre: 'Edición y publicación', banco: true },
    { id: 'marketing', nombre: 'Marketing literario', banco: true },
    { id: 'proceso', nombre: 'Proceso y hábitos', banco: true }
  ];
  const categoria = id => CATEGORIAS.find(c => c.id === id);

  const crear = (etiqueta, clase, texto) => {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  };

  // Libros-premio. Mientras no llegan (o si fallan), el lomo sale sin título: el color y el texto para lectores de
  // pantalla (la categoría) bastan.
  const premios = {};
  let pedidos = null;
  function cargarPremios() {
    if (!pedidos) pedidos = fetch('juego/premios.json').then(r => r.ok ? r.json() : []).then(lista => {
      (Array.isArray(lista) ? lista : []).forEach(p => {
        if (!p || !categoria(p.categoria) || typeof p.titulo !== 'string') return;
        premios[p.categoria] = {
          titulo: p.titulo,
          autor: typeof p.autor === 'string' ? p.autor : '',
          color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#3E6F77'
        };
      });
    }).catch(() => { pedidos = null; });
    return pedidos || Promise.resolve();
  }
  const premio = cat => premios[cat] || { titulo: '', autor: '', color: '#3E6F77' };

  // Un lomo (li) de la estantería, o el lomo grande (div) de la pantalla de premio.
  function lomo(cat, ganado, grande) {
    const el = crear(grande ? 'div' : 'li', 'j-lomo' + (ganado ? '' : ' j-hueco') + (grande ? ' j-lomo-grande' : ''));
    const c = categoria(cat);
    if (ganado) {
      const p = premio(cat);
      el.style.setProperty('--lomo', p.color);
      // Título y autor se ven en el lomo (partidos en varias líneas si hace falta; letra más pequeña si son largos).
      // Los lectores de pantalla leen «Título, de Autor». Sin premios cargados, solo la categoría.
      if (p.titulo) {
        if (p.titulo.length > 18) el.classList.add(p.titulo.length > 28 ? 'j-lomo-muylargo' : 'j-lomo-largo');
        const t = el.appendChild(crear('span', 'j-lomo-titulo', p.titulo));
        t.setAttribute('aria-hidden', 'true');
        if (p.autor) el.appendChild(crear('span', 'j-lomo-autor', p.autor)).setAttribute('aria-hidden', 'true');
        el.appendChild(crear('span', 'perfil-sr', p.titulo + (p.autor ? ', de ' + p.autor : '')));
      } else {
        el.appendChild(crear('span', 'perfil-sr', 'Libro de ' + c.nombre));
      }
    } else {
      el.appendChild(crear('span', 'perfil-sr', 'Hueco libre: ' + c.nombre));
    }
    return el;
  }

  // ---------- Logros: tres insignias por categoría ----------
  // Nivel 1 = bronce (pregunta 5), 2 = plata (pregunta 10), 3 = oro + el libro de la categoría (pregunta 15).
  // logros: { categoría: nivel más alto conseguido (0-3) }. Máximo: 10 categorías × 3 = 30.
  const INSIGNIAS = { 1: 'bronce', 2: 'plata', 3: 'oro' };
  const MAX_LOGROS = CATEGORIAS.length * 3;
  // Cada insignia tiene su forma (no solo su color) y su número: bronce redonda, plata hexagonal, oro estrella.
  const FORMAS = {
    1: '<circle class="j-ins-forma" cx="20" cy="20" r="16"/>',
    2: '<polygon class="j-ins-forma" points="20,3 35,11.5 35,28.5 20,37 5,28.5 5,11.5"/>',
    3: '<polygon class="j-ins-forma" points="20,2 25,14 38,15 28,24 31,37 20,30 9,37 12,24 2,15 15,14"/>'
  };
  // Una insignia dibujada en SVG. conseguida: rellena; si no, solo el contorno discontinuo («hueco»).
  // grande: la de las pantallas de hito y premio (con una aparición corta si el sistema no pide reducir el movimiento).
  function insignia(nivel, conseguida, grande) {
    const el = crear('span', 'j-ins j-ins-' + INSIGNIAS[nivel] + (conseguida ? ' on' : '') + (grande ? ' j-ins-grande' : ''));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Insignia de ' + INSIGNIAS[nivel] + (conseguida ? ', conseguida' : ', pendiente'));
    el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">' + FORMAS[nivel] +
      '<text class="j-ins-num" x="20" y="' + (nivel === 3 ? 25 : 24.5) + '" text-anchor="middle">' + nivel + '</text></svg>';
    return el;
  }
  // Las tres insignias de una categoría, encendidas hasta el nivel conseguido.
  function insignias(nivel) {
    const fila = crear('span', 'j-ins-fila');
    [1, 2, 3].forEach(n => fila.appendChild(insignia(n, nivel >= n)));
    return fila;
  }
  // Total de logros (insignias) de un mapa { categoría: nivel }.
  const contar = logros => CATEGORIAS.reduce((t, c) => t + Math.min(3, Math.max(0, logros[c.id] | 0)), 0);
  const libros = logros => CATEGORIAS.filter(c => (logros[c.id] | 0) >= 3).length;

  // Rellena la lista <ul class="j-libros"> con un lomo por categoría: el libro solo con el oro (nivel 3); si no, hueco.
  // Devuelve cuántos libros hay.
  function pintar(ul, logros) {
    ul.textContent = '';
    CATEGORIAS.forEach(c => ul.appendChild(lomo(c.id, (logros[c.id] | 0) >= 3)));
    const n = libros(logros);
    ul.setAttribute('aria-label', 'Estantería: ' + n + (n === 1 ? ' libro' : ' libros') + ' de ' + CATEGORIAS.length);
    return n;
  }

  // Milisegundos → «3:07» (minutos:segundos). Más de una hora: «1:02:07».
  function tiempo(ms) {
    const s = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), seg = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + seg : m + ':' + seg;
  }

  return { CATEGORIAS, categoria, cargarPremios, premio, lomo, pintar, tiempo, crear,
    INSIGNIAS, MAX_LOGROS, insignia, insignias, contar, libros };
})();
