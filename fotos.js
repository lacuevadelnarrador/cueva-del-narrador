// FOTOS DE PERFIL (fotos.js): cargar, recortar, procesar, subir y quitar la foto de un socio.
// Lo cargan solo perfil.html y admin-socios.html (después de auth.js).
// - Almacén PRIVADO "fotos-socios": cada objeto en <id del socio>/<marca de tiempo>.jpg (solo image/jpeg, hasta 300 KB).
//   No hay URLs públicas ni firmadas: la foto se descarga con la sesión y se muestra como blob:, que hay que liberar
//   con Fotos.liberar() en cuanto deja de usarse.
// - socios.foto_url guarda la RUTA del objeto y socios.foto_mini la miniatura de 128x128 (data URI JPEG). Las dos se
//   guardan y se borran A LA VEZ, en el mismo update, y siempre se comprueba con .select() que ha cambiado 1 fila.
// - La foto es un dato personal: nada de rutas ni errores completos en la consola (solo Cueva.registrar) y ninguna
//   copia en el dispositivo (ni localStorage ni caché). Todo se procesa en memoria, en el navegador.
const Fotos = (function () {
  const esc = Cueva.esc;
  const CUBO = 'fotos-socios';
  const MAX_ENTRADA = 15 * 1024 * 1024;   // archivo elegido
  const LADO = 600, LADO_MINI = 128;      // px (la foto nunca se amplía: si el recorte es menor, se usa su tamaño)
  const OBJETIVO = 280 * 1024, MAX_FOTO = 307200;
  const OBJETIVO_MINI = 11000;
  const MAX_RUTA = 120;
  const ZOOM_MAX = 4;

  const MENSAJES = {
    grande: 'Esa imagen es demasiado grande (máximo 15 MB). Prueba con otra o hazte una foto ahora.',
    ilegible: 'No se puede leer esa imagen. Prueba con otra o hazte una foto ahora.',
    permiso: 'No tienes permiso para cambiar esta foto. Si crees que es un error, escríbenos.',
    red: 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo: no se ha perdido nada.',
    guardar: 'No se ha podido guardar la foto. Inténtalo de nuevo dentro de un momento: no se ha perdido nada.',
    quitar: 'No se ha podido quitar la foto. Inténtalo de nuevo dentro de un momento.'
  };
  // Texto amable para cada error (nunca el técnico).
  function mensaje(e, accion) {
    if (e && e.foto && MENSAJES[e.foto]) return MENSAJES[e.foto];
    if (Cueva.esErrorDeRed(e)) return MENSAJES.red;
    const st = String((e && (e.statusCode || e.status)) || ''), t = String((e && e.message) || '');
    if ((e && e.sinFilas) || st === '401' || st === '403' || (e && e.code === '42501') || /row-level security|permission|unauthorized|no puedes modificar/i.test(t))
      return MENSAJES.permiso;
    return MENSAJES[accion] || MENSAJES.guardar;
  }

  // ---------- Cargar ----------
  // Descarga la foto con la sesión y devuelve un object URL (blob:), o null si no se puede (se mostrará la inicial).
  async function cargar(ruta) {
    if (typeof ruta !== 'string' || !ruta) return null;
    try {
      const sb = await Cueva.cliente();
      const r = await sb.storage.from(CUBO).download(ruta);
      if (r.error || !r.data) throw r.error || {};
      return URL.createObjectURL(r.data);
    } catch (e) {
      Cueva.registrar('No se ha podido cargar una foto', e);
      return null;
    }
  }
  const liberar = url => { if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url); };

  // ---------- Leer el archivo elegido ----------
  // Devuelve { fuente, ancho, alto, cerrar() } ya girada según su orientación EXIF.
  async function leer(archivo) {
    if (!archivo || typeof archivo.size !== 'number' || !archivo.size) throw { foto: 'ilegible' };
    if (archivo.size > MAX_ENTRADA) throw { foto: 'grande' };
    if (window.createImageBitmap) {
      try {
        const b = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
        if (b.width && b.height) return { fuente: b, ancho: b.width, alto: b.height, cerrar: () => b.close() };
        b.close();
      } catch (e) { /* se prueba con <img> */ }
    }
    // Respaldo: <img> (los navegadores actuales también respetan la orientación EXIF)
    const url = URL.createObjectURL(archivo);
    try {
      const img = new Image();
      await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = url; });
      if (img.decode) await img.decode().catch(() => {});
      if (!img.naturalWidth || !img.naturalHeight) throw {};
      return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => { img.src = ''; } };
    } catch (e) {
      throw { foto: 'ilegible' };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Procesar ----------
  // recorte = { x, y, lado } en píxeles de la imagen (ya girada). Por defecto, el cuadrado central más grande.
  const centrado = img => { const l = Math.min(img.ancho, img.alto); return { x: (img.ancho - l) / 2, y: (img.alto - l) / 2, lado: l }; };
  function dibujar(img, r, lado) {
    const c = document.createElement('canvas');
    c.width = c.height = lado;
    const cx = c.getContext('2d');
    cx.fillStyle = '#FFFFFF'; // fondo blanco: un PNG transparente no sale negro
    cx.fillRect(0, 0, lado, lado);
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img.fuente, r.x, r.y, r.lado, r.lado, 0, 0, lado, lado);
    return c;
  }
  const aBlob = (c, q) => new Promise((ok, mal) => c.toBlob(b => b && b.type === 'image/jpeg' ? ok(b) : mal({ foto: 'ilegible' }), 'image/jpeg', q));
  // Devuelve { foto: Blob JPEG cuadrado ≤600 px y ≤300 KB, mini: data URI JPEG 128x128, lado }.
  async function procesar(img, recorte) {
    const r = recorte || centrado(img);
    let lado = Math.max(1, Math.min(LADO, Math.floor(r.lado))), foto = null;
    // Calidad 0,85 y, si pesa más de 280 KB, de 0,07 en 0,07 hasta 0,5. Por si acaso, si aun así pasara de 300 KB, más pequeña.
    for (let intento = 0; intento < 4 && !foto; intento++) {
      const c = dibujar(img, r, lado);
      for (let q = 85; ; q -= 7) {
        const b = await aBlob(c, q / 100);
        if (b.size <= OBJETIVO || q <= 50) { if (b.size <= MAX_FOTO) foto = b; break; }
      }
      c.width = c.height = 0;
      if (!foto) lado = Math.max(1, Math.floor(lado * 0.8));
    }
    if (!foto) throw { foto: 'ilegible' };
    // Miniatura: mismo recorte, calidad 0,7 y, si el texto pasa de 11.000 caracteres, de 0,07 en 0,07 hasta 0,4.
    const cm = dibujar(img, r, LADO_MINI);
    let mini = '';
    for (let q = 70; ; q = Math.max(40, q - 7)) {
      mini = cm.toDataURL('image/jpeg', q / 100);
      if (mini.length <= OBJETIVO_MINI || q <= 40) break;
    }
    cm.width = cm.height = 0;
    if (!Cueva.miniValida(mini)) throw { foto: 'ilegible' };
    return { foto, mini, lado };
  }

  // ---------- Bloqueo de la página ----------
  let ocupado = false;
  const app = () => document.querySelector('.app') || document.body;
  function bloquear() {
    ocupado = true;
    app().setAttribute('aria-busy', 'true');
    return () => { ocupado = false; app().removeAttribute('aria-busy'); };
  }

  // ---------- Subir ----------
  // (a) sube el objeto nuevo, (b) guarda foto_url y foto_mini en el mismo update comprobando 1 fila,
  // (c) solo entonces borra la foto anterior (si falla, no es grave), (d) si (b) falla, borra lo recién subido.
  // Devuelve la fila { id, foto_url, foto_mini }.
  async function subir(socioId, foto, mini, rutaAnterior) {
    if (ocupado) throw { foto: 'ocupado' };
    // Instantánea antes de cualquier espera
    const id = String(socioId || ''), anterior = typeof rutaAnterior === 'string' && rutaAnterior ? rutaAnterior : null;
    const ruta = id + '/' + Date.now() + '.jpg';
    if (!id || ruta.length > MAX_RUTA) throw { foto: 'guardar' };
    if (!(foto instanceof Blob) || foto.type !== 'image/jpeg' || foto.size > MAX_FOTO) throw { foto: 'ilegible' };
    if (!Cueva.miniValida(mini)) throw { foto: 'ilegible' };
    const soltar = bloquear();
    try {
      const sb = await Cueva.cliente(), cubo = sb.storage.from(CUBO);
      const s = await cubo.upload(ruta, foto, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' });
      if (s.error) throw s.error;
      let fila;
      try {
        const u = await sb.from('socios').update({ foto_url: ruta, foto_mini: mini }).eq('id', id).select('id,foto_url,foto_mini');
        if (u.error) throw u.error;
        if (!Array.isArray(u.data) || u.data.length !== 1) throw { sinFilas: true };
        fila = u.data[0];
      } catch (e) {
        try { const b = await cubo.remove([ruta]); if (b.error) throw b.error; } catch (e2) { Cueva.registrar('No se ha podido borrar la foto recién subida', e2); }
        throw e;
      }
      if (anterior && anterior !== ruta) {
        try { const b = await cubo.remove([anterior]); if (b.error) throw b.error; } catch (e) { Cueva.registrar('No se ha podido borrar la foto anterior', e); }
      }
      return fila;
    } finally {
      soltar();
    }
  }

  // ---------- Borrar todas las fotos de un socio (al eliminar su ficha) ----------
  async function borrarTodas(socioId) {
    const id = String(socioId || '');
    if (!id) throw { foto: 'quitar' };
    const sb = await Cueva.cliente(), cubo = sb.storage.from(CUBO);
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const l = await cubo.list(id, { limit: 100 });
      if (l.error) throw l.error;
      const rutas = (l.data || []).filter(o => o && o.name && o.id !== null).map(o => id + '/' + o.name);
      if (!rutas.length) return true;
      const r = await cubo.remove(rutas);
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || !r.data.length) throw { sinFilas: true }; // sin permiso: no se ha borrado nada
    }
    throw { foto: 'quitar' };
  }

  // ---------- Diálogos ----------
  // Modal (encierra el foco; "dialog[open]" desactiva "arrastrar para refrescar" en auth.js). Al cerrarse se borra y el
  // foco vuelve a donde estaba (o, si ese botón se ha vuelto a pintar, al elemento con id "foco").
  function dialogo(html, foco, clase) {
    const previo = document.activeElement;
    const d = document.createElement('dialog');
    d.className = 'dialogo foto-dialogo' + (clase ? ' ' + clase : '');
    d.setAttribute('aria-labelledby', 'foto-dlg-titulo');
    d.setAttribute('aria-describedby', 'foto-dlg-texto');
    d.innerHTML = html;
    document.body.appendChild(d);
    document.documentElement.classList.add('foto-modal');
    d.addEventListener('cancel', e => { if (d.getAttribute('aria-busy') === 'true') e.preventDefault(); });
    // Limpieza (una sola vez): al cerrar desde el código se hace en el acto, sin esperar al evento "close"
    // (que el navegador puede retrasar si la página está en segundo plano); con Escape, al llegar ese evento.
    let limpio = false;
    d.limpiar = () => {
      if (limpio) return;
      limpio = true;
      d.dispatchEvent(new Event('foto-cerrado'));
      d.remove();
      if (!document.querySelector('dialog.foto-dialogo')) document.documentElement.classList.remove('foto-modal');
      const util = previo && previo !== document.body && previo.isConnected && previo.getClientRects().length;
      const destino = util ? previo : foco && document.getElementById(foco);
      if (destino) destino.focus({ preventScroll: true });
    };
    d.cerrar = () => { if (d.open) d.close(); d.limpiar(); };
    d.addEventListener('close', d.limpiar);
    d.showModal();
    return d;
  }
  // Pregunta sencilla. alAceptar se llama DENTRO del clic (así puede abrir el selector de archivos en cualquier navegador).
  function preguntar(o) {
    const d = dialogo('<h2 id="foto-dlg-titulo">' + esc(o.titulo) + '</h2><p id="foto-dlg-texto">' + esc(o.texto) + '</p>' +
      '<div class="botones-form"><button type="button" class="btn sec" value="no">Cancelar</button>' +
      '<button type="button" class="btn' + (o.peligro ? ' peligro' : '') + '" value="si">' + esc(o.si) + '</button></div>', o.foco);
    d.addEventListener('click', e => {
      const b = e.target.closest('.botones-form > button');
      if (!b) return;
      d.cerrar();
      if (b.value === 'si') o.alAceptar();
    });
    d.querySelector(o.peligro ? 'button[value="no"]' : 'button[value="si"]').focus();
  }

  // ---------- Elegir archivo ----------
  let entrada = null;
  function elegir(alElegir) {
    if (!entrada) {
      entrada = document.createElement('input');
      entrada.type = 'file';
      entrada.accept = 'image/*';
      entrada.className = 'foto-entrada';
      entrada.tabIndex = -1;
      entrada.setAttribute('aria-hidden', 'true');
      document.body.appendChild(entrada);
    }
    entrada.value = '';
    entrada.onchange = () => {
      const f = entrada.files && entrada.files[0];
      entrada.onchange = null;
      if (f) alElegir(f);
      entrada.value = '';
    };
    entrada.click();
  }

  // ---------- Recorte ("Ajusta tu foto") ----------
  // Estado independiente del tamaño del marco: zoom (1 = la imagen cubre justo el marco) y el centro del marco en
  // píxeles de la imagen. Así, si el marco cambia de tamaño (giro, ventana), el recorte no cambia.
  function recortar(img, alUsar, foco) {
    const menor = Math.min(img.ancho, img.alto);
    // Sin ampliar más de lo que tiene la imagen: el recorte nunca baja de 128 px reales (ni de 4 aumentos)
    const zMax = Math.max(1, Math.min(ZOOM_MAX, menor / LADO_MINI));
    let zoom = 1, cx = img.ancho / 2, cy = img.alto / 2, trabajando = false;
    const d = dialogo(
      '<h2 id="foto-dlg-titulo">Ajusta tu foto</h2>' +
      '<p class="pista" id="foto-dlg-texto">Arrastra la foto para colocarla dentro del círculo y usa «Ampliar» para acercarla. ' +
      'Con el teclado: flechas para mover y + o − para ampliar. La foto se guarda cuadrada.</p>' +
      '<div class="foto-marco" tabindex="0" role="group" aria-label="Recorte de la foto. Flechas para mover, más y menos para ampliar." aria-describedby="foto-zoom-valor">' +
        '<canvas class="foto-lienzo" aria-hidden="true"></canvas><span class="foto-mascara" aria-hidden="true"></span></div>' +
      '<div class="campo foto-zoom"><label for="foto-ampliar">Ampliar</label>' +
        '<div class="foto-zoom-fila"><span aria-hidden="true">−</span><input type="range" id="foto-ampliar" min="1" max="' + zMax.toFixed(2) + '" step="0.01" value="1"' + (zMax <= 1 ? ' disabled' : '') + '><span aria-hidden="true">+</span></div>' +
        '<p class="pista" id="foto-zoom-valor">' + (zMax <= 1 ? 'Esta imagen es pequeña: no se puede ampliar más.' : '') + '</p></div>' +
      '<p class="msg err" id="foto-error" role="alert" hidden></p>' +
      '<p class="foto-estado" id="foto-estado" role="status"></p>' +
      '<div class="botones-form"><button type="button" class="btn sec" value="no">Cancelar</button>' +
      '<button type="button" class="btn" value="si">Usar esta foto</button></div>', foco, 'foto-dialogo-recorte');
    const marco = d.querySelector('.foto-marco'), lienzo = d.querySelector('.foto-lienzo'), rango = d.querySelector('#foto-ampliar');
    const valor = d.querySelector('#foto-zoom-valor'), error = d.querySelector('#foto-error'), estado = d.querySelector('#foto-estado');
    const usar = d.querySelector('button[value="si"]');

    // Vista previa reducida (como mucho 1600 px de lado) para moverla con soltura; el resultado sale de la original.
    const ep = Math.min(1, 1600 / Math.max(img.ancho, img.alto));
    lienzo.width = Math.max(1, Math.round(img.ancho * ep));
    lienzo.height = Math.max(1, Math.round(img.alto * ep));
    lienzo.getContext('2d').drawImage(img.fuente, 0, 0, lienzo.width, lienzo.height);

    const tam = () => marco.clientWidth || 1;
    const escala = () => tam() / menor * zoom;                 // px de pantalla por px de imagen
    function limitar() {
      zoom = Math.min(zMax, Math.max(1, zoom));
      const m = menor / zoom / 2;                              // medio lado del recorte, en px de imagen
      cx = Math.min(img.ancho - m, Math.max(m, cx));
      cy = Math.min(img.alto - m, Math.max(m, cy));
    }
    function pintar() {
      limitar();
      const e = escala(), M = tam();
      lienzo.style.width = img.ancho * e + 'px';
      lienzo.style.height = img.alto * e + 'px';
      lienzo.style.transform = 'translate(' + (M / 2 - cx * e) + 'px,' + (M / 2 - cy * e) + 'px)';
      if (+rango.value !== zoom) rango.value = String(zoom);
      const pct = Math.round(zoom * 100) + ' %';
      rango.setAttribute('aria-valuetext', pct);
      if (zMax > 1) valor.textContent = 'Ampliación: ' + pct;
    }
    // Ampliar alrededor de un punto del marco (px desde su esquina); por defecto, el centro.
    function ampliar(nuevo, px, py) {
      const M = tam(), e0 = escala();
      if (px == null) { px = M / 2; py = M / 2; }
      const ux = cx + (px - M / 2) / e0, uy = cy + (py - M / 2) / e0;
      zoom = Math.min(zMax, Math.max(1, nuevo));
      const e1 = escala();
      cx = ux - (px - M / 2) / e1;
      cy = uy - (py - M / 2) / e1;
      pintar();
    }
    const mover = (dx, dy) => { const e = escala(); cx -= dx / e; cy -= dy / e; pintar(); };

    // Arrastrar (un dedo o ratón) y pellizcar (dos dedos)
    const punteros = new Map();
    let pellizco = null;
    const enMarco = ev => { const r = marco.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    marco.addEventListener('pointerdown', ev => {
      if (trabajando) return;
      marco.focus({ preventScroll: true });
      try { marco.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura, sigue funcionando dentro del marco */ }
      punteros.set(ev.pointerId, enMarco(ev));
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        pellizco = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom };
      }
      ev.preventDefault();
    });
    marco.addEventListener('pointermove', ev => {
      if (!punteros.has(ev.pointerId) || trabajando) return;
      const antes = punteros.get(ev.pointerId), ahora = enMarco(ev);
      punteros.set(ev.pointerId, ahora);
      if (punteros.size === 1) mover(ahora[0] - antes[0], ahora[1] - antes[1]);
      else if (punteros.size === 2 && pellizco) {
        const [a, b] = [...punteros.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        ampliar(pellizco.zoom * dist / pellizco.dist, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      ev.preventDefault();
    });
    const fin = ev => { punteros.delete(ev.pointerId); if (punteros.size < 2) pellizco = null; };
    marco.addEventListener('pointerup', fin);
    marco.addEventListener('pointercancel', fin);
    // Rueda del ratón (o pellizco del trackpad): amplía hacia el puntero sin desplazar la página
    marco.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (trabajando) return;
      const p = enMarco(ev);
      ampliar(zoom * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)), p[0], p[1]);
    }, { passive: false });
    marco.addEventListener('keydown', ev => {
      if (trabajando) return;
      const paso = ev.shiftKey ? 40 : 10;
      const k = ev.key;
      if (k === 'ArrowLeft') mover(paso, 0);
      else if (k === 'ArrowRight') mover(-paso, 0);
      else if (k === 'ArrowUp') mover(0, paso);
      else if (k === 'ArrowDown') mover(0, -paso);
      else if (k === '+' || k === '=' || k === 'Add') ampliar(zoom * 1.1);
      else if (k === '-' || k === '_' || k === 'Subtract' || k === '−') ampliar(zoom / 1.1);
      else return;
      ev.preventDefault();
    });
    rango.addEventListener('input', () => ampliar(+rango.value));
    const ajustar = () => pintar();
    window.addEventListener('resize', ajustar);

    function ocupar(si, texto) {
      trabajando = si;
      if (si) d.setAttribute('aria-busy', 'true'); else d.removeAttribute('aria-busy');
      d.querySelectorAll('button, input').forEach(b => { b.disabled = si || (b === rango && zMax <= 1); });
      marco.setAttribute('aria-disabled', String(si));
      usar.textContent = si ? 'Guardando…' : 'Usar esta foto';
      estado.textContent = texto || '';
    }
    d.addEventListener('click', async ev => {
      const b = ev.target.closest('.botones-form > button');
      if (!b || trabajando) return;
      if (b.value === 'no') { d.cerrar(); return; }
      error.hidden = true;
      limitar();
      const m = menor / zoom;
      const recorte = { x: cx - m / 2, y: cy - m / 2, lado: m }; // instantánea del recorte
      ocupar(true, 'Guardando la foto…');
      try {
        await alUsar(recorte);
        ocupar(false);
        d.cerrar();
      } catch (e) {
        if (!(e && e.foto)) Cueva.registrar('No se ha podido guardar la foto', e);
        ocupar(false);
        error.textContent = mensaje(e, 'guardar');
        error.hidden = false;
        usar.focus();
      }
    });
    d.addEventListener('foto-cerrado', () => {
      window.removeEventListener('resize', ajustar);
      lienzo.width = lienzo.height = 0;
      img.cerrar();
    });
    pintar();
    usar.focus();
  }

  // ---------- Flujo completo: cambiar la foto ----------
  // o = { socioId, rutaAnterior, aviso (true = mostrar antes el aviso de privacidad), foco (id del botón al que volver),
  //       alGuardar(fila) }
  function cambiar(o) {
    if (ocupado) return;
    const op = { socioId: o.socioId, rutaAnterior: o.rutaAnterior || null, foco: o.foco, alGuardar: o.alGuardar }; // instantánea
    const abrirSelector = () => elegir(async archivo => {
      if (ocupado) return;
      let img;
      const soltar = bloquear();
      try {
        img = await leer(archivo);
      } catch (e) {
        Cueva.aviso(mensaje(e), 'err');
        return;
      } finally {
        soltar();
      }
      recortar(img, async recorte => {
        const r = await procesar(img, recorte);
        const fila = await subir(op.socioId, r.foto, r.mini, op.rutaAnterior);
        if (op.alGuardar) op.alGuardar(fila);
        Cueva.aviso('Foto guardada.', 'ok');
      }, op.foco);
    });
    if (o.aviso) {
      preguntar({ titulo: 'Antes de añadir tu foto', texto: 'Tu foto la ven solo tú y la administración del club, y se usa en tu carné de socio.',
        si: 'Entendido, continuar', foco: op.foco, alAceptar: abrirSelector });
    } else abrirSelector();
  }

  // ---------- Quitar la foto ----------
  // o = { socioId, ruta, foco, alQuitar(fila) }. Pide confirmación; pone foto_url y foto_mini a null en el mismo update
  // (comprobando 1 fila) y solo entonces borra el objeto.
  function quitar(o) {
    if (ocupado) return;
    const id = String(o.socioId || ''), ruta = typeof o.ruta === 'string' ? o.ruta : null; // instantánea
    preguntar({ titulo: 'Quitar la foto', texto: 'La foto se borrará y se volverá a mostrar la inicial. No se puede deshacer.',
      si: 'Quitar foto', peligro: true, foco: o.foco, alAceptar: async () => {
        if (ocupado) return;
        const soltar = bloquear();
        let fila;
        try {
          const sb = await Cueva.cliente();
          const u = await sb.from('socios').update({ foto_url: null, foto_mini: null }).eq('id', id).select('id,foto_url,foto_mini');
          if (u.error) throw u.error;
          if (!Array.isArray(u.data) || u.data.length !== 1) throw { sinFilas: true };
          fila = u.data[0];
          if (ruta) {
            try { const b = await sb.storage.from(CUBO).remove([ruta]); if (b.error) throw b.error; } catch (e) { Cueva.registrar('No se ha podido borrar la foto quitada', e); }
          }
        } catch (e) {
          Cueva.registrar('No se ha podido quitar la foto', e);
          Cueva.aviso(mensaje(e, 'quitar'), 'err');
          return;
        } finally {
          soltar();
        }
        if (o.alQuitar) o.alQuitar(fila);
        // El botón "Quitar foto" ya no está: el foco pasa al de añadir/cambiar
        const a = document.activeElement, f = o.foco && document.getElementById(o.foco);
        if (f && (!a || a === document.body || !a.getClientRects().length)) f.focus({ preventScroll: true });
        Cueva.aviso('Foto quitada.', 'ok');
      } });
  }

  return { cargar, liberar, leer, procesar, centrado, subir, cambiar, quitar, borrarTodas, mensaje, ocupado: () => ocupado };
})();
