// PANEL: INFORMES (admin-informes.html): visitas a la parte pública, socios que han entrado, secciones más usadas
// por los socios y constancia semanal. Solo lee: uso_diario y actividad_diaria (solo las ve un administrador),
// la función informe_accesos_socios() (también solo para administradores) y el nombre y código de las fichas.
// El total de socios sale de informe_accesos_socios(), que solo devuelve las cuentas activas: así el total y la
// lista de "no han entrado" se refieren siempre a las mismas personas.
// Las fechas se calculan en hora de Madrid, como el servidor, y se tratan siempre como texto 'AAAA-MM-DD'.

(function () {
  const esc = Admin.esc, el = id => document.getElementById(id);
  const LOTE = 1000; // Supabase devuelve como máximo 1000 filas por consulta: se lee por tramos
  const SECCIONES = { inicio: 'Inicio', calendario: 'Calendario', curso: 'Curso', biblioteca: 'Biblioteca', mas: 'Más', perfil: 'Perfil' };

  // ---------- Fechas (hora de Madrid) ----------
  function hoyMadrid() {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  // Las cuentas con días se hacen en UTC sobre el texto de la fecha: así no influye la zona horaria del dispositivo.
  const utc = f => { const [a, m, d] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
  const sumar = (f, n) => { const d = utc(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lunes = f => sumar(f, -((utc(f).getUTCDay() + 6) % 7));
  // El curso empieza el 1 de septiembre (misma regla que el carné).
  const inicioCurso = f => { const [a, m] = f.split('-').map(Number); return (m >= 9 ? a : a - 1) + '-09-01'; };
  const corta = f => f.slice(8, 10) + '/' + f.slice(5, 7);
  const fechaValida = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : null;

  const HOY = hoyMadrid();
  const SIETE = sumar(HOY, -6); // los últimos 7 días: hoy y los 6 anteriores
  // Se leen de una vez los datos que cubren cualquiera de los tres periodos.
  const DESDE = [inicioCurso(HOY), sumar(HOY, -29)].sort()[0];
  const rango = p => p === 'curso' ? inicioCurso(HOY) : sumar(HOY, -(+p - 1));

  const numero = n => Number(n || 0).toLocaleString('es-ES');
  const plural = (n, uno, varios) => numero(n) + ' ' + (n === 1 ? uno : varios);
  function porcentaje(v, total) {
    if (!total) return '0 %';
    const p = Math.round(v * 100 / total);
    return (v > 0 && p === 0 ? 'menos del 1' : String(p)) + ' %';
  }

  // ---------- Lectura ----------
  // Pide la consulta por tramos de 1000 filas hasta traerlas todas. hacer() crea la consulta (con su orden fijo).
  async function todas(hacer) {
    const filas = [];
    for (let i = 0; ; i += LOTE) {
      const r = await hacer().range(i, i + LOTE - 1);
      if (r.error) throw r.error;
      const d = r.data || [];
      filas.push(...d);
      if (d.length < LOTE) return filas;
    }
  }

  let DATOS = null, periodo = '30';

  async function leer() {
    const sb = await Admin.iniciar();
    const [uso, actividad, accesos, socios] = await Promise.all([
      todas(() => sb.from('uso_diario').select('dia,zona,pagina,total').gte('dia', DESDE).lte('dia', HOY).order('dia').order('zona').order('pagina')),
      todas(() => sb.from('actividad_diaria').select('dia,socios_activos').gte('dia', DESDE).lte('dia', HOY).order('dia')),
      sb.rpc('informe_accesos_socios').then(r => { if (r.error) throw r.error; return r.data || []; }),
      todas(() => sb.from('socios').select('id,codigo,nombre_completo').order('id'))
    ]);
    // Una fila por socio activo, con su nombre y código de la ficha (si por lo que sea no se encuentra, quedan en blanco).
    const fichas = new Map(socios.map(s => [s.id, s]));
    const personas = accesos.map(a => {
      const s = fichas.get(a.socio_id) || {};
      return { nombre: s.nombre_completo || 'Sin nombre', codigo: s.codigo || '', ultimo: fechaValida(a.ultimo_acceso) };
    });
    return { data: { uso, actividad, personas } };
  }

  // ---------- Series por día o por semana ----------
  // Tramos del periodo: un día cada uno o, en "Curso completo", semanas de lunes a domingo (recortadas al periodo).
  function tramos(desde, semanas) {
    const t = [];
    if (!semanas) { for (let f = desde; f <= HOY; f = sumar(f, 1)) t.push({ desde: f, hasta: f }); return t; }
    for (let l = lunes(desde); l <= HOY; l = sumar(l, 7)) {
      const d = l < desde ? desde : l, h = sumar(l, 6) > HOY ? HOY : sumar(l, 6);
      t.push({ desde: d, hasta: h });
    }
    return t;
  }
  // porDia: Map 'AAAA-MM-DD' → número. Devuelve el valor de cada tramo.
  const valores = (t, porDia) => t.map(x => {
    let s = 0;
    for (let f = x.desde; f <= x.hasta; f = sumar(f, 1)) s += porDia.get(f) || 0;
    return s;
  });
  const etiqueta = x => x.desde === x.hasta ? x.desde : x.desde + ' a ' + x.hasta;

  // Gráfico de barras en HTML. Para el lector de pantalla: un resumen en el gráfico y la tabla completa debajo.
  function grafico(t, v, unidad, semanas) {
    const max = Math.max(0, ...v);
    const iMax = v.indexOf(max);
    const resumen = 'Gráfico de barras de ' + unidad + (semanas ? ' por semana' : ' por día') + ', del ' + t[0].desde + ' al ' + t[t.length - 1].hasta +
      '. Máximo: ' + numero(max) + (semanas ? ' en la semana del ' : ' el ') + t[iMax].desde + '. Los datos completos están en la tabla de debajo.';
    const barras = t.map((x, i) => '<span class="inf-col' + (v[i] ? '' : ' cero') + '" style="--v:' + (max ? Math.round(v[i] * 1000 / max) / 10 : 0) + '%" title="' +
      esc(etiqueta(x) + ': ' + numero(v[i])) + '"></span>').join('');
    const filas = t.map((x, i) => '<tr><th scope="row">' + esc(etiqueta(x)) + '</th><td>' + numero(v[i]) + '</td></tr>').join('');
    return '<div class="inf-graf" role="img" aria-label="' + esc(resumen) + '">' + barras + '</div>' +
      '<div class="inf-ejes" aria-hidden="true"><span>' + esc(corta(t[0].desde)) + '</span><span>' + esc(corta(t[t.length - 1].hasta)) + '</span></div>' +
      '<details class="inf-tabla"><summary>Ver los datos en una tabla</summary><table><thead><tr><th scope="col">' + (semanas ? 'Semana' : 'Día') +
      '</th><th scope="col">' + esc(unidad.charAt(0).toUpperCase() + unidad.slice(1)) + '</th></tr></thead><tbody>' + filas + '</tbody></table></details>';
  }

  // ---------- Bloques ----------
  function pintar() {
    const desde = rango(periodo), semanas = periodo === 'curso';
    const t = tramos(desde, semanas);
    const dentro = f => f >= desde && f <= HOY;
    el('rango').textContent = 'Del ' + desde + ' al ' + HOY + ' (hora de Madrid)' + (semanas ? ', por semanas de lunes a domingo.' : '.');

    // 1) Visitas a la parte pública
    const publica = new Map();
    let totalPublica = 0;
    DATOS.uso.forEach(u => {
      if (u.zona !== 'publica' || !dentro(u.dia)) return;
      const n = Number(u.total) || 0;
      publica.set(u.dia, (publica.get(u.dia) || 0) + n);
      totalPublica += n;
    });
    el('publica').innerHTML = totalPublica
      ? '<p class="inf-total"><b>' + numero(totalPublica) + '</b> ' + (totalPublica === 1 ? 'visita' : 'visitas') + ' en el periodo</p>' + grafico(t, valores(t, publica), 'visitas', semanas)
      : '<p class="empty">Todavía no hay visitas a la parte pública en este periodo.</p>';

    // 2) Socios que han entrado
    const activos = new Map();
    DATOS.actividad.forEach(a => { if (dentro(a.dia)) activos.set(a.dia, (activos.get(a.dia) || 0) + (Number(a.socios_activos) || 0)); });
    const total = DATOS.personas.length;
    const entraron = DATOS.personas.filter(p => p.ultimo && p.ultimo >= desde).length;
    const v2 = valores(t, activos);
    el('socios').innerHTML = (total
      ? '<p class="inf-total"><b>' + numero(entraron) + ' de ' + numero(total) + '</b> socios han entrado al menos una vez en el periodo</p>'
      : '<p class="empty">Todavía no hay socios con la cuenta activa.</p>') +
      (v2.some(Boolean)
        ? '<p class="pista">' + (semanas ? 'Por semanas: entradas de socios (un socio cuenta una vez por día).' : 'Socios distintos que han entrado cada día.') + '</p>' +
          grafico(t, v2, semanas ? 'entradas de socios' : 'socios distintos', semanas)
        : '<p class="empty">Todavía no hay entradas de socios en este periodo.</p>');

    // 3) Secciones más usadas por los socios
    const usos = new Map(Object.keys(SECCIONES).map(k => [k, 0]));
    DATOS.uso.forEach(u => { if (u.zona === 'socios' && dentro(u.dia) && usos.has(u.pagina)) usos.set(u.pagina, usos.get(u.pagina) + (Number(u.total) || 0)); });
    const totalSocios = [...usos.values()].reduce((a, b) => a + b, 0);
    const orden = [...usos].sort((a, b) => b[1] - a[1]); // con empate, se queda el orden de la barra inferior
    el('secciones').innerHTML = totalSocios
      ? '<p class="inf-total"><b>' + numero(totalSocios) + '</b> ' + (totalSocios === 1 ? 'visita' : 'visitas') + ' de socios en el periodo</p><ol class="inf-ranking">' +
        orden.map(([k, n]) => {
          const p = totalSocios ? n * 100 / totalSocios : 0;
          return '<li><span class="inf-r-nom">' + esc(SECCIONES[k]) + '</span><span class="inf-r-dato">' + plural(n, 'visita', 'visitas') + ' · ' + porcentaje(n, totalSocios) + '</span>' +
            '<span class="inf-r-barra" aria-hidden="true"><i style="width:' + Math.round(p * 10) / 10 + '%"></i></span></li>';
        }).join('') + '</ol>'
      : '<p class="empty">Todavía no hay visitas de socios en este periodo.</p>';
  }

  // 4) Constancia semanal: no depende del periodo elegido.
  function pintarConstancia() {
    const total = DATOS.personas.length;
    if (!total) { el('constancia').innerHTML = '<p class="empty">Todavía no hay socios con la cuenta activa.</p>'; return; }
    const faltan = DATOS.personas.filter(p => !p.ultimo || p.ultimo < SIETE).sort((a, b) => {
      const fa = a.ultimo, fb = b.ultimo;
      if (fa !== fb) return !fa ? -1 : !fb ? 1 : fa < fb ? -1 : 1; // "nunca" primero; después, del más antiguo al más reciente
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    const han = total - faltan.length;
    el('constancia').innerHTML = '<p class="inf-total"><b>' + numero(han) + ' de ' + numero(total) + '</b> socios han entrado en los últimos 7 días</p>' +
      '<p class="pista">Del ' + SIETE + ' al ' + HOY + ' (hora de Madrid).</p>' +
      (faltan.length
        ? '<h3 class="inf-sub">No han entrado en estos 7 días</h3><ul class="inf-faltan">' + faltan.map(p =>
            '<li><span class="st"><b>' + esc(p.nombre) + '</b>' + (p.codigo ? '<small>' + esc(p.codigo) + '</small>' : '') + '</span><span class="inf-ultimo">Último acceso: ' +
            esc(p.ultimo || 'nunca') + '</span></li>').join('') + '</ul>'
        : '<p class="empty">Todos los socios han entrado esta semana.</p>');
  }

  el('periodo').addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b || b.dataset.p === periodo) return;
    periodo = b.dataset.p;
    el('periodo').querySelectorAll('[data-p]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    if (DATOS) pintar();
  });

  Cueva.cargar(el('estado'), leer, d => {
    DATOS = d;
    el('estado').remove();
    el('informes').hidden = false;
    pintar();
    pintarConstancia();
  });
})();
