// PANEL: COPIA DE SEGURIDAD (admin-copia.html). Solo administradores (Admin.iniciar).
// Genera en el navegador UN archivo cueva-copia-AAAA-MM-DD.zip (fecha de Madrid) con:
// - copia.json: el mismo formato "cueva-copia-1" que supabase_21_copia_seguridad.sql: un objeto con "formato", "fecha"
//   ('AAAA-MM-DDTHH:MM', hora de Madrid) y una clave por tabla (un array con todas sus columnas, select('*')), en el
//   mismo orden y con la misma ordenación que el script. De socios se quita foto_mini. Lo carga restaurar_copia_PLANTILLA.sql.
// - fotos/: la foto de cada socio (almacén privado fotos-socios), nombrada con su código (A-001.jpg).
// - LEEME.txt: la fecha, cómo restaurar y las fotos que no se hayan podido descargar.
// Privacidad: todo se hace en memoria (Blob) y la dirección blob: se libera con revokeObjectURL. No se guarda nada en
// localStorage/sessionStorage, la consola solo recibe errores sin datos (Cueva.registrar) y el service worker no
// guarda nada de esto (las peticiones a Supabase y las direcciones blob: no pasan por su caché).

(function () {
  const el = id => document.getElementById(id);
  const LOTE = 1000; // Supabase devuelve como máximo 1000 filas por consulta: se lee por tramos
  const CUBO_FOTOS = 'fotos-socios';
  const AVISO = 'Esta copia contiene datos personales y fotos de los socios. Guárdala solo en el Drive privado de administración y bórrala de este dispositivo después.';
  // [tabla, columnas de ordenación del script 21, desempate para que la lectura por tramos sea estable]
  const TABLAS = [
    ['generos', ['nombre']], ['cursos', ['id']], ['eventos', ['id']], ['documentos', ['id']], ['retos', ['id']],
    ['publicaciones', ['id']], ['libros', ['id']], ['libros_internos', ['libro_id']], ['lecturas', ['id']],
    ['recomendaciones', ['id']], ['perfiles', ['email'], 'id'], ['socios', ['codigo'], 'id'], ['cuotas', ['id']],
    ['asistencia', ['evento_id', 'socio_id']]
  ];

  // ---------- Fecha y hora de Madrid ----------
  function ahoraMadrid() {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return { a: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second,
      dia: p.year + '-' + p.month + '-' + p.day, hora: String(+p.hour % 24).padStart(2, '0') + ':' + p.minute };
  }

  // ---------- ZIP mínimo (método "stored", sin compresión) ----------
  // Cabecera local + datos por archivo, directorio central y fin de directorio. Nombres en UTF-8 (bit 11).
  // Sin ZIP64: hasta 65.535 entradas y 4 GB, de sobra para una copia del club.
  const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(datos) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // archivos: [{ nombre, datos: Uint8Array }] (un nombre acabado en "/" es una carpeta). f: fecha de ahoraMadrid().
  function zip(archivos, f) {
    const utf8 = new TextEncoder();
    const horaDos = (f.h << 11) | (f.min << 5) | (f.s >> 1);
    const fechaDos = ((f.a - 1980) << 9) | (f.m << 5) | f.d;
    const partes = [], central = [];
    let desplazamiento = 0;
    if (archivos.length > 0xFFFF) throw { mensaje: 'La copia tiene demasiados archivos para un zip.' };
    archivos.forEach(a => {
      const nombre = utf8.encode(a.nombre), datos = a.datos || new Uint8Array(0), carpeta = a.nombre.endsWith('/');
      const crc = crc32(datos), n = datos.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // firma de la cabecera local
      local.setUint16(4, 10, true);          // versión necesaria: 1.0 (stored)
      local.setUint16(6, 0x0800, true);      // nombres en UTF-8
      local.setUint16(8, 0, true);           // método 0: stored
      local.setUint16(10, horaDos, true); local.setUint16(12, fechaDos, true);
      local.setUint32(14, crc, true); local.setUint32(18, n, true); local.setUint32(22, n, true);
      local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);    // firma del directorio central
      cen.setUint16(4, 20, true);            // creado con: 2.0 (MS-DOS)
      cen.setUint16(6, 10, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, horaDos, true); cen.setUint16(14, fechaDos, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, n, true); cen.setUint32(24, n, true);
      cen.setUint16(28, nombre.length, true); // extra (30), comentario (32), disco (34), atributos internos (36): 0
      cen.setUint32(38, carpeta ? 0x10 : 0, true); // atributos externos: carpeta de MS-DOS
      cen.setUint32(42, desplazamiento, true);
      partes.push(new Uint8Array(local.buffer), nombre, datos);
      central.push(new Uint8Array(cen.buffer), nombre);
      desplazamiento += 30 + nombre.length + n;
    });
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    if (desplazamiento + tamCentral > 0xFFFFFFFF) throw { mensaje: 'La copia ocupa demasiado para un zip (más de 4 GB).' };
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);      // firma del fin del directorio central
    fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
    return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]), { type: 'application/zip' });
  }

  // ---------- Lectura ----------
  // Lee una tabla completa por tramos de 1000 filas, siempre con el mismo orden.
  async function todas(sb, tabla, orden, desempate) {
    const filas = [];
    for (let i = 0; ; i += LOTE) {
      let q = sb.from(tabla).select('*');
      orden.forEach(c => { q = q.order(c, { ascending: true }); });
      if (desempate) q = q.order(desempate, { ascending: true });
      const r = await q.range(i, i + LOTE - 1);
      if (r.error) throw r.error;
      const d = r.data || [];
      filas.push(...d);
      if (d.length < LOTE) return filas;
    }
  }
  // Nombre de archivo seguro a partir del código del socio (A-001 → A-001.jpg).
  const nombreFoto = (codigo, i) => (String(codigo || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_') || 'sin-codigo-' + (i + 1)) + '.jpg';

  // ---------- Página ----------
  const form = el('form-copia'), progreso = el('progreso'), barra = el('barra'), resultado = el('resultado');
  function avance(texto, valor, total) {
    progreso.textContent = texto;
    progreso.hidden = false;
    barra.hidden = false;
    barra.max = total; barra.value = valor;
  }
  function mostrarResultado(html, esError) {
    resultado.innerHTML = html;
    resultado.className = 'msg' + (esError ? ' err' : '');
    resultado.setAttribute('role', esError ? 'alert' : 'status');
    resultado.hidden = false;
  }

  // Aviso antes de descargar: true con "Descargar", false con "Cancelar" o Escape.
  function avisar() {
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(AVISO));
    return new Promise(ok => {
      const d = document.createElement('dialog');
      d.className = 'dialogo';
      d.setAttribute('aria-labelledby', 'aviso-titulo');
      d.setAttribute('aria-describedby', 'aviso-texto');
      d.innerHTML = '<h2 id="aviso-titulo">Antes de descargar</h2><p id="aviso-texto">' + Admin.esc(AVISO) + '</p>' +
        '<div class="botones-form"><button type="button" class="btn sec" value="no">Cancelar</button>' +
        '<button type="button" class="btn" value="si">Descargar</button></div>';
      document.body.appendChild(d);
      let hecho = false;
      const terminar = si => { if (hecho) return; hecho = true; if (d.open) d.close(); d.remove(); ok(si); };
      d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) terminar(b.value === 'si'); });
      d.addEventListener('close', () => terminar(false));
      d.showModal();
      d.querySelector('[value="no"]').focus();
    });
  }

  async function hacerCopia() {
    const sb = await Admin.iniciar();
    const f = ahoraMadrid();
    const total = TABLAS.length + 2; // + fotos (se ajusta al saber cuántas hay) + el archivo
    const copia = { formato: 'cueva-copia-1', fecha: f.dia + 'T' + f.hora };
    let filas = 0;
    for (let i = 0; i < TABLAS.length; i++) {
      const [tabla, orden, desempate] = TABLAS[i];
      avance('Leyendo datos (' + (i + 1) + ' de ' + TABLAS.length + ')…', i, total);
      copia[tabla] = await todas(sb, tabla, orden, desempate);
      filas += copia[tabla].length;
    }
    // Como el script 21: los socios sin la miniatura (foto_mini). La foto completa va aparte en fotos/.
    copia.socios = copia.socios.map(s => { const r = Object.assign({}, s); delete r.foto_mini; return r; });

    const conFoto = copia.socios.map((s, i) => ({ codigo: String(s.codigo || '').trim() || 'sin código', ruta: s.foto_url, nombre: nombreFoto(s.codigo, i) }))
      .filter(x => typeof x.ruta === 'string' && x.ruta);
    const totalPasos = TABLAS.length + conFoto.length + 1;
    const fotos = [], faltan = [];
    for (let i = 0; i < conFoto.length; i++) {
      const x = conFoto[i];
      avance('Descargando fotos ' + (i + 1) + '/' + conFoto.length + '…', TABLAS.length + i, totalPasos);
      try {
        const r = await sb.storage.from(CUBO_FOTOS).download(x.ruta);
        if (r.error || !r.data) throw r.error || {};
        fotos.push({ nombre: 'fotos/' + x.nombre, datos: new Uint8Array(await r.data.arrayBuffer()) });
      } catch (e) {
        Cueva.registrar('No se ha podido descargar una foto', e); // sin la ruta ni el código del socio
        faltan.push(x.codigo);
      }
    }

    avance('Generando el archivo…', totalPasos - 1, totalPasos);
    await new Promise(r => setTimeout(r, 30)); // deja que se pinte el texto antes de generar el zip
    const utf8 = new TextEncoder();
    const leeme = [
      'Copia de seguridad de La Cueva del Narrador',
      'Fecha: ' + f.dia.split('-').reverse().join('/') + ' a las ' + f.hora + ' (hora de Madrid)',
      'Formato: cueva-copia-1',
      '',
      'Contenido:',
      '- copia.json: los datos de todas las tablas.',
      '- fotos/: la foto de cada socio, nombrada con su código (por ejemplo A-001.jpg).',
      '',
      'Para restaurar, usar restaurar_copia_PLANTILLA.sql con copia.json.',
      '',
      faltan.length ? 'ATENCIÓN: ' + (faltan.length === 1 ? 'falta 1' : 'faltan ' + faltan.length) + ' de ' + conFoto.length + ' fotos, que no se han podido descargar: ' + faltan.join(', ') + '.'
        : 'Fotos: ' + conFoto.length + ' de ' + conFoto.length + '.',
      '',
      AVISO,
      ''
    ].join('\r\n');
    const archivos = [
      { nombre: 'copia.json', datos: utf8.encode(JSON.stringify(copia)) },
      { nombre: 'LEEME.txt', datos: utf8.encode(leeme) },
      { nombre: 'fotos/' }
    ].concat(fotos);
    const blob = zip(archivos, f);
    const nombre = 'cueva-copia-' + f.dia + '.zip';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Se libera la memoria en cuanto el navegador ha tenido tiempo de empezar la descarga.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    avance('Copia terminada.', totalPasos, totalPasos);
    return { nombre, filas, fotos: fotos.length, totalFotos: conFoto.length, faltan };
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    if (!(await avisar())) { el('descargar').focus(); return; }
    resultado.hidden = true;
    Admin.estado(form, '');
    const soltar = Admin.bloquear(form);
    try {
      const r = await hacerCopia();
      const plural = (n, uno, varios) => n.toLocaleString('es-ES') + ' ' + (n === 1 ? uno : varios);
      const base = 'Se ha descargado <b>' + Admin.esc(r.nombre) + '</b> con ' + plural(r.filas, 'fila', 'filas') + ' de ' + TABLAS.length + ' tablas y ' +
        r.fotos + ' de ' + plural(r.totalFotos, 'foto', 'fotos') + '. Guárdala en el Drive privado de administración y bórrala de este dispositivo.';
      if (r.faltan.length) {
        mostrarResultado(base + '<br><br>Faltan las fotos de: <b>' + r.faltan.map(Admin.esc).join(', ') + '</b> (no se han podido descargar). ' +
          'El LEEME.txt de la copia también lo indica. Puedes volver a intentarlo dentro de un momento.', true);
      } else {
        mostrarResultado(base, false);
        Cueva.aviso('Copia de seguridad descargada.', 'ok');
      }
    } catch (e) {
      Cueva.registrar('No se ha podido hacer la copia de seguridad', e);
      progreso.hidden = true; barra.hidden = true;
      mostrarResultado(Admin.esc('No se ha podido hacer la copia y no se ha descargado nada. ' + Admin.mensajeError(e)), true);
    } finally {
      soltar();
      el('descargar').focus();
    }
  });

  // El botón solo aparece cuando la base de datos confirma que eres administrador.
  Cueva.cargar(el('estado'), () => Admin.iniciar().then(() => ({ data: [] })), () => { el('estado').remove(); form.hidden = false; });
})();
