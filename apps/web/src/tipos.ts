// Tipos propios del panel (los del dominio vienen de @conciliador/core).
import type { ArchivoEntrada, Lado, Movimiento, Perfil, Plantilla, ResultadoConciliacion, ResultadoIngesta, SesionRevision } from '@conciliador/core';

export type Pestana = 'cargar' | 'perfil' | 'resultados' | 'grafo' | 'plantillas' | 'servidor';

// Lo que el usuario cargó en una zona. Se guardan los bytes y no el texto
// porque la codificación depende de la plantilla elegida.
export interface Carga {
  nombre: string;
  bytes?: Uint8Array;
  textoFijo?: string;              // demo: ya es texto, no hay que decodificar
  plantillaElegida: string | null; // null = usar la detectada
  // Excel: textoFijo trae la hoja elegida ya convertida a CSV con ';' (lo hace @conciliador/excel).
  excel?: { hojas: string[]; hoja: string };
  // Facturas electrónicas DIAN: varios XML a la vez como lado ventas (lo lee @conciliador/dian).
  facturas?: { nombre: string; texto: string }[];
}

export interface Lectura {
  lado: Lado;
  carga: Carga;
  candidatas: { plantilla: Plantilla; confianza: number }[];
  otroLado: Plantilla | null;      // el archivo parece del lado contrario
  plantilla: Plantilla | null;
  texto: string;
  ingesta: ResultadoIngesta;
  formato: 'texto' | 'excel' | 'dian';
  // Por qué este archivo no se puede reenviar tal cual al servidor (la API solo recibe texto + plantilla).
  bloqueoServidor?: string;
}

export interface Trabajo {
  resultado: ResultadoConciliacion;
  sesion: SesionRevision;
  banco: Movimiento[];
  ventas: Movimiento[];
  perfil: Perfil;
  archivos: { banco: ArchivoEntrada; ventas: ArchivoEntrada };
  bloqueoServidor?: string;
}

// Sesión con la API multiempresa. Vive solo en memoria (nunca en localStorage):
// al recargar la página hay que volver a ingresar, a cambio de no dejar el token expuesto.
export interface SesionServidor {
  token: string;
  usuario: { id: string; nombre: string; correo: string; rol: string; empresaId: string };
  empresaNombre?: string;
}

export type Avisar = (mensaje: string, tipo?: 'info' | 'error') => void;
