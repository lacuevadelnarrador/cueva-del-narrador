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

  // La fecha de Madrid (Zip.ahoraMadrid) y el zip (Zip.crear) están en zip.js, compartidos con las entregas de los retos.

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
    const f = Zip.ahoraMadrid();
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
    const blob = Zip.crear(archivos, f);
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
