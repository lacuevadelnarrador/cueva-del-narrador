// PANEL DE ADMINISTRACIÓN (código común a admin.html y admin-*.html)
// - Cada página llama a Admin.iniciar(): exige sesión, cuenta activa y rol = 'admin' (si no, redirige).
// - Ocultar botones no protege nada: quien puede escribir lo deciden las políticas (RLS) de la base de datos.
//   Por eso cada escritura termina en .select() y se comprueba que de verdad ha cambiado alguna fila.
// - Solo se usa la publishable key con la sesión del usuario (la de supabase-config.js).
// - Todo lo que viene de la base de datos se escapa con Admin.esc antes de pintarlo.

const Admin = (function () {
  const esc = Cueva.esc;
  const dos = n => String(n).padStart(2, '0');

  // ---------- Guardia y cliente ----------
  let promesaGuardia = null, cliente = null;
  function iniciar() {
    if (!promesaGuardia) {
      promesaGuardia = Cueva.admin().then(r => { cliente = r.sb; return r.sb; });
      promesaGuardia.catch(() => { promesaGuardia = null; }); // si falla la conexión, "Reintentar" vuelve a comprobar
    }
    return promesaGuardia;
  }
  const sb = () => cliente;

  // ---------- Fechas y horas ----------
  // La base de datos guarda las fechas como 'AAAA-MM-DD', sin hora. Se trabaja siempre con ese texto
  // (sin convertir a UTC) para que un 14/10 no se vea nunca como 13/10 por la zona horaria.
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const partes = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? { a: +m[1], m: +m[2], d: +m[3] } : null; };
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); };
  const fecha = f => { const p = partes(f); return p ? dos(p.d) + '/' + dos(p.m) + '/' + p.a : ''; };
  const dia = f => { const p = partes(f); return p ? dos(p.d) : ''; };
  const diaSemana = f => { const p = partes(f); return p ? DIAS[new Date(p.a, p.m - 1, p.d).getDay()] : ''; };
  const mes = f => { const p = partes(f); return p ? MESES[p.m - 1] + ' ' + p.a : 'Sin fecha'; };
  // La hora llega como "19:30:00": se muestra y se edita como "19:30".
  const hora = h => h ? String(h).slice(0, 5) : '';
  // Texto de un campo: sin espacios a los lados, y null si queda vacío.
  const texto = v => { const t = String(v == null ? '' : v).trim(); return t || null; };

  // Agrupa una lista ya ordenada: devuelve [[clave, [elementos]], ...] respetando el orden.
  function agrupar(lista, claveDe) {
    const grupos = [];
    lista.forEach(x => {
      const k = claveDe(x);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo[0] === k) ultimo[1].push(x); else grupos.push([k, [x]]);
    });
    return grupos;
  }

  // ---------- Vistas (lista, formulario...) con el botón "atrás" del móvil ----------
  // Cada vista es un <section id="vista-..."> dentro de <main>. La primera es la lista.
  const vistas = () => [...document.querySelectorAll('main > [id^="vista-"]')];
  function mostrar(id) {
    vistas().forEach(v => { v.hidden = v.id !== id; });
    migas(document.getElementById(id));
    window.scrollTo(0, 0);
    const v = document.getElementById(id);
    const foco = v && v.querySelector('[data-foco]');
    if (foco) foco.focus({ preventScroll: true });
  }
  // Tercer nivel de las migas de la cabecera ("Administración › Socios › Ficha"). Solo textos genéricos, nunca datos:
  // data-miga="texto fijo", o data-miga-de="id" de un título que solo lleva textos fijos ("Nuevo evento", "Editar reto"...).
  function migas(v) {
    const seccion = document.querySelector('.migas [data-miga-seccion]'), vista = document.querySelector('.migas [data-miga-vista]');
    if (!seccion || !vista) return;
    const origen = v && v.dataset.migaDe && document.getElementById(v.dataset.migaDe);
    const t = (v && v.dataset.miga) || (origen ? origen.textContent.trim() : '');
    vista.textContent = t;
    vista.hidden = !t;
    if (t) { vista.setAttribute('aria-current', 'page'); seccion.removeAttribute('aria-current'); }
    else { seccion.setAttribute('aria-current', 'page'); vista.removeAttribute('aria-current'); }
  }
  function abrir(id) {
    history.pushState({ vista: id }, '');
    mostrar(id);
  }
  // Vuelve a la vista anterior (como el botón "atrás").
  // Con form: solo si ese formulario sigue a la vista (si durante la espera se pulsó "atrás", ya no hay que volver).
  function cerrar(form) {
    if (form && !visible(form)) return;
    if (history.state && history.state.vista) history.back();
    else mostrar(vistas()[0].id);
  }
  window.addEventListener('popstate', e => {
    const id = e.state && e.state.vista;
    mostrar(id && document.getElementById(id) ? id : vistas()[0].id);
  });
  // Si se recarga la página con un formulario abierto, se empieza otra vez por la lista.
  if (history.state && history.state.vista) history.replaceState(null, '');
  document.addEventListener('click', e => { if (e.target.closest('[data-cancelar]')) cerrar(); });

  // ---------- Formularios ----------
  // Grupos de opciones: radios (una opción) o casillas (varias). Se tratan como un solo campo dentro de su <fieldset>.
  const enGrupo = el => el.type === 'radio' || el.type === 'checkbox';
  const delGrupo = el => [...el.form.querySelectorAll('input[name="' + el.name + '"]')];

  // datos: { nombreDelCampo: valor }. En un grupo de casillas, el valor es la lista de opciones marcadas.
  function rellenar(form, datos) {
    limpiar(form);
    Object.entries(datos).forEach(([k, v]) => {
      const el = form.elements[k];
      if (!el) return;
      const grupo = el instanceof RadioNodeList ? [...el] : enGrupo(el) ? [el] : null;
      if (grupo) {
        const marcados = (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
        grupo.forEach(r => { r.checked = marcados.includes(r.value); });
      } else {
        el.value = v == null ? '' : v;
      }
    });
  }
  function limpiar(form) {
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.error-campo').forEach(p => { p.hidden = true; p.textContent = ''; });
    estado(form, '');
  }

  function marcar(el, mensaje) {
    const caja = enGrupo(el) && el.closest('fieldset');
    // En un grupo, el id del error sale del <fieldset> (si tiene id) para no repetirse entre formularios de la misma página.
    const id = enGrupo(el) ? ((caja && caja.id) || el.name) : (el.id || el.name);
    const dentro = el.closest('.campo, .opciones') || el.parentNode;
    let p = dentro.querySelector('.error-campo');
    if (!p) {
      p = document.createElement('p');
      p.className = 'error-campo'; p.id = id + '-error';
      dentro.appendChild(p);
    }
    const objetivos = enGrupo(el) ? delGrupo(el) : [el];
    objetivos.forEach(o => {
      const desc = (o.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== p.id);
      if (mensaje) { o.setAttribute('aria-invalid', 'true'); desc.push(p.id); } else o.removeAttribute('aria-invalid');
      if (desc.length) o.setAttribute('aria-describedby', desc.join(' ')); else o.removeAttribute('aria-describedby');
    });
    p.textContent = mensaje || '';
    p.hidden = !mensaje;
  }

  // Marca los campos obligatorios (los que llevan el atributo required): asterisco en la etiqueta y
  // aria-required="true". Añade también la línea "* obligatorio" al formulario.
  // Hay que volver a llamarla si cambia qué campos son obligatorios (por ejemplo, la hora de un evento tipo reto);
  // entonces se quita también el error de un campo vacío que ha dejado de ser obligatorio.
  // En un grupo de casillas obligatorio (hay que marcar al menos una), el asterisco va en el <legend>. aria-required
  // no está permitido en un grupo de casillas, así que la obligación se explica con una pista enlazada al <fieldset>.
  // Si las casillas se pintan después (por ejemplo, al cargar de la base de datos), hay que volver a llamarla.
  function obligatorios(form) {
    if (!form.querySelector('.leyenda-obligatorio')) {
      const p = document.createElement('p');
      p.className = 'pista leyenda-obligatorio';
      p.textContent = '* obligatorio';
      form.querySelector('[data-estado]').before(p);
    }
    [...form.elements].forEach(el => {
      if (!el.name || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const radio = enGrupo(el);
      const grupo = radio ? el.closest('fieldset') : null;
      const etiqueta = radio ? grupo && grupo.querySelector('legend') : form.querySelector('label[for="' + el.id + '"]');
      const destino = el.type === 'checkbox' ? null : radio ? grupo : el;
      if (!etiqueta || (!destino && el.type !== 'checkbox')) return;
      let ast = etiqueta.querySelector('.ast');
      if (el.required && !ast) {
        ast = document.createElement('span');
        ast.className = 'ast'; ast.setAttribute('aria-hidden', 'true'); ast.textContent = ' *';
        etiqueta.appendChild(ast);
      } else if (!el.required && ast) ast.remove();
      if (destino) { if (el.required) destino.setAttribute('aria-required', 'true'); else destino.removeAttribute('aria-required'); }
      if (!el.required && !radio && !el.value.trim() && el.getAttribute('aria-invalid')) marcar(el, '');
    });
  }

  // Revisa los campos antes de enviar: obligatorios, fechas, horas, números, enlaces https:// y longitud máxima.
  // Los números son enteros, salvo que el campo tenga un step con decimales (step="0.01": hasta 2 decimales).
  // extra() puede devolver errores propios: { nombreDelCampo: 'mensaje' }. Devuelve true si todo está bien.
  function validar(form, extra) {
    const errores = {};
    const radios = new Set();
    [...form.elements].forEach(el => {
      if (!el.name || el.disabled || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (enGrupo(el)) {
        if (radios.has(el.name)) return;
        radios.add(el.name);
        const grupo = delGrupo(el);
        if (grupo.some(r => r.required) && !grupo.some(r => r.checked)) errores[el.name] = el.type === 'radio' ? 'Elige una opción.' : 'Elige al menos una opción.';
        return;
      }
      const v = el.value.trim();
      const decimales = el.type === 'number' ? ((el.getAttribute('step') || '').split('.')[1] || '').length : 0;
      const numero = decimales ? new RegExp('^\\d+(\\.\\d{1,' + decimales + '})?$') : /^\d+$/;
      let m = '';
      if (el.validity && el.validity.badInput) m = el.type === 'number' ? 'Escribe un número.' : el.type === 'time' ? 'La hora no es válida.' : 'La fecha no es válida.';
      else if (el.required && !v) m = 'Este campo es obligatorio.';
      else if (v && el.type === 'date' && !partes(v)) m = 'La fecha no es válida.';
      else if (v && el.type === 'time' && !/^\d{2}:\d{2}(:\d{2})?$/.test(v)) m = 'La hora no es válida.';
      else if (v && el.type === 'number' && decimales && (!numero.test(v) || (el.min !== '' && +v < +el.min))) m = 'Escribe un número' + (el.min !== '' ? ' igual o mayor que ' + el.min : '') + ', con ' + decimales + (decimales === 1 ? ' decimal' : ' decimales') + ' como máximo.';
      else if (v && el.type === 'number' && (!numero.test(v) || (el.min !== '' && +v < +el.min))) m = 'Escribe un número entero' + (el.min !== '' ? ' igual o mayor que ' + el.min : '') + '.';
      else if (el.maxLength > 0 && v.length > el.maxLength) m = 'Escribe ' + el.maxLength + ' caracteres como máximo (ahora hay ' + v.length + ').';
      else if (v && el.type === 'url' && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(v)) m = 'El enlace tiene que empezar por https:// (por ejemplo, https://drive.google.com/...).';
      if (m) errores[el.name] = m;
    });
    const mas = extra ? extra() || {} : {};
    Object.keys(mas).forEach(k => { if (!errores[k]) errores[k] = mas[k]; });

    const vistos = new Set();
    [...form.elements].forEach(el => {
      if (!el.name || vistos.has(el.name) || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      vistos.add(el.name);
      marcar(el, errores[el.name]);
    });
    const primero = form.querySelector('[aria-invalid="true"]');
    if (primero) {
      estado(form, 'Revisa los campos marcados.', true);
      primero.focus();
      return false;
    }
    estado(form, '');
    return true;
  }

  // Mensaje de estado dentro del formulario (Guardando…, o el error).
  function estado(form, mensaje, esError) {
    const p = form.querySelector('[data-estado]');
    if (!p) return;
    p.textContent = mensaje || '';
    p.hidden = !mensaje;
    p.className = 'msg' + (esError ? ' err' : '');
    p.setAttribute('role', esError ? 'alert' : 'status');
  }

  // Un error puede traer ya su texto para el usuario ({ mensaje: '...' }), por ejemplo los de la subida de portadas.
  function mensajeError(e) {
    if (e && e.mensaje) return e.mensaje;
    if (e && e.sinFilas) return 'No se ha hecho ningún cambio: no tienes permiso para esta operación o el elemento ya no existe. Recarga la página y vuelve a intentarlo.';
    if (Cueva.esErrorDeRed(e)) return 'No hay conexión con el servidor. Comprueba tu internet y vuelve a intentarlo.';
    const c = e && e.code;
    if (c === '42501' || (e && (e.status === 401 || e.status === 403))) return 'No tienes permiso para hacer este cambio.';
    if (c === '23505') return 'Ya existe un elemento con esos datos.';
    if (c === '23503') return 'Este elemento está relacionado con otros datos y no se puede guardar o borrar así.';
    if (c === '23502' || c === '23514' || c === '22P02' || c === '22007' || c === '22008') return 'Algún dato no tiene el formato que espera la base de datos. Revisa el formulario.';
    return 'No se ha podido completar la operación. Inténtalo de nuevo dentro de un momento.';
  }

  // ¿Está el formulario a la vista? (no lo está si su vista se ha ocultado, por ejemplo con el botón "atrás")
  const visible = form => !form.closest('[hidden]');

  // Error de una operación: en el formulario y, si ya no está a la vista, también como aviso flotante.
  function fallo(form, e) {
    const m = mensajeError(e);
    estado(form, m, true);
    if (!visible(form)) Cueva.aviso(m, 'err');
  }

  // ---------- Bloqueo durante una operación ----------
  // Desactiva todos los controles del formulario (también Cancelar) y deja inerte el resto de la página
  // (pestañas, listas, barra inferior...), para que no se pueda cambiar de registro mientras se guarda.
  // Si se intenta salir de la página, el navegador pide confirmación. Devuelve la función que lo deshace.
  // Se puede anidar: el formulario se desbloquea cuando se deshace el último bloqueo.
  let bloqueos = 0;
  window.addEventListener('beforeunload', e => { if (bloqueos) { e.preventDefault(); e.returnValue = ''; } });
  function bloquear(form) {
    if (form._bloqueo) { form._bloqueo.n++; return form._bloqueo.soltar; }
    bloqueos++;
    const activo = document.activeElement;
    const controles = [...form.querySelectorAll('button, input, select, textarea')].filter(c => !c.disabled);
    controles.forEach(c => { c.disabled = true; });
    const inertes = [];
    for (let n = form; n.parentElement && n !== document.body; n = n.parentElement) {
      [...n.parentElement.children].forEach(h => {
        if (h !== n && !h.inert && h.id !== 'avisos' && !/^(SCRIPT|DIALOG)$/.test(h.tagName)) { h.inert = true; inertes.push(h); }
      });
    }
    form.setAttribute('aria-busy', 'true');
    const b = {
      n: 1,
      soltar() {
        if (--b.n > 0) return;
        form._bloqueo = null; bloqueos--;
        controles.forEach(c => { c.disabled = false; });
        inertes.forEach(h => { h.inert = false; });
        form.removeAttribute('aria-busy');
        if (activo && form.contains(activo) && visible(form) && (document.activeElement === document.body || !document.activeElement)) activo.focus({ preventScroll: true });
      }
    };
    b.soltar = b.soltar.bind(b);
    form._bloqueo = b;
    return b.soltar;
  }

  // Lanza una escritura (insertar, editar o borrar) que termina en .select().
  // Mientras dura, el formulario y la página quedan bloqueados (evita los dobles envíos y los cambios de registro).
  // Si la base de datos no devuelve ninguna fila (RLS lo ha impedido sin dar error), se trata como error.
  // consulta puede ser una función async con varios pasos que devuelva { data, error } o lance un error.
  // Sin textoOk no se muestra el aviso de éxito.
  // Devuelve las filas afectadas, o null si ha fallado (el error queda escrito en el formulario).
  async function escribir(form, consulta, textoOk) {
    const soltar = bloquear(form);
    estado(form, 'Guardando…');
    try {
      const r = await consulta();
      if (r.error) throw r.error;
      if (!Array.isArray(r.data) || r.data.length === 0) throw { sinFilas: true };
      estado(form, '');
      if (textoOk) Cueva.aviso(textoOk, 'ok');
      return r.data;
    } catch (e) {
      Cueva.registrar('No se ha podido guardar', e);
      fallo(form, e);
      return null;
    } finally {
      soltar();
    }
  }

  // ---------- Diálogo de confirmación ----------
  // Devuelve una promesa: true si se pulsa el botón de aceptar, false si se cancela (o con Escape).
  function confirmar(pregunta, aceptar) {
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(pregunta));
    return new Promise(ok => {
      const d = document.createElement('dialog');
      d.className = 'dialogo';
      d.setAttribute('aria-labelledby', 'dialogo-titulo');
      d.setAttribute('aria-describedby', 'dialogo-texto');
      d.innerHTML = '<h2 id="dialogo-titulo">¿Seguro?</h2><p id="dialogo-texto">' + esc(pregunta) + '</p>' +
        '<div class="botones-form"><button type="button" class="btn sec" value="no">Cancelar</button>' +
        '<button type="button" class="btn peligro" value="si">' + esc(aceptar || 'Borrar') + '</button></div>';
      document.body.appendChild(d);
      let hecho = false;
      const terminar = si => {
        if (hecho) return;
        hecho = true;
        if (d.open) d.close();
        d.remove();
        ok(si);
      };
      d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) terminar(b.value === 'si'); });
      d.addEventListener('close', () => terminar(false)); // Escape
      d.showModal();
      d.querySelector('[value="no"]').focus();
    });
  }

  return { esc, iniciar, sb, hoy, fecha, dia, diaSemana, mes, hora, texto, agrupar, abrir, cerrar, mostrar, visible, rellenar, limpiar, obligatorios, validar, estado, mensajeError, fallo, bloquear, escribir, confirmar, aviso: Cueva.aviso };
})();
