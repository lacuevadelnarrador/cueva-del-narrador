// CARNÉ DE SOCIO (carne.js, solo lo carga perfil.html): dibuja las dos caras y prepara el PDF y el PNG.
// - Todo se genera en el navegador del propio socio (canvas): no se sube nada a ningún servidor ni se usan librerías.
// - Tarjeta de 85,6 x 54 mm a 300 ppp (1011 x 638 px). El PDF se escribe a mano: 2 páginas del tamaño exacto de la
//   tarjeta, cada una con su JPEG a página completa. Sin metadatos: el PDF no lleva el nombre de la persona.
// - Nada en la consola (los fallos van a Cueva.registrar desde quien llama) ni en el dispositivo. Los object URL que
//   se crean para descargar se liberan solos al poco rato o con Carne.liberarUrls().
(function () {
  const ANCHO = 1011, ALTO = 638, RADIO = 37;
  // 85,6 x 54 mm en puntos (1 pt = 1/72 pulgada = 25,4/72 mm)
  const PAGINA = { ancho: '242.65', alto: '153.07' };
  const COLOR = { verde: '#3E6F77', verdeOscuro: '#2F5860', aqua: '#A9DDE2', ambar: '#FFBA55', tinta: '#14262A',
    crema: '#EBEDEF', contorno: '#C9D3D5', texto: '#22393E' };
  const OSWALD = 'Oswald, "Arial Narrow", Impact, sans-serif';
  const LORA = 'Lora, Georgia, serif';
  const CALIGRAFICA = '"Great Vibes", "Brush Script MT", "Segoe Script", cursive';
  const LOGO = 'img/logo-completo.png';

  // ---------- Utilidades ----------
  const limpio = t => String(t == null ? '' : t).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const conTiempo = (p, ms) => Promise.race([p, new Promise(ok => setTimeout(ok, ms))]);
  // Curso en vigor: de septiembre a diciembre, año actual - siguiente; de enero a agosto, anterior - actual.
  function curso(fecha) {
    const d = fecha || new Date(), a = d.getFullYear();
    return d.getMonth() >= 8 ? a + '-' + (a + 1) : (a - 1) + '-' + a;
  }
  // Para el nombre de los archivos: solo el código (nunca el nombre), con caracteres seguros.
  function nombreSeguro(codigo) {
    const c = limpio(codigo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return c || 'socio';
  }
  function imagen(src) {
    return new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => (i.naturalWidth && i.naturalHeight ? ok(i) : mal(new Error('imagen vacía')));
      i.onerror = () => mal(new Error('imagen'));
      i.src = src;
    });
  }
  const aBlob = (lienzo, tipo, q) => new Promise((ok, mal) => lienzo.toBlob(b => (b ? ok(b) : mal(new Error('toBlob'))), tipo, q));
  const bytesDe = b => (b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer()).then(x => new Uint8Array(x));
  function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const soltarLienzo = c => { if (c) { c.width = 0; c.height = 0; } };

  // ---------- Fuentes ----------
  // Espera a Oswald, Lora y Great Vibes (con límite de tiempo: si alguna no carga, se dibuja con la alternativa).
  async function fuentes() {
    if (!document.fonts || !document.fonts.load) return;
    const pide = f => document.fonts.load(f).catch(() => []);
    await conTiempo(Promise.all([pide('500 56px Oswald'), pide('400 37px Lora'), pide('400 80px "Great Vibes"')]), 6000);
    await conTiempo(document.fonts.ready, 3000);
  }

  // ---------- Dibujo ----------
  function rectRedondo(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }
  // Ajusta el tamaño de letra hasta que el texto quepa en "max" px (sin bajar de "min").
  function ajustar(x, t, peso, familia, tam, min, max) {
    for (; tam > min; tam -= 1) { x.font = peso + ' ' + tam + 'px ' + familia; if (x.measureText(t).width <= max) return tam; }
    x.font = peso + ' ' + min + 'px ' + familia;
    return min;
  }
  // Recorta con "…" lo que no quepa ni con la letra más pequeña.
  function recortar(x, t, max) {
    if (x.measureText(t).width <= max) return t;
    const c = Array.from(t);
    while (c.length > 1 && x.measureText(c.join('') + '…').width > max) c.pop();
    return c.join('').trim() + '…';
  }
  // Texto en mayúsculas con espaciado entre letras, centrado en cx (letra a letra: igual en todos los navegadores).
  function espaciado(x, t, cx, base, esp) {
    const letras = Array.from(t), anchos = letras.map(l => x.measureText(l).width);
    let px = cx - (anchos.reduce((a, b) => a + b, 0) + esp * (letras.length - 1)) / 2;
    x.textAlign = 'left';
    letras.forEach((l, i) => { x.fillText(l, px, base); px += anchos[i] + esp; });
  }
  // Línea base para centrar verticalmente un texto en "medio".
  function baseCentrada(x, t, medio) {
    const m = x.measureText(t);
    return m.actualBoundingBoxAscent != null ? medio + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : medio + parseFloat(x.font) * 0.35;
  }

  function anverso(foto, logo) {
    const c = lienzo(ANCHO, ALTO), x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    rectRedondo(x, 0, 0, ANCHO, ALTO, RADIO);
    x.clip();
    x.fillStyle = COLOR.verde;
    x.fillRect(0, 0, ANCHO, ALTO);

    // Foto (cuadrado redondeado, recorte "cover" centrado) o silueta sobre aqua
    const L = 363, FX = 56, FY = 98;
    x.save();
    rectRedondo(x, FX, FY, L, L, 31);
    x.clip();
    if (foto) {
      const w = foto.naturalWidth, h = foto.naturalHeight, lado = Math.min(w, h);
      x.drawImage(foto, (w - lado) / 2, (h - lado) / 2, lado, lado, FX, FY, L, L);
    } else {
      x.fillStyle = COLOR.aqua;
      x.fillRect(FX, FY, L, L);
      x.fillStyle = COLOR.verde;
      x.beginPath();
      x.arc(FX + L / 2, FY + 148, 74, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.ellipse(FX + L / 2, FY + L + 40, 150, 150, 0, Math.PI, 0);
      x.fill();
    }
    x.restore();

    // Logo original del club (o, si no se puede cargar, el nombre en letras)
    const CX = 715;
    if (logo) {
      const lw = 390, lh = Math.round(lw * logo.naturalHeight / logo.naturalWidth);
      x.drawImage(logo, CX - lw / 2, 56, lw, lh);
    } else {
      x.fillStyle = '#FFFFFF';
      x.font = '500 46px ' + OSWALD;
      espaciado(x, 'LA CUEVA', CX, 210, 4);
      espaciado(x, 'DEL NARRADOR', CX, 270, 4);
    }

    // "Club de escritura" en letra caligráfica
    x.fillStyle = '#FFFFFF';
    ajustar(x, 'Club de escritura', '400', CALIGRAFICA, 80, 50, 540);
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.fillText('Club de escritura', CX, 516);

    // Franja ámbar inferior (las esquinas de abajo quedan redondeadas por el recorte de la tarjeta)
    x.fillStyle = COLOR.ambar;
    x.fillRect(0, 575, ANCHO, ALTO - 575);
    x.fillStyle = COLOR.tinta;
    x.font = '500 31px ' + OSWALD;
    espaciado(x, 'CARNÉ DE SOCIO/A', ANCHO / 2, baseCentrada(x, 'CARNÉ DE SOCIO/A', 575 + (ALTO - 575) / 2), 7);
    return c;
  }

  // Nombre y apellidos: una línea de 56 px reduciendo hasta 34; si no cabe, dos líneas (y "…" como último recurso).
  function pintarNombre(x, nombre) {
    const MAX = 870, X = 70;
    x.fillStyle = COLOR.verdeOscuro;
    x.textAlign = 'left';
    const tam = ajustar(x, nombre, '500', OSWALD, 56, 34, MAX);
    if (x.measureText(nombre).width <= MAX || tam > 34) { x.fillText(nombre, X, 167); return; }
    let lineas = null;
    for (let t = 40; t >= 28 && !lineas; t -= 1) {
      x.font = '500 ' + t + 'px ' + OSWALD;
      const p = partir(x, nombre);
      if (p.every(l => x.measureText(l).width <= MAX) || t === 28) lineas = { t, p };
    }
    const b2 = 172, b1 = Math.round(b2 - lineas.t * 1.12);
    x.fillText(recortar(x, lineas.p[0], MAX), X, b1);
    x.fillText(recortar(x, lineas.p[1], MAX), X, b2);
  }
  // Parte el nombre en dos líneas lo más igualadas posible (por palabras; si es una sola palabra, por letras).
  function partir(x, t) {
    const pal = t.split(' ');
    if (pal.length < 2) { const c = Array.from(t), m = Math.ceil(c.length / 2); return [c.slice(0, m).join(''), c.slice(m).join('')]; }
    let mejor = null;
    for (let i = 1; i < pal.length; i++) {
      const a = pal.slice(0, i).join(' '), b = pal.slice(i).join(' ');
      const w = Math.max(x.measureText(a).width, x.measureText(b).width);
      if (!mejor || w < mejor.w) mejor = { a, b, w };
    }
    return [mejor.a, mejor.b];
  }

  function reverso(nombre, codigo, hoy) {
    const c = lienzo(ANCHO, ALTO), x = c.getContext('2d');
    x.save();
    rectRedondo(x, 0, 0, ANCHO, ALTO, RADIO);
    x.clip();
    x.fillStyle = COLOR.crema;
    x.fillRect(0, 0, ANCHO, ALTO);
    x.fillStyle = COLOR.verde;
    x.fillRect(0, 0, ANCHO, 77);
    x.fillStyle = '#FFFFFF';
    x.font = '500 31px ' + OSWALD;
    espaciado(x, 'LA CUEVA DEL NARRADOR', ANCHO / 2, baseCentrada(x, 'LA CUEVA DEL NARRADOR', 38.5), 5);

    x.textBaseline = 'alphabetic';
    pintarNombre(x, nombre || 'Socio/a');

    const linea = 'Socio nº ' + (codigo || '—') + ' · Curso ' + curso(hoy);
    x.fillStyle = COLOR.verde;
    x.textAlign = 'left';
    ajustar(x, linea, '400', LORA, 42, 28, 870);
    x.fillText(recortar(x, linea, 870), 70, 234);

    x.strokeStyle = COLOR.ambar;
    x.lineWidth = 9;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(70, 275);
    x.lineTo(280, 275);
    x.stroke();

    const texto = (t, y, color) => { x.fillStyle = color; ajustar(x, t, '400', LORA, 37, 26, 870); x.fillText(t, 70, y); };
    texto('Carné personal e intransferible.', 342, COLOR.texto);
    texto('Válido durante el curso en vigor.', 390, COLOR.texto);
    texto('lacuevadelnarrador.es · @lacuevadelnarrador', 460, COLOR.verde);
    texto('lacuevadelnarrador@gmail.com', 509, COLOR.verde);
    texto('Reuniones: miércoles de 18:00 a 20:00', 558, COLOR.verde);
    x.restore();

    // Contorno fino
    x.strokeStyle = COLOR.contorno;
    x.lineWidth = 3;
    rectRedondo(x, 1.5, 1.5, ANCHO - 3, ALTO - 3, RADIO - 1.5);
    x.stroke();
    return c;
  }

  // Dibuja las dos caras. "foto" es un object URL (blob:) o null; quien llama lo libera.
  // Devuelve { anverso, reverso, conFoto } (dos lienzos de 1011 x 638).
  async function dibujar(o) {
    await fuentes();
    const [foto, logo] = await Promise.all([
      o.foto ? imagen(o.foto).catch(() => null) : null,
      imagen(LOGO).catch(() => null)
    ]);
    return { anverso: anverso(foto, logo), reverso: reverso(limpio(o.nombre), limpio(o.codigo), o.hoy), conFoto: !!foto };
  }
  function soltar(caras) { if (caras) { soltarLienzo(caras.anverso); soltarLienzo(caras.reverso); } }

  // ---------- PDF mínimo (escrito a mano) ----------
  // jpegs: [{ bytes: Uint8Array, ancho, alto }] → Uint8Array con un PDF de una página por imagen, a página completa.
  function construirPdf(jpegs) {
    const partes = [], desplaz = [];
    let pos = 0;
    const bin = u8 => { partes.push(u8); pos += u8.length; };
    const txt = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; bin(u); };
    const obj = (n, cuerpo) => { desplaz[n] = pos; txt(n + ' 0 obj\n' + cuerpo + '\nendobj\n'); };
    txt('%PDF-1.4\n');
    bin(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // comentario binario: marca el archivo como binario
    const n = jpegs.length, pag = i => 3 + i * 3;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + jpegs.map((_, i) => pag(i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
    jpegs.forEach((j, i) => {
      const p = pag(i), cont = p + 1, img = p + 2;
      obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGINA.ancho + ' ' + PAGINA.alto + '] ' +
        '/Resources << /XObject << /Im' + i + ' ' + img + ' 0 R >> >> /Contents ' + cont + ' 0 R >>');
      const flujo = 'q\n' + PAGINA.ancho + ' 0 0 ' + PAGINA.alto + ' 0 0 cm\n/Im' + i + ' Do\nQ';
      obj(cont, '<< /Length ' + flujo.length + ' >>\nstream\n' + flujo + '\nendstream');
      desplaz[img] = pos;
      txt(img + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + j.ancho + ' /Height ' + j.alto +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.bytes.length + ' >>\nstream\n');
      bin(j.bytes);
      txt('\nendstream\nendobj\n');
    });
    const total = 3 + n * 3, inicioXref = pos;
    let xref = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let k = 1; k < total; k++) xref += String(desplaz[k]).padStart(10, '0') + ' 00000 n \n';
    txt(xref + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + inicioXref + '\n%%EOF\n');
    const out = new Uint8Array(pos);
    let k = 0;
    partes.forEach(u => { out.set(u, k); k += u.length; });
    return out;
  }

  // JPEG de una cara: fuera de las esquinas redondeadas, fondo blanco.
  async function jpeg(cara) {
    const c = lienzo(cara.width, cara.height), x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(cara, 0, 0);
    try { return { bytes: await bytesDe(await aBlob(c, 'image/jpeg', 0.92)), ancho: c.width, alto: c.height }; }
    finally { soltarLienzo(c); }
  }
  // PNG con las dos caras apiladas (anverso arriba), separadas 40 px, sobre blanco.
  async function png(caras) {
    const SEP = 40, c = lienzo(ANCHO, ALTO * 2 + SEP), x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(caras.anverso, 0, 0);
    x.drawImage(caras.reverso, 0, ALTO + SEP);
    try { return await aBlob(c, 'image/png'); } finally { soltarLienzo(c); }
  }
  // Los dos archivos listos para descargar o compartir. Nombres con el código, nunca con el nombre.
  async function archivos(caras, codigo) {
    const base = 'carne-' + nombreSeguro(codigo);
    const jpegs = [await jpeg(caras.anverso), await jpeg(caras.reverso)];
    return {
      pdf: new Blob([construirPdf(jpegs)], { type: 'application/pdf' }),
      png: await png(caras),
      nombrePdf: base + '.pdf',
      nombrePng: base + '.png'
    };
  }

  // ---------- Descargar ----------
  const urls = new Set();
  function crearUrl(blob, ms) {
    const u = URL.createObjectURL(blob);
    urls.add(u);
    if (ms) setTimeout(() => soltarUrl(u), ms);
    return u;
  }
  function soltarUrl(u) { if (urls.delete(u)) URL.revokeObjectURL(u); }
  function liberarUrls() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
  // La app instalada en iPhone (y navegadores sin <a download>) no descarga: se abre el archivo en otra pestaña.
  const sinDescarga = () => navigator.standalone === true || !('download' in HTMLAnchorElement.prototype);
  // Devuelve { modo: 'descarga' | 'pestana' } o { modo: 'enlace', url } si el navegador bloquea la pestaña nueva
  // (quien llama ofrece entonces un enlace; esa URL se libera con soltarUrl o liberarUrls).
  function descargar(blob, nombre) {
    if (sinDescarga()) {
      const u = crearUrl(blob, 0);
      const w = window.open(u, '_blank');
      if (w) { try { w.opener = null; } catch (e) {} setTimeout(() => soltarUrl(u), 120000); return { modo: 'pestana' }; }
      return { modo: 'enlace', url: u };
    }
    const u = crearUrl(blob, 30000);
    const a = document.createElement('a');
    a.href = u;
    a.download = nombre;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { modo: 'descarga' };
  }

  // ---------- Compartir (Web Share API con archivos) ----------
  // 'pdf' si se puede compartir el PDF, 'png' si solo la imagen, o null (entonces el botón se oculta).
  function compartible() {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return null;
    const prueba = (n, t) => { try { return navigator.canShare({ files: [new File([new Uint8Array(1)], n, { type: t })] }); } catch (e) { return false; } };
    if (prueba('carne.pdf', 'application/pdf')) return 'pdf';
    if (prueba('carne.png', 'image/png')) return 'png';
    return null;
  }
  // Devuelve 'ok', 'cancelado' (el socio cerró el menú: no es un error) o 'no' (no se admite). Otros fallos se lanzan.
  async function compartir(a) {
    const opciones = [[a.pdf, a.nombrePdf, 'application/pdf'], [a.png, a.nombrePng, 'image/png']];
    for (const [blob, nombre, tipo] of opciones) {
      const f = new File([blob], nombre, { type: tipo });
      let vale = false;
      try { vale = navigator.canShare({ files: [f] }); } catch (e) {}
      if (!vale) continue;
      try { await navigator.share({ files: [f], title: 'Carné de socio · La Cueva del Narrador' }); return 'ok'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; throw e; }
    }
    return 'no';
  }

  window.Carne = { ANCHO, ALTO, curso, nombreSeguro, dibujar, soltar, archivos, construirPdf, descargar, soltarUrl, liberarUrls, compartible, compartir };
})();
