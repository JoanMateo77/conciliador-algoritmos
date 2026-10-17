// Cliente mínimo de la API (fases 12 y 13). El token se pasa en cada llamada y no se guarda aquí.
export interface RespuestaApi<T> { estado: number; datos: T }

export class ErrorApi extends Error {
  estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

export async function pedirApi<T>(base: string, ruta: string, opciones: { metodo?: 'GET' | 'POST'; cuerpo?: unknown; token?: string } = {}): Promise<RespuestaApi<T>> {
  const cabeceras: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (opciones.token) cabeceras.Authorization = `Bearer ${opciones.token}`;
  let r: Response;
  try {
    r = await fetch(`${base.replace(/\/+$/, '')}${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'No se pudo conectar con el servidor.');
  }
  const datos = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) {
    // La API responde { error: { mensaje, detalles } } en español: se muestra tal cual.
    const error = (datos as { error?: { mensaje?: string; detalles?: unknown } } | null)?.error;
    const detalles = Array.isArray(error?.detalles) && error.detalles.every((d) => typeof d === 'string') ? ` ${error.detalles.join(' ')}` : '';
    throw new ErrorApi(r.status, `${error?.mensaje ?? `El servidor respondió ${r.status}.`}${detalles}`);
  }
  return { estado: r.status, datos: datos as T };
}

// Versión de una plantilla o perfil de la empresa (GET /empresa/plantillas y .../versiones).
export interface VersionGuardada<T = unknown> { id: string; version: number; contenido: T; usuarioId: string | null; fecha: string }

export interface EstadoTrabajo {
  id: string;
  estado: 'pendiente' | 'procesando' | 'hecho' | 'fallido';
  intentos: number;
  maxIntentos: number;
  conciliacionId: string | null;
  error: { mensaje: string; detalles?: unknown } | null;
  creado: string;
  tomado: string | null;
  terminado: string | null;
}
