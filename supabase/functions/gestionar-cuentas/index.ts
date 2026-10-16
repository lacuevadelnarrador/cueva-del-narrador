// EDGE FUNCTION gestionar-cuentas: crear y borrar cuentas de socios desde Administración → Socios (admin-socios.js).
// - Se despliega con "Verify JWT" activado. Solo la pueden usar administradores activos (se comprueba en perfiles).
// - SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las pone Supabase en el entorno de la función.
//   La clave de servicio NUNCA sale de aquí: ni al cliente, ni al repositorio, ni a los registros.
// - Dos clientes:
//   · servicio (clave de servicio): solo para lo que la necesita de verdad: Auth (crear y borrar usuarios), leer el
//     perfil de quien llama y del destino, desactivar la cuenta y borrar sus archivos al borrarla, y registro_cuentas.
//   · comoAdmin (el JWT de quien llama): perfil, ficha y cuotas al crear, para que se apliquen las mismas reglas que
//     hoy (RLS, protecciones de administradores y generar_cuotas, que comprueban auth.uid()).
// - Los registros (console.error) llevan solo la acción, el paso y el código del error: nunca correos, nombres ni ids.
// - Al cliente solo le llegan mensajes genéricos en español.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

const ORIGENES = new Set(['https://lacuevadelnarrador.es', 'http://localhost:8080']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_CORREO = 254, MAX_COMPLETO = 120, MAX_PILA = 60, MAX_CUERPO = 4096;
const CUBO_FOTOS = 'fotos-socios', CUBO_ENTREGAS = 'entregas';

const URL_SB = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const MSG = {
  interno: 'No se ha podido completar la operación. Inténtalo de nuevo dentro de un momento.',
  sesion: 'Tu sesión ha caducado. Vuelve a entrar en la app.',
  prohibido: 'Solo los administradores activos pueden gestionar cuentas.',
  peticion: 'La petición no es válida. Recarga la página y vuelve a intentarlo.'
};

type Cuerpo = Record<string, unknown>;
type Error_ = { code?: string; status?: number; name?: string } | null | undefined;

// ---------- Respuestas y CORS ----------
function cabeceras(origen: string | null): Headers {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origen && ORIGENES.has(origen)) {
    h.set('Access-Control-Allow-Origin', origen);
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}
const responder = (origen: string | null, estado: number, cuerpo: Cuerpo) => new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras(origen) });
const fallo = (origen: string | null, estado: number, codigo: string, mensaje: string) => responder(origen, estado, { ok: false, codigo, mensaje });

// Registro sin datos personales: acción, paso y código del error.
function registrar(accion: string, paso: string, e?: Error_ | unknown) {
  const x = (e ?? {}) as { code?: string; status?: number; statusCode?: string; name?: string };
  const codigo = x.code || x.status || x.statusCode || x.name || '';
  console.error('gestionar-cuentas: ' + accion + ' / ' + paso + (codigo ? ' (código: ' + codigo + ')' : ''));
}

// ---------- Utilidades ----------
const texto = (v: unknown) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
const largo = (t: string) => Array.from(t).length;
function hoyMadrid(): string {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}
// Código de socio: el A-NNN más alto + 1, con 3 cifras como mínimo (misma regla que admin-socios.js).
function codigoDe(codigos: unknown[]): string {
  let max = 0;
  codigos.forEach(c => { const m = /^A-(\d+)$/.exec(String(c ?? '')); if (m) max = Math.max(max, +m[1]); });
  return 'A-' + String(max + 1).padStart(3, '0');
}
const esCodigoDuplicado = (e: { code?: string; message?: string; details?: string } | null) =>
  !!e && e.code === '23505' && /codigo/.test(String(e.message ?? '') + ' ' + String(e.details ?? ''));

// ---------- Crear ----------
async function crear(origen: string | null, c: Cuerpo, servicio: SupabaseClient, comoAdmin: SupabaseClient, adminId: string) {
  const correo = typeof c.correo === 'string' ? c.correo.trim().toLowerCase() : '';
  const completo = texto(c.nombre_completo), pila = texto(c.nombre_pila);
  const conCuotas = c.cuotas === true;
  if (!correo || correo.length > MAX_CORREO || !CORREO.test(correo)) return fallo(origen, 400, 'datos', 'El correo no tiene un formato válido.');
  if (!completo || largo(completo) > MAX_COMPLETO) return fallo(origen, 400, 'datos', 'El nombre y apellidos debe tener entre 1 y ' + MAX_COMPLETO + ' caracteres.');
  if (!pila || largo(pila) > MAX_PILA) return fallo(origen, 400, 'datos', 'El nombre de pila debe tener entre 1 y ' + MAX_PILA + ' caracteres.');
  if (c.cuotas !== undefined && typeof c.cuotas !== 'boolean') return fallo(origen, 400, 'datos', MSG.peticion);
  let cursoId: number | null = null;
  if (conCuotas) {
    if (!Number.isSafeInteger(c.curso_id) || (c.curso_id as number) <= 0) return fallo(origen, 400, 'datos', MSG.peticion);
    const r = await comoAdmin.from('cursos').select('id').eq('id', c.curso_id as number).maybeSingle();
    if (r.error) { registrar('crear', 'curso', r.error); return fallo(origen, 500, 'interno', MSG.interno); }
    if (!r.data) return fallo(origen, 400, 'curso', 'Ese curso ya no existe. Recarga la página y vuelve a intentarlo.');
    cursoId = c.curso_id as number;
  }

  // 1. Usuario de Auth (el disparador al_crear_usuario crea su perfil: rol miembro, desactivado)
  const u = await servicio.auth.admin.createUser({ email: correo, email_confirm: true, user_metadata: { nombre: pila } });
  if (u.error || !u.data || !u.data.user) {
    const e = u.error as Error_;
    if (e && (e.code === 'email_exists' || e.code === 'user_already_exists' || e.status === 422)) return fallo(origen, 409, 'correo_existe', 'Ya existe una cuenta con ese correo.');
    registrar('crear', 'usuario', e);
    return fallo(origen, 500, 'interno', MSG.interno);
  }
  const id = u.data.user.id;

  // Si el perfil o la ficha fallan, se deshace borrando el usuario recién creado.
  const deshacer = async (paso: string, e: unknown) => {
    registrar('crear', paso, e);
    const d = await servicio.auth.admin.deleteUser(id);
    if (d.error) {
      registrar('crear', 'deshacer', d.error);
      return fallo(origen, 500, 'a_medias', 'La cuenta se ha creado, pero sin ficha: aparecerá en «Fichas pendientes» y desde ahí puedes crearla.');
    }
    return fallo(origen, 500, 'ficha', 'No se ha podido crear la ficha, así que no se ha creado la cuenta. Inténtalo de nuevo dentro de un momento.');
  };

  // 2. Perfil: rol miembro y activo (con la sesión del administrador)
  const p = await comoAdmin.from('perfiles').update({ rol: 'miembro', activo: true }).eq('id', id).select('id');
  if (p.error || !Array.isArray(p.data) || p.data.length !== 1) return await deshacer('perfil', p.error ?? { code: 'sin_filas' });

  // 3. Ficha (si otro administrador coge el mismo código a la vez, se recalcula y se reintenta una vez)
  let codigo = '';
  for (let intento = 0; intento < 2 && !codigo; intento++) {
    const l = await comoAdmin.from('socios').select('codigo');
    if (l.error) return await deshacer('codigo', l.error);
    const nuevo = codigoDe((l.data ?? []).map(x => (x as { codigo: unknown }).codigo));
    const f = await comoAdmin.from('socios').insert({
      id, codigo: nuevo, nombre_completo: completo, nombre_pila: pila, fecha_inscripcion: hoyMadrid(),
      fundador: false, libro_publicado: false, rgpd_imagen: false, rgpd_publicaciones: false, generos_favoritos: [], motivacion: []
    }).select('codigo');
    if (f.error && intento === 0 && esCodigoDuplicado(f.error)) continue;
    if (f.error || !Array.isArray(f.data) || f.data.length !== 1) return await deshacer('ficha', f.error ?? { code: 'sin_filas' });
    codigo = String((f.data[0] as { codigo: unknown }).codigo);
  }
  if (!codigo) return await deshacer('ficha', { code: 'codigo' });

  // 4. Cuotas del curso (si fallan, la cuenta y la ficha se quedan: se pueden crear desde la ficha)
  let cuotas: number | null = null, cuotasError = false;
  if (cursoId !== null) {
    const g = await comoAdmin.rpc('generar_cuotas', { p_curso_id: cursoId, p_socio_id: id });
    const n = Number(g.data);
    if (g.error || !Number.isInteger(n) || n < 0) { registrar('crear', 'cuotas', g.error); cuotasError = true; } else cuotas = n;
  }

  // 5. Registro
  const reg = await servicio.from('registro_cuentas').insert({ accion: 'crear', admin_id: adminId });
  if (reg.error) registrar('crear', 'registro', reg.error);

  return responder(origen, 200, { ok: true, id, codigo, cuotas, cuotas_error: cuotasError, registro: !reg.error });
}

// ---------- Borrar ----------
// Rutas de un socio en fotos-socios (su carpeta <id>/, por páginas).
async function rutasFotos(servicio: SupabaseClient, id: string): Promise<string[]> {
  const rutas: string[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const l = await servicio.storage.from(CUBO_FOTOS).list(id, { limit: 100, offset: pagina * 100 });
    if (l.error) throw l.error;
    const filas = (l.data ?? []).filter(o => o && o.name && o.id !== null);
    filas.forEach(o => rutas.push(id + '/' + o.name));
    if ((l.data ?? []).length < 100) return rutas;
  }
  throw { code: 'demasiadas_fotos' };
}
async function borrarRutas(servicio: SupabaseClient, cubo: string, rutas: string[]) {
  for (let i = 0; i < rutas.length; i += 100) {
    const r = await servicio.storage.from(cubo).remove(rutas.slice(i, i + 100));
    if (r.error) throw r.error;
  }
}

async function borrar(origen: string | null, c: Cuerpo, servicio: SupabaseClient, adminId: string) {
  const id = typeof c.socio_id === 'string' ? c.socio_id.trim().toLowerCase() : '';
  if (!UUID.test(id)) return fallo(origen, 400, 'datos', MSG.peticion);
  if (id === adminId.toLowerCase()) return fallo(origen, 409, 'uno_mismo', 'No puedes borrar tu propia cuenta.');
  const yaNoExiste = () => responder(origen, 200, { ok: true, ya_no_existe: true, mensaje: 'Esta cuenta ya no existe.' });

  const p = await servicio.from('perfiles').select('id,rol').eq('id', id).maybeSingle();
  if (p.error) { registrar('borrar', 'perfil', p.error); return fallo(origen, 500, 'interno', MSG.interno); }
  if (!p.data) return yaNoExiste(); // doble petición o ya borrada: no es un fallo
  if (p.data.rol === 'admin') return fallo(origen, 409, 'es_admin', 'Quítale antes el rol de administrador.');

  // (a) Desactivar la cuenta: desde aquí, pase lo que pase, ya no puede entrar.
  const d = await servicio.from('perfiles').update({ activo: false }).eq('id', id).neq('rol', 'admin').select('id');
  if (d.error) { registrar('borrar', 'desactivar', d.error); return fallo(origen, 500, 'interno', 'No se ha borrado nada. ' + MSG.interno); }
  if (!Array.isArray(d.data) || !d.data.length) {
    const otra = await servicio.from('perfiles').select('rol').eq('id', id).maybeSingle();
    if (!otra.error && !otra.data) return yaNoExiste();
    if (!otra.error && otra.data && otra.data.rol === 'admin') return fallo(origen, 409, 'es_admin', 'Quítale antes el rol de administrador.');
    registrar('borrar', 'desactivar', otra.error ?? { code: 'sin_filas' });
    return fallo(origen, 500, 'interno', 'No se ha borrado nada. ' + MSG.interno);
  }

  // (b) Archivos: foto(s) y textos entregados. Si falla, no se toca la cuenta (queda desactivada).
  try {
    const fotos = await rutasFotos(servicio, id);
    const e = await servicio.from('entregas').select('ruta').eq('socio_id', id);
    if (e.error) throw e.error;
    const entregas = (e.data ?? []).map(x => (x as { ruta: unknown }).ruta).filter((r): r is string => typeof r === 'string' && r !== '');
    await borrarRutas(servicio, CUBO_FOTOS, fotos);
    await borrarRutas(servicio, CUBO_ENTREGAS, entregas);
  } catch (e) {
    registrar('borrar', 'archivos', e);
    return fallo(origen, 500, 'archivos', 'No se han podido borrar sus archivos, así que la cuenta no se ha borrado: ha quedado desactivada. Vuelve a intentarlo dentro de un momento.');
  }

  // (c) Usuario de Auth: la cascada borra perfil, ficha, cuotas, asistencia, entregas, avisos y suscripciones.
  const b = await servicio.auth.admin.deleteUser(id);
  if (b.error) {
    const e = b.error as Error_;
    if (e && (e.status === 404 || e.code === 'user_not_found')) return yaNoExiste();
    registrar('borrar', 'usuario', e);
    return fallo(origen, 500, 'usuario', 'Se han borrado sus archivos, pero la cuenta no: ha quedado desactivada. Vuelve a intentarlo dentro de un momento.');
  }

  // (d) Registro
  const reg = await servicio.from('registro_cuentas').insert({ accion: 'borrar', admin_id: adminId });
  if (reg.error) registrar('borrar', 'registro', reg.error);

  return responder(origen, 200, { ok: true, registro: !reg.error });
}

// ---------- Entrada ----------
Deno.serve(async req => {
  const origen = req.headers.get('Origin');
  if (origen && !ORIGENES.has(origen)) return fallo(null, 403, 'origen', MSG.prohibido);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabeceras(origen) });
  if (req.method !== 'POST') return fallo(origen, 405, 'metodo', MSG.peticion);
  if (!URL_SB || !ANON || !SERVICIO) { registrar('-', 'configuracion'); return fallo(origen, 500, 'interno', MSG.interno); }

  // Cuerpo: JSON pequeño con la acción
  let cuerpo: Cuerpo;
  try {
    const t = await req.text();
    if (t.length > MAX_CUERPO) return fallo(origen, 413, 'peticion', MSG.peticion);
    const j = JSON.parse(t);
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error();
    cuerpo = j as Cuerpo;
  } catch {
    return fallo(origen, 400, 'peticion', MSG.peticion);
  }
  const accion = cuerpo.accion;
  if (accion !== 'crear' && accion !== 'borrar') return fallo(origen, 400, 'peticion', MSG.peticion);

  // Quién llama: su JWT y su perfil (administrador activo)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fallo(origen, 401, 'sesion', MSG.sesion);
  const opciones = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const servicio = createClient(URL_SB, SERVICIO, opciones);
  try {
    const u = await servicio.auth.getUser(token);
    if (u.error || !u.data || !u.data.user) return fallo(origen, 401, 'sesion', MSG.sesion);
    const adminId = u.data.user.id;
    const yo = await servicio.from('perfiles').select('rol,activo').eq('id', adminId).maybeSingle();
    if (yo.error) { registrar(accion, 'quien', yo.error); return fallo(origen, 500, 'interno', MSG.interno); }
    if (!yo.data || yo.data.rol !== 'admin' || yo.data.activo !== true) return fallo(origen, 403, 'prohibido', MSG.prohibido);

    if (accion === 'crear') {
      const comoAdmin = createClient(URL_SB, ANON, Object.assign({ global: { headers: { Authorization: 'Bearer ' + token } } }, opciones));
      return await crear(origen, cuerpo, servicio, comoAdmin, adminId);
    }
    return await borrar(origen, cuerpo, servicio, adminId);
  } catch (e) {
    registrar(accion, 'inesperado', e);
    return fallo(origen, 500, 'interno', MSG.interno);
  }
});
