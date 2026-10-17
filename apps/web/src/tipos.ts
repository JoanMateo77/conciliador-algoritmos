// Tipos propios del panel (los del dominio vienen de @conciliador/core).
import type { ArchivoEntrada, Lado, Movimiento, Perfil, Plantilla, ResultadoConciliacion, ResultadoIngesta, SesionRevision } from '@conciliador/core';

export type Pestana = 'cargar' | 'perfil' | 'resultados' | 'grafo' | 'plantillas';

// Lo que el usuario cargó en una zona. Se guardan los bytes y no el texto
// porque la codificación depende de la plantilla elegida.
export interface Carga {
  nombre: string;
  bytes?: Uint8Array;
  textoFijo?: string;              // demo: ya es texto, no hay que decodificar
  plantillaElegida: string | null; // null = usar la detectada
}

export interface Lectura {
  lado: Lado;
  carga: Carga;
  candidatas: { plantilla: Plantilla; confianza: number }[];
  otroLado: Plantilla | null;      // el archivo parece del lado contrario
  plantilla: Plantilla | null;
  texto: string;
  ingesta: ResultadoIngesta;
}

export interface Trabajo {
  resultado: ResultadoConciliacion;
  sesion: SesionRevision;
  banco: Movimiento[];
  ventas: Movimiento[];
  perfil: Perfil;
  archivos: { banco: ArchivoEntrada; ventas: ArchivoEntrada };
}

export type Avisar = (mensaje: string, tipo?: 'info' | 'error') => void;
