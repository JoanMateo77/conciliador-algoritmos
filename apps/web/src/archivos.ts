// Utilidades del navegador para archivos: decodificar bytes, partir CSV para
// la vista previa del asistente y descargar JSON.
import { detectarSeparador, parsearCSV } from '@conciliador/core';

export type Codificacion = 'utf-8' | 'latin1';

// Los bancos colombianos suelen exportar en Windows-1252 ("latin1" en las plantillas).
// Si el texto no es UTF-8 válido se cae a latin1 en vez de mostrar caracteres rotos.
export function decodificar(bytes: Uint8Array, codificacion: Codificacion = 'utf-8'): string {
  if (codificacion === 'latin1') return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export async function leerBytes(archivo: File): Promise<Uint8Array> {
  return new Uint8Array(await archivo.arrayBuffer());
}

// La vista previa usa el mismo parser que leerArchivo: así el asistente parte
// el archivo igual que la lectura real (comillas, saltos dentro de comillas, BOM).
export { detectarSeparador };

export function partirCSV(texto: string, separador: string, maxFilas = 50): string[][] {
  return parsearCSV(texto, separador).filas.slice(0, maxFilas).map((f) => f.celdas.map((c) => c.trim()));
}

export function descargarJSON(nombreArchivo: string, datos: unknown): void {
  const blob = new Blob([JSON.stringify(datos, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Se libera después para que el navegador alcance a iniciar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function aSlug(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export function porcentaje(fraccion: number, decimales = 0): string {
  return `${(fraccion * 100).toFixed(decimales).replace('.', ',')} %`;
}
