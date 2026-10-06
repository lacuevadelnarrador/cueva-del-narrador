// PORTADAS DE LIBROS (panel de administración; lo usa admin-libros.html)
// - La imagen se ajusta en el navegador ANTES de subirla: orientación EXIF, 360 px de ancho como máximo
//   (nunca se amplía) y JPEG con calidad 0,82, que baja si hace falta hasta que ocupe 500 KB o menos.
// - Se sube al almacén público "portadas" de Supabase con un nombre nuevo cada vez (sin sobrescribir).
// - El almacén solo admite jpeg/png/webp de hasta 512 KB y solo los administradores pueden escribir en él.
// - Un archivo solo se borra si su dirección es de este almacén.

const Portadas = (function () {
  const ALMACEN = 'portadas';
  const ANCHO_MAX = 360;
  const MAX_BYTES = 500 * 1024;
  const CALIDAD = 0.82, CALIDAD_MIN = 0.4, PASO = 0.07;
  const MAX_ENTRADA = 15 * 1024 * 1024; // para que el móvil no se quede sin memoria con fotos enormes
  const FORMATOS = ['image/jpeg', 'image/png', 'image/webp'];
  const PROPORCION = [0.55, 0.75];      // ancho / alto de una portada vertical

  // "El Señor de los Anillos" → "el-senor-de-los-anillos"
  function slug(t) {
    const s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return s || 'portada';
  }

  // Dirección pública de los archivos del almacén (termina en "/portadas/").
  const prefijo = sb => sb.storage.from(ALMACEN).getPublicUrl('x').data.publicUrl.slice(0, -1);

  // Nombre del archivo a partir de su dirección pública, o null si no es de este almacén.
  function archivoDeUrl(sb, url) {
    const p = prefijo(sb);
    if (!url || !String(url).startsWith(p)) return null;
    let n = String(url).slice(p.length).split(/[?#]/)[0];
    try { n = decodeURIComponent(n); } catch (e) { return null; }
    return n && !n.includes('/') && !n.includes('..') ? n : null;
  }

  // ---------- Ajuste de la imagen ----------
  // Devuelve { fuente, ancho, alto, cerrar } ya girada según su orientación EXIF.
  async function leer(archivo) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
        return { fuente: bmp, ancho: bmp.width, alto: bmp.height, cerrar: () => bmp.close && bmp.close() };
      } catch (e) { /* navegador sin esa opción: se usa <img>, que también respeta la orientación EXIF */ }
    }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw { mensaje: 'No se ha podido leer la imagen. Prueba con otro archivo JPG, PNG o WebP.' };
    }
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
  }

  const aJpeg = (lienzo, calidad) => new Promise((ok, mal) =>
    lienzo.toBlob(b => b ? ok(b) : mal({ mensaje: 'No se ha podido preparar la imagen. Prueba con otra.' }), 'image/jpeg', calidad));

  // Prepara el archivo elegido. Devuelve { blob, ancho, alto, calidad, vertical } o lanza { mensaje }.
  async function preparar(archivo) {
    if (!FORMATOS.includes(archivo.type)) throw { mensaje: 'Formato no admitido. Elige una imagen JPG, PNG o WebP.' };
    if (archivo.size > MAX_ENTRADA) throw { mensaje: 'La imagen es demasiado grande (más de 15 MB). Elige una más pequeña.' };
    const img = await leer(archivo);
    try {
      if (!img.ancho || !img.alto) throw { mensaje: 'No se ha podido leer la imagen. Prueba con otro archivo JPG, PNG o WebP.' };
      const escala = Math.min(1, ANCHO_MAX / img.ancho); // nunca se amplía
      const ancho = Math.max(1, Math.round(img.ancho * escala)), alto = Math.max(1, Math.round(img.alto * escala));
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho; lienzo.height = alto;
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#fff'; // las zonas transparentes de un PNG quedan blancas (JPEG no tiene transparencia)
      ctx.fillRect(0, 0, ancho, alto);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.fuente, 0, 0, ancho, alto);
      let calidad = CALIDAD, blob = await aJpeg(lienzo, calidad);
      while (blob.size > MAX_BYTES && calidad > CALIDAD_MIN) {
        calidad = Math.max(CALIDAD_MIN, Math.round((calidad - PASO) * 100) / 100);
        blob = await aJpeg(lienzo, calidad);
      }
      if (blob.size > MAX_BYTES) throw { mensaje: 'La imagen ocupa demasiado incluso comprimida al máximo. Prueba con otra.' };
      const p = ancho / alto;
      return { blob, ancho, alto, calidad, vertical: p >= PROPORCION[0] && p <= PROPORCION[1] };
    } finally {
      img.cerrar();
    }
  }

  // ---------- Almacén ----------
  function mensajeSubida(e) {
    const s = Number(e && (e.status || e.statusCode)), t = String((e && (e.message || e.error)) || '');
    if (Cueva.esErrorDeRed(e) || /failed to fetch|network/i.test(t)) return 'No se ha podido subir la portada: no hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.';
    if (s === 413 || /maximum allowed size|too large/i.test(t)) return 'La portada es demasiado grande para el almacén (máximo 512 KB).';
    if (s === 415 || /mime|content type|not supported/i.test(t)) return 'El almacén no admite este formato de imagen. Usa JPG, PNG o WebP.';
    if (s === 401 || s === 403 || /row-level security|unauthorized|not authorized|permission|policy/i.test(t)) return 'No tienes permiso para subir portadas.';
    if (s === 409 || /already exists|duplicate/i.test(t)) return 'Ya hay un archivo con ese nombre en el almacén. Vuelve a guardar.';
    return 'No se ha podido subir la portada. Inténtalo de nuevo dentro de un momento.';
  }

  // Sube la portada preparada. Devuelve { nombre, url } o lanza { mensaje }.
  async function subir(sb, preparada, titulo) {
    const nombre = slug(titulo) + '-' + Date.now() + '.jpg';
    let r;
    try {
      r = await sb.storage.from(ALMACEN).upload(nombre, preparada.blob, { contentType: 'image/jpeg', upsert: false });
    } catch (e) {
      Cueva.registrar('No se ha podido subir la portada', e);
      throw { mensaje: mensajeSubida(e) };
    }
    if (r.error) { Cueva.registrar('No se ha podido subir la portada', r.error); throw { mensaje: mensajeSubida(r.error) }; }
    return { nombre, url: sb.storage.from(ALMACEN).getPublicUrl(nombre).data.publicUrl };
  }

  // Borra un archivo del almacén por su nombre. Nunca lanza: un fallo aquí no debe parar nada (queda en la consola).
  async function borrarArchivo(sb, nombre) {
    if (!nombre) return false;
    try {
      const r = await sb.storage.from(ALMACEN).remove([nombre]);
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || !r.data.length) throw new Error('El almacén no ha borrado ' + nombre + ' (¿ya no existía o falta permiso?)');
      return true;
    } catch (e) {
      Cueva.registrar('No se ha podido borrar la portada antigua', e);
      return false;
    }
  }
  const borrar = (sb, url) => borrarArchivo(sb, archivoDeUrl(sb, url));

  // ---------- Campo "Portada" de un formulario ----------
  // raiz: el <div data-portada> con un <input type="file">, la vista previa, la información y el botón "Quitar".
  // El archivo se prepara al elegirlo (para ver la vista previa y los avisos), pero se sube al guardar.
  // Con { obligatoria: true } hay que tener portada (la que ya había o una nueva): revisar() lo comprueba.
  // El <input type="file"> no lleva name, así que Admin.validar no lo toca: su error lo gestiona este campo.
  function campo(raiz, opciones) {
    const obligatoria = !!(opciones && opciones.obligatoria);
    const entrada = raiz.querySelector('input[type="file"]');
    const previa = raiz.querySelector('[data-previa]');
    const info = raiz.querySelector('[data-info]');
    const aviso = raiz.querySelector('[data-aviso]');
    const quitar = raiz.querySelector('[data-quitar]');
    // preparando: el ajuste en curso de la imagen elegida (una promesa). turno cambia al abrir otro registro o
    // cerrar el formulario: el resultado de un ajuste de un turno anterior se descarta (no pasa al registro nuevo).
    let actual = null, titulo = '', nueva = null, quitada = false, preparando = null, turno = 0, urlPrevia = null, fallo = false;
    if (obligatoria) {
      // Igual que Admin.obligatorios: asterisco en la etiqueta (oculto al lector de pantalla) y aria-required.
      const etiqueta = raiz.querySelector('label[for="' + entrada.id + '"]');
      if (etiqueta && !etiqueta.querySelector('.ast')) {
        const ast = document.createElement('span');
        ast.className = 'ast'; ast.setAttribute('aria-hidden', 'true'); ast.textContent = ' *';
        etiqueta.appendChild(ast);
      }
      entrada.required = true;
      entrada.setAttribute('aria-required', 'true');
    }
    const tienePortada = () => !!(nueva || preparando || (actual && !quitada));

    // Mientras hay un error, el campo queda marcado (Admin.validar no deja guardar).
    // deImagen: el error es de la imagen elegida (no se ha podido ajustar) y "Descartar la imagen" lo quita.
    function error(m, deImagen) {
      fallo = !!(m && deImagen);
      let p = raiz.querySelector('.error-campo');
      if (!p) {
        p = document.createElement('p');
        p.className = 'error-campo'; p.id = entrada.id + '-error';
        raiz.appendChild(p);
      }
      p.textContent = m || ''; p.hidden = !m;
      const desc = (entrada.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== p.id);
      if (m) { entrada.setAttribute('aria-invalid', 'true'); desc.push(p.id); } else entrada.removeAttribute('aria-invalid');
      entrada.setAttribute('aria-describedby', desc.join(' '));
    }
    function pintar() {
      if (urlPrevia) { URL.revokeObjectURL(urlPrevia); urlPrevia = null; }
      const src = nueva ? (urlPrevia = URL.createObjectURL(nueva.blob)) : (!quitada && Cueva.urlSegura(actual));
      const c = colorPortada(titulo || '?');
      previa.innerHTML = src
        ? '<img class="portada" src="' + Cueva.esc(src) + '" alt="Vista previa de la portada">'
        : '<span class="portada" style="background:' + c[0] + ';color:' + c[1] + '" aria-hidden="true">' + Cueva.esc(Array.from(titulo || '?')[0]) + '</span>';
      info.textContent = nueva
        ? 'Nueva portada: ' + nueva.ancho + ' × ' + nueva.alto + ' px, ' + Math.round(nueva.blob.size / 1024) + ' KB (calidad ' + Math.round(nueva.calidad * 100) + ' %). Se subirá al guardar.'
        : preparando ? 'Preparando la imagen…' : quitada ? 'Se quitará la portada al guardar.' : actual ? 'Portada actual.'
        : obligatoria ? 'Sin portada: elige una imagen.' : 'Sin portada: se verá el bloque de color con la inicial.';
      aviso.hidden = !(nueva && !nueva.vertical);
      aviso.textContent = aviso.hidden ? '' : 'La portada no es vertical; se verá recortada en la app.';
      // Si es obligatoria, la portada existente no se puede quitar (solo cambiar por otra).
      quitar.hidden = !(nueva || preparando || fallo || (!obligatoria && actual && !quitada));
      quitar.textContent = fallo && !nueva ? 'Descartar la imagen' : 'Quitar portada';
    }

    const MSG_LEER = 'No se ha podido leer la imagen. Prueba con otro archivo JPG, PNG o WebP.';
    entrada.addEventListener('change', () => {
      const archivo = entrada.files && entrada.files[0];
      error('');
      nueva = null;
      if (!archivo) { preparando = null; pintar(); return; }
      info.textContent = 'Preparando la imagen…';
      const mio = turno;
      const p = preparar(archivo);
      preparando = p;
      // Solo se aplica al campo si sigue siendo el mismo registro y la última imagen elegida.
      p.then(r => {
        if (mio !== turno || preparando !== p) return;
        preparando = null; nueva = r; quitada = false; pintar();
      }, e => {
        if (mio !== turno || preparando !== p) return;
        Cueva.registrar('No se ha podido leer la imagen', e);
        preparando = null; nueva = null; entrada.value = '';
        error((e && e.mensaje) || MSG_LEER, true);
        pintar();
      });
      p.catch(() => {}); // el error ya se muestra arriba (o en el guardado que lo espera)
    });
    quitar.addEventListener('click', () => {
      if (nueva || preparando) { nueva = null; preparando = null; } else if (!fallo) quitada = true;
      entrada.value = ''; error('');
      pintar();
      entrada.focus();
    });

    // Deja el campo sin nada elegido y descarta cualquier ajuste en curso.
    function reiniciar() {
      turno++;
      nueva = null; preparando = null; quitada = false; entrada.value = ''; error('');
    }

    return {
      // Al abrir un registro: la portada que ya tiene (o null) y el título (para el bloque de color).
      poner(url, t) { reiniciar(); actual = url || null; titulo = t || ''; pintar(); },
      // Al cerrar el formulario.
      descartar() { reiniciar(); pintar(); },
      titulo(t) { titulo = t || ''; if (!nueva && (quitada || !actual)) pintar(); },
      // Instantánea del campo al pulsar Guardar (sin esperas): la portada que había, si se quita, y la nueva
      // (ya ajustada, o la promesa del ajuste en curso de la imagen elegida en ese momento).
      instantanea() { return { actual, quitar: quitada, nueva, preparando }; },
      // Antes de Admin.validar: marca el campo si falta una portada obligatoria (el foco lo pone Admin.validar,
      // que va al primer campo con error). Un error de la imagen elegida se mantiene. Devuelve true si está bien.
      revisar() {
        if (fallo) return false;
        if (obligatoria && !tienePortada()) { error('La portada es obligatoria.'); return false; }
        error('');
        return true;
      }
    };
  }

  // La imagen nueva de una instantánea: la ya ajustada o, si aún se estaba ajustando, la espera.
  // Lanza { mensaje } si no se ha podido ajustar. Devuelve null si no hay imagen nueva.
  async function imagenDe(foto) {
    if (foto.nueva) return foto.nueva;
    return foto.preparando ? await foto.preparando : null;
  }

  return { slug, archivoDeUrl, preparar, subir, borrar, borrarArchivo, campo, imagenDe, ANCHO_MAX, MAX_BYTES };
})();
