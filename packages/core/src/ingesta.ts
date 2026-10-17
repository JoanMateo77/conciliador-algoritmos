// Ingesta: recibe varios archivos, decide la plantilla de cada uno y los lee.
// Una Cola propia los atiende en orden de llegada; un archivo que falla no frena a los demás.
import { Cola } from './estructuras/Cola.ts';
import type { Movimiento } from './modelo.ts';
import { leerArchivo } from './plantillas/leer.ts';
import type { RegistroPlantillas } from './plantillas/registro.ts';
import type { Plantilla } from './plantillas/tipos.ts';

export interface ArchivoEntrada {
  nombre: string;
  texto: string;
  plantillaId?: string;
}

export interface ResultadoIngesta {
  nombre: string;
  plantillaId: string | null;
  movimientos: Movimiento[];
  errores: { linea: number; mensaje: string }[]; // linea 0 = el archivo completo
}

// Por debajo de la mitad de los encabezados esperados no se adivina: mejor pedir la plantilla.
export const CONFIANZA_MINIMA = 0.5;

export function procesarArchivos(archivos: ArchivoEntrada[], registro: RegistroPlantillas): ResultadoIngesta[] {
  const pendientes = new Cola<ArchivoEntrada>();
  for (const a of archivos) pendientes.encolar(a);

  const resultados: ResultadoIngesta[] = [];
  while (!pendientes.estaVacia()) {
    const archivo = pendientes.desencolar()!;
    let plantilla: Plantilla | undefined;
    let mensaje = '';
    if (archivo.plantillaId !== undefined) {
      plantilla = registro.obtener(archivo.plantillaId);
      if (!plantilla) mensaje = `No existe la plantilla "${archivo.plantillaId}"`;
    } else {
      const mejor = registro.detectar(archivo.texto)[0];
      if (mejor && mejor.confianza >= CONFIANZA_MINIMA) plantilla = mejor.plantilla;
      else mensaje = 'No se pudo detectar el formato del archivo: elija la plantilla a mano';
    }

    if (!plantilla) {
      resultados.push({ nombre: archivo.nombre, plantillaId: null, movimientos: [], errores: [{ linea: 0, mensaje }] });
      continue;
    }
    try {
      const { movimientos, errores } = leerArchivo(archivo.texto, plantilla);
      resultados.push({ nombre: archivo.nombre, plantillaId: plantilla.id, movimientos, errores });
    } catch (e) {
      // Un fallo inesperado del lector se reporta en ese archivo y la cola sigue.
      const detalle = e instanceof Error ? e.message : String(e);
      resultados.push({ nombre: archivo.nombre, plantillaId: plantilla.id, movimientos: [], errores: [{ linea: 0, mensaje: `Error al leer: ${detalle}` }] });
    }
  }
  return resultados;
}
