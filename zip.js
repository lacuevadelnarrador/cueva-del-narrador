// ZIP Y FECHA DE MADRID (código común a la copia de seguridad y a las entregas de los retos)
// Todo se hace en memoria: Zip.crear devuelve un Blob. Quien lo descarga crea la dirección blob: y la libera con revokeObjectURL.

const Zip = (function () {
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
  // Sin ZIP64: hasta 65.535 entradas y 4 GB, de sobra para el club.
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
  function crear(archivos, f) {
    const utf8 = new TextEncoder();
    const horaDos = (f.h << 11) | (f.min << 5) | (f.s >> 1);
    const fechaDos = ((f.a - 1980) << 9) | (f.m << 5) | f.d;
    const partes = [], central = [];
    let desplazamiento = 0;
    if (archivos.length > 0xFFFF) throw { mensaje: 'Hay demasiados archivos para un zip.' };
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
    if (desplazamiento + tamCentral > 0xFFFFFFFF) throw { mensaje: 'Los archivos ocupan demasiado para un zip (más de 4 GB).' };
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);      // firma del fin del directorio central
    fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
    return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]), { type: 'application/zip' });
  }

  // Descarga un Blob con ese nombre y libera la memoria en cuanto el navegador ha tenido tiempo de empezar la descarga.
  function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return { ahoraMadrid, crear, descargar };
})();
