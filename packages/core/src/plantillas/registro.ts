// Registro de plantillas con detección automática. Dos Trie propios:
// encabezado normalizado -> plantillas que lo esperan, y prefijo de línea -> plantillas.
// Detectar cuesta O(largo de las primeras líneas), sin importar cuántas plantillas haya.
import { Trie } from '../estructuras/Trie.ts';
import { detectarSeparador, normalizarEncabezado, parsearCSV, quitarBOM } from './csv.ts';
import { obtenerLector } from './lectores.ts';
import type { Plantilla } from './tipos.ts';
import { validarPlantilla } from './validar.ts';

// Cuántas líneas iniciales se miran: cubre plantillas con varias filas de encabezado.
const LINEAS_A_REVISAR = 5;

export class RegistroPlantillas {
  #plantillas = new Map<string, Plantilla>();
  #porEncabezado = new Trie<string>(); // valor: id de plantilla
  #porPrefijo = new Trie<string>();

  // Valida; lanza Error con la lista de errores. Un id repetido reemplaza la plantilla (nueva versión).
  registrar(p: Plantilla): void {
    const r = validarPlantilla(p);
    if (!r.ok) {
      const id = typeof (p as { id?: unknown })?.id === 'string' ? ` "${(p as { id: string }).id}"` : '';
      throw new Error(`Plantilla${id} inválida:\n- ${r.errores.join('\n- ')}`);
    }
    const reemplaza = this.#plantillas.has(r.plantilla.id);
    this.#plantillas.set(r.plantilla.id, r.plantilla);
    // El Trie no borra claves: al reemplazar se reconstruye (pasa poco, al editar plantillas).
    if (reemplaza) this.#reconstruir();
    else this.#indexar(r.plantilla);
  }

  obtener(id: string): Plantilla | undefined {
    return this.#plantillas.get(id);
  }

  listar(): Plantilla[] {
    return [...this.#plantillas.values()];
  }

  // Candidatas ordenadas por confianza: fracción de encabezados encontrados; prefijo exacto = 1.
  detectar(texto: string): { plantilla: Plantilla; confianza: number }[] {
    const lineas = quitarBOM(texto).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, LINEAS_A_REVISAR);
    if (lineas.length === 0) return [];
    const confianza = new Map<string, number>();
    const subir = (id: string, valor: number) => confianza.set(id, Math.max(confianza.get(id) ?? 0, valor));

    for (const id of new Set(this.#porPrefijo.prefijosDe(lineas[0]))) subir(id, 1);

    const separador = detectarSeparador(lineas.join('\n'));
    const { filas } = parsearCSV(lineas.join('\n'), separador);
    for (const fila of filas) {
      // Cada encabezado cuenta una vez por plantilla, aunque el archivo lo repita.
      const encontrados = new Map<string, Set<string>>();
      for (const celda of fila.celdas) {
        const clave = normalizarEncabezado(celda);
        if (clave === '') continue;
        for (const id of this.#porEncabezado.buscar(clave)) {
          let s = encontrados.get(id);
          if (!s) { s = new Set(); encontrados.set(id, s); }
          s.add(clave);
        }
      }
      for (const [id, s] of encontrados) {
        const esperados = new Set(this.#plantillas.get(id)!.detectar!.encabezados!.map(normalizarEncabezado)).size;
        subir(id, s.size / esperados);
      }
    }

    // Formatos con lector propio (MT940, camt.053) se reconocen por contenido, no por encabezados.
    // Se pregunta una vez por tipo, aunque haya varias plantillas del mismo tipo.
    const porTipo = new Map<string, number>();
    for (const p of this.#plantillas.values()) {
      const lector = obtenerLector(p.tipo);
      if (!lector?.detectar) continue;
      if (!porTipo.has(p.tipo)) porTipo.set(p.tipo, Math.min(1, Math.max(0, lector.detectar(texto))));
      const c = porTipo.get(p.tipo)!;
      if (c > 0) subir(p.id, c);
    }

    const orden = [...this.#plantillas.keys()];
    return [...confianza]
      .map(([id, c]) => ({ plantilla: this.#plantillas.get(id)!, confianza: c }))
      // Empate: gana la registrada primero, para que el resultado sea reproducible.
      .sort((a, b) => b.confianza - a.confianza || orden.indexOf(a.plantilla.id) - orden.indexOf(b.plantilla.id));
  }

  #indexar(p: Plantilla): void {
    for (const e of new Set((p.detectar?.encabezados ?? []).map(normalizarEncabezado))) this.#porEncabezado.insertar(e, p.id);
    if (p.detectar?.prefijoLinea) this.#porPrefijo.insertar(p.detectar.prefijoLinea, p.id);
  }

  #reconstruir(): void {
    this.#porEncabezado = new Trie();
    this.#porPrefijo = new Trie();
    for (const p of this.#plantillas.values()) this.#indexar(p);
  }
}
