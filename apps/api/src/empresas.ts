// Empresas, usuarios, y plantillas/perfiles propios con historial de versiones.
// Guardar nunca sobrescribe: cada guardado crea la versión siguiente (la base además
// prohíbe UPDATE/DELETE en las tablas de versiones).
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validarPerfil, validarPlantilla } from '@conciliador/core';
import type { Perfil, Plantilla } from '@conciliador/core';
import type { Rol } from './auth.ts';
import { enTransaccion } from './bd.ts';
import { hashContrasena } from './contrasenas.ts';
import { ErrorHttp } from './http.ts';
import { cortarPagina } from './paginacion.ts';
import type { PedidoPagina } from './paginacion.ts';
import { esPlantillaIncluida } from './conciliacion.ts';

export interface Usuario { id: string; empresaId: string; nombre: string; correo: string; rol: Rol; activo: boolean; creado: string }

const aUsuario = (f: Record<string, unknown>): Usuario => ({
  id: f.id as string, empresaId: f.empresa_id as string, nombre: f.nombre as string, correo: f.correo as string,
  rol: f.rol as Rol, activo: f.activo as boolean, creado: (f.creado as Date).toISOString(),
});

const esUnico = (error: unknown) => (error as { code?: string }).code === '23505';

export async function registrarEmpresa(pool: Pool, datos: { empresa: string; nombre: string; correo: string; contrasena: string }) {
  const hash = await hashContrasena(datos.contrasena); // fuera de la transacción: scrypt tarda
  try {
    return await enTransaccion(pool, async (cliente) => {
      const empresaId = randomUUID();
      const { rows: [empresa] } = await cliente.query(
        'INSERT INTO empresas (id, nombre) VALUES ($1, $2) RETURNING id, nombre, creada', [empresaId, datos.empresa]);
      const usuario = await insertarUsuario(cliente, empresaId, { nombre: datos.nombre, correo: datos.correo, rol: 'admin' }, hash);
      return { empresa: { id: empresa.id as string, nombre: empresa.nombre as string, creada: (empresa.creada as Date).toISOString() }, usuario };
    });
  } catch (error) {
    if (esUnico(error)) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo.');
    throw error;
  }
}

export async function crearUsuario(pool: Pool, empresaId: string, datos: { nombre: string; correo: string; contrasena: string; rol: Rol }) {
  const hash = await hashContrasena(datos.contrasena);
  try {
    return await enTransaccion(pool, (cliente) => insertarUsuario(cliente, empresaId, datos, hash));
  } catch (error) {
    if (esUnico(error)) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo.');
    throw error;
  }
}

async function insertarUsuario(cliente: PoolClient, empresaId: string, datos: { nombre: string; correo: string; rol: Rol }, hash: string) {
  const { rows } = await cliente.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, correo, hash_contrasena, rol) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, empresa_id, nombre, correo, rol, activo, creado`,
    [randomUUID(), empresaId, datos.nombre, datos.correo, hash, datos.rol]);
  return aUsuario(rows[0]);
}

export async function buscarParaIngreso(pool: Pool, correo: string) {
  const { rows } = await pool.query(
    `SELECT id, empresa_id, nombre, correo, rol, activo, creado, hash_contrasena FROM usuarios WHERE lower(correo) = lower($1)`, [correo]);
  if (rows.length === 0) return null;
  return { usuario: aUsuario(rows[0]), hash: rows[0].hash_contrasena as string };
}

export async function listarUsuarios(pool: Pool, empresaId: string, pedido: PedidoPagina) {
  const parametros: unknown[] = [empresaId, pedido.limite + 1];
  let filtro = '';
  if (pedido.cursor) { parametros.push(pedido.cursor[0], pedido.cursor[1]); filtro = 'AND (creado, id) > ($3::timestamptz, $4::uuid)'; }
  const { rows } = await consultarConCursor(pool,
    `SELECT id, empresa_id, nombre, correo, rol, activo, creado, creado::text AS creado_texto FROM usuarios
     WHERE empresa_id = $1 ${filtro} ORDER BY creado, id LIMIT $2`, parametros);
  return cortarPagina(rows, pedido.limite, (f) => [f.creado_texto as string, f.id as string], aUsuario);
}

// ---------- Plantillas y perfiles con versiones ----------

type Tipo = 'plantillas' | 'perfiles';
const TABLAS = {
  plantillas: { cabecera: 'plantillas_empresa', versiones: 'plantillas_versiones', fk: 'plantilla_id', fecha: 'creada' },
  perfiles: { cabecera: 'perfiles_empresa', versiones: 'perfiles_versiones', fk: 'perfil_id', fecha: 'creado' },
} as const;

export async function guardarPlantilla(pool: Pool, empresaId: string, usuarioId: string | null, entrada: unknown) {
  const revision = validarPlantilla(entrada);
  if (!revision.ok) throw new ErrorHttp(400, 'La plantilla no es válida.', revision.errores);
  const plantilla = revision.plantilla;
  if (esPlantillaIncluida(plantilla.id)) {
    throw new ErrorHttp(409, `El id "${plantilla.id}" es de una plantilla incluida; use otro id para la plantilla de su empresa.`);
  }
  return enTransaccion(pool, async (cliente) => {
    // ON CONFLICT bloquea la fila de cabecera: dos guardados simultáneos sacan versiones distintas.
    // El WHERE impide cambiar el lado de una plantilla existente (sería otra plantilla).
    const { rows } = await cliente.query(
      `INSERT INTO plantillas_empresa (empresa_id, id, lado, version_actual) VALUES ($1, $2, $3, 1)
       ON CONFLICT (empresa_id, id) DO UPDATE SET version_actual = plantillas_empresa.version_actual + 1, actualizada = now()
         WHERE plantillas_empresa.lado = EXCLUDED.lado
       RETURNING version_actual`, [empresaId, plantilla.id, plantilla.lado]);
    if (rows.length === 0) throw new ErrorHttp(409, `La plantilla "${plantilla.id}" ya existe con el otro lado; no se puede cambiar el lado.`);
    const version = rows[0].version_actual as number;
    // La versión la decide el servidor: la del cuerpo se ignora para que el historial sea consecutivo.
    const contenido: Plantilla = { ...plantilla, version };
    return insertarVersion(cliente, 'plantillas', empresaId, plantilla.id, version, contenido, usuarioId);
  });
}

export async function guardarPerfil(pool: Pool, empresaId: string, usuarioId: string | null, entrada: unknown) {
  const revision = validarPerfil(entrada);
  if (!revision.ok) throw new ErrorHttp(400, 'El perfil no es válido.', revision.errores.map((e) => `perfil: ${e}`));
  const perfil = revision.perfil;
  if (typeof perfil.id !== 'string' || perfil.id.length < 1 || perfil.id.length > 100) throw new ErrorHttp(400, 'El perfil necesita un "id" de 1 a 100 caracteres.');
  return enTransaccion(pool, async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO perfiles_empresa (empresa_id, id, version_actual) VALUES ($1, $2, 1)
       ON CONFLICT (empresa_id, id) DO UPDATE SET version_actual = perfiles_empresa.version_actual + 1, actualizado = now()
       RETURNING version_actual`, [empresaId, perfil.id]);
    const version = rows[0].version_actual as number;
    return insertarVersion(cliente, 'perfiles', empresaId, perfil.id, version, perfil, usuarioId);
  });
}

async function insertarVersion(cliente: PoolClient, tipo: Tipo, empresaId: string, id: string, version: number, contenido: unknown, usuarioId: string | null) {
  const t = TABLAS[tipo];
  const { rows } = await cliente.query(
    `INSERT INTO ${t.versiones} (empresa_id, ${t.fk}, version, contenido, usuario_id) VALUES ($1, $2, $3, $4, $5)
     RETURNING ${t.fecha} AS fecha`, [empresaId, id, version, JSON.stringify(contenido), usuarioId]);
  return { id, version, contenido, usuarioId, fecha: (rows[0].fecha as Date).toISOString() };
}

// Versión vigente de cada plantilla/perfil de la empresa, por id ascendente.
export async function listarVigentes(pool: Pool, tipo: Tipo, empresaId: string, pedido: PedidoPagina) {
  const t = TABLAS[tipo];
  const parametros: unknown[] = [empresaId, pedido.limite + 1];
  let filtro = '';
  if (pedido.cursor) { parametros.push(pedido.cursor[0]); filtro = 'AND c.id > $3'; }
  const { rows } = await pool.query(
    `SELECT c.id, c.version_actual, v.contenido, v.usuario_id, v.${t.fecha} AS fecha
     FROM ${t.cabecera} c JOIN ${t.versiones} v ON v.empresa_id = c.empresa_id AND v.${t.fk} = c.id AND v.version = c.version_actual
     WHERE c.empresa_id = $1 ${filtro} ORDER BY c.id LIMIT $2`, parametros);
  return cortarPagina(rows, pedido.limite, (f) => [f.id as string], aVersion);
}

// Historial de una plantilla/perfil, de la versión más nueva a la más vieja. null si no existe en la empresa.
export async function listarVersiones(pool: Pool, tipo: Tipo, empresaId: string, id: string, pedido: PedidoPagina) {
  const t = TABLAS[tipo];
  const existe = await pool.query(`SELECT 1 FROM ${t.cabecera} WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  if (existe.rowCount === 0) return null;
  const parametros: unknown[] = [empresaId, id, pedido.limite + 1];
  let filtro = '';
  if (pedido.cursor) {
    const desde = Number(pedido.cursor[0]);
    if (!Number.isInteger(desde)) throw new ErrorHttp(400, 'El parámetro "cursor" no es válido.');
    parametros.push(desde);
    filtro = 'AND version < $4';
  }
  const { rows } = await pool.query(
    `SELECT ${t.fk} AS id, version AS version_actual, contenido, usuario_id, ${t.fecha} AS fecha FROM ${t.versiones}
     WHERE empresa_id = $1 AND ${t.fk} = $2 ${filtro} ORDER BY version DESC LIMIT $3`, parametros);
  return cortarPagina(rows, pedido.limite, (f) => [f.version_actual as number], aVersion);
}

const aVersion = (f: Record<string, unknown>) => ({
  id: f.id as string, version: f.version_actual as number, contenido: f.contenido,
  usuarioId: (f.usuario_id as string | null) ?? null, fecha: (f.fecha as Date).toISOString(),
});

// Perfil guardado de la empresa (versión vigente o la pedida).
export async function obtenerPerfil(pool: Pool, empresaId: string, id: string, version?: number): Promise<{ perfil: Perfil; version: number } | null> {
  const { rows } = version === undefined
    ? await pool.query(
      `SELECT v.contenido, v.version FROM perfiles_empresa c JOIN perfiles_versiones v
         ON v.empresa_id = c.empresa_id AND v.perfil_id = c.id AND v.version = c.version_actual
       WHERE c.empresa_id = $1 AND c.id = $2`, [empresaId, id])
    : await pool.query('SELECT contenido, version FROM perfiles_versiones WHERE empresa_id = $1 AND perfil_id = $2 AND version = $3',
      [empresaId, id, version]);
  if (rows.length === 0) return null;
  return { perfil: rows[0].contenido as Perfil, version: rows[0].version as number };
}

async function consultarConCursor(pool: Pool, sql: string, parametros: unknown[]) {
  try {
    return await pool.query(sql, parametros);
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('22')) throw new ErrorHttp(400, 'El parámetro "cursor" no es válido.');
    throw error;
  }
}
