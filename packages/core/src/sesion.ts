// Revisión humana del resultado: confirmar, rechazar y emparejar a mano, con deshacer/rehacer.
// Nada se borra: la bitácora solo crece, y deshacer es un evento más.
import type { Movimiento } from './modelo.ts';
import type { Clasificado, Coincidencia, ResultadoConciliacion } from './cruce/conciliar.ts';
import { formatearCOP } from './modelo.ts';
import { Pila } from './estructuras/Pila.ts';

// 'deshacer' y 'rehacer' no están en el contrato original: hacen falta para que
// la bitácora registre los deshacer sin borrar nada (ver CONTRATOS.md §6).
export type Evento =
  | { tipo: 'confirmar'; coincidenciaId: string }
  | { tipo: 'rechazar'; coincidenciaId: string }
  | { tipo: 'manual'; coincidencia: Coincidencia }
  | { tipo: 'deshacer'; evento: Evento }
  | { tipo: 'rehacer'; evento: Evento };

type EstadoRevision = 'automatica' | 'sugerida' | 'confirmada' | 'rechazada';
type Accion = Extract<Evento, { tipo: 'confirmar' | 'rechazar' | 'manual' }>;

// Lo que va en las pilas: la acción y el estado que tenía antes, para poder revertirla.
type Registro = Accion & { anterior?: EstadoRevision };

export class SesionRevision {
  #coincidencias = new Map<string, Coincidencia>(); // orden de inserción = orden de creación
  #estados = new Map<string, EstadoRevision>();
  #ocupadoBanco = new Map<string, string>();  // id movimiento -> id coincidencia activa
  #ocupadoVentas = new Map<string, string>();
  #ordenBanco: string[];   // orden en que se listan los movimientos sin cruzar
  #ordenVentas: string[];
  #deshacer = new Pila<Registro>();
  #rehacer = new Pila<Registro>();
  #bitacora: Evento[] = [];
  #siguienteId: number;
  #clasificados: Clasificado[];
  #motivos: Record<string, string>;
  #sinCruzarInicial: { banco: Set<string>; ventas: Set<string> };

  constructor(resultado: ResultadoConciliacion) {
    let mayor = 0;
    for (const c of resultado.coincidencias) {
      const copia = { ...c, bancoIds: c.bancoIds.slice(), ventasIds: c.ventasIds.slice() };
      this.#coincidencias.set(c.id, copia);
      this.#estados.set(c.id, c.estado);
      this.#ocupar(copia);
      const n = /^c(\d+)$/.exec(c.id);
      if (n) mayor = Math.max(mayor, Number(n[1]));
    }
    this.#siguienteId = mayor + 1;
    // Primero lo que ya estaba sin cruzar; los que libere un rechazo van después, en orden de coincidencia.
    this.#ordenBanco = [...resultado.sinCruzarBanco, ...resultado.coincidencias.flatMap((c) => c.bancoIds)];
    this.#ordenVentas = [...resultado.sinCruzarVentas, ...resultado.coincidencias.flatMap((c) => c.ventasIds)];
    // Resultados guardados antes de la fase 10 no traen clasificados ni motivos.
    this.#clasificados = (resultado.clasificados ?? []).map((c) => ({ ...c }));
    this.#motivos = { ...(resultado.motivos ?? {}) };
    this.#sinCruzarInicial = { banco: new Set(resultado.sinCruzarBanco), ventas: new Set(resultado.sinCruzarVentas) };
  }

  // Movimientos que una regla sacó del cruce. Si luego se emparejan a mano, dejan de listarse.
  clasificados(): Clasificado[] {
    return this.#clasificados
      .filter((c) => !(c.lado === 'banco' ? this.#ocupadoBanco : this.#ocupadoVentas).has(c.id))
      .map((c) => ({ ...c }));
  }

  // Por qué un movimiento libre no está cruzado; null si está en una coincidencia activa.
  // Si quedó libre por un rechazo, lo dice; si no, usa el motivo que calculó conciliar.
  motivo(id: string, lado: 'banco' | 'ventas'): string | null {
    const ocupados = lado === 'banco' ? this.#ocupadoBanco : this.#ocupadoVentas;
    if (ocupados.has(id)) return null;
    const clasificado = this.#clasificados.find((c) => c.lado === lado && c.id === id);
    if (clasificado) return `Clasificado como ${clasificado.categoria} por la regla ${clasificado.reglaId}.`;
    if (!this.#sinCruzarInicial[lado].has(id)) {
      // La última coincidencia rechazada que lo contenía es la que lo liberó.
      let liberadoPor: string | null = null;
      for (const c of this.#coincidencias.values()) {
        const ids = lado === 'banco' ? c.bancoIds : c.ventasIds;
        if (ids.includes(id) && this.#estados.get(c.id) === 'rechazada') liberadoPor = c.id;
      }
      return liberadoPor ? `Quedó libre al rechazar ${liberadoPor}.` : null;
    }
    return this.#motivos[`${lado}:${id}`] ?? this.#motivos[id] ?? null;
  }

  confirmar(id: string): void {
    const estado = this.estadoDe(id);
    if (estado === 'confirmada') return; // idempotente: un doble clic no ensucia la bitácora
    if (estado === 'rechazada') throw new Error(`La coincidencia ${id} fue rechazada; deshaga el rechazo primero`);
    this.#ejecutar({ tipo: 'confirmar', coincidenciaId: id, anterior: estado });
  }

  // Rechazar libera sus movimientos para que se puedan emparejar de otra forma.
  rechazar(id: string): void {
    const estado = this.estadoDe(id);
    if (estado === 'rechazada') return;
    this.#ejecutar({ tipo: 'rechazar', coincidenciaId: id, anterior: estado });
  }

  emparejarManual(bancoIds: string[], ventasIds: string[], banco: Movimiento[], ventas: Movimiento[]): Coincidencia {
    if (bancoIds.length === 0 || ventasIds.length === 0) throw new Error('Un emparejamiento manual necesita al menos un movimiento de cada lado');
    const buscar = (ids: string[], lista: Movimiento[], ocupados: Map<string, string>, lado: string) => {
      if (new Set(ids).size !== ids.length) throw new Error(`Hay ids repetidos en ${lado}`);
      return ids.map((id) => {
        const m = lista.find((x) => x.id === id);
        if (!m) throw new Error(`No existe el movimiento de ${lado} "${id}"`);
        if (ocupados.has(id)) throw new Error(`El movimiento de ${lado} "${id}" ya está en la coincidencia ${ocupados.get(id)}`);
        return m;
      });
    };
    const movBanco = buscar(bancoIds, banco, this.#ocupadoBanco, 'banco');
    const movVentas = buscar(ventasIds, ventas, this.#ocupadoVentas, 'ventas');
    const sumaBanco = movBanco.reduce((s, m) => s + m.montoCentavos, 0);
    const sumaVentas = movVentas.reduce((s, m) => s + m.montoCentavos, 0);
    const diferencia = sumaBanco - sumaVentas;
    const coincidencia: Coincidencia = {
      id: `c${this.#siguienteId++}`,
      tipo: 'manual',
      bancoIds: bancoIds.slice(),
      ventasIds: ventasIds.slice(),
      puntaje: 1,
      diferenciaCentavos: diferencia,
      explicacion: `Emparejado a mano: ${movBanco.length} abono(s) por ${formatearCOP(sumaBanco)} con ${movVentas.length} venta(s) por ${formatearCOP(sumaVentas)}`
        + (diferencia === 0 ? ', sin diferencia.' : `, diferencia ${formatearCOP(diferencia)}.`),
      // El tipo no tiene estado "manual"; la decisión humana se ve en estadoRevision = confirmada.
      estado: 'sugerida',
    };
    this.#ejecutar({ tipo: 'manual', coincidencia });
    return coincidencia;
  }

  deshacer(): boolean {
    const r = this.#deshacer.desapilar();
    if (!r) return false;
    this.#revertir(r);
    this.#rehacer.apilar(r);
    this.#bitacora.push({ tipo: 'deshacer', evento: limpiar(r) });
    return true;
  }

  rehacer(): boolean {
    const r = this.#rehacer.desapilar();
    if (!r) return false;
    this.#aplicar(r);
    this.#deshacer.apilar(r);
    this.#bitacora.push({ tipo: 'rehacer', evento: limpiar(r) });
    return true;
  }

  puedeDeshacer(): boolean {
    return !this.#deshacer.estaVacia();
  }

  puedeRehacer(): boolean {
    return !this.#rehacer.estaVacia();
  }

  estadoDe(id: string): EstadoRevision {
    const estado = this.#estados.get(id);
    if (!estado) throw new Error(`No existe la coincidencia ${id}`);
    return estado;
  }

  // Incluye las rechazadas (con su estado) para que el panel pueda mostrarlas y deshacerlas.
  coincidencias(): (Coincidencia & { estadoRevision: string })[] {
    return [...this.#coincidencias.values()].map((c) => ({
      ...c, bancoIds: c.bancoIds.slice(), ventasIds: c.ventasIds.slice(), estadoRevision: this.#estados.get(c.id)!,
    }));
  }

  sinCruzar(): { banco: string[]; ventas: string[] } {
    const libres = (orden: string[], ocupados: Map<string, string>) => {
      const vistos = new Set<string>();
      return orden.filter((id) => !ocupados.has(id) && !vistos.has(id) && vistos.add(id));
    };
    return { banco: libres(this.#ordenBanco, this.#ocupadoBanco), ventas: libres(this.#ordenVentas, this.#ocupadoVentas) };
  }

  bitacora(): Evento[] {
    return this.#bitacora.slice();
  }

  // Una acción nueva invalida lo que se podía rehacer (como en cualquier editor).
  #ejecutar(r: Registro): void {
    this.#aplicar(r);
    this.#deshacer.apilar(r);
    this.#rehacer.vaciar();
    this.#bitacora.push(limpiar(r));
  }

  #aplicar(r: Registro): void {
    if (r.tipo === 'confirmar') {
      this.#estados.set(r.coincidenciaId, 'confirmada');
    } else if (r.tipo === 'rechazar') {
      this.#estados.set(r.coincidenciaId, 'rechazada');
      this.#liberar(this.#coincidencias.get(r.coincidenciaId)!);
    } else {
      const c = r.coincidencia;
      this.#coincidencias.set(c.id, c);
      this.#estados.set(c.id, 'confirmada');
      this.#ocupar(c);
      // Si se reabre tras un deshacer, sus movimientos deben poder listarse como libres.
      for (const id of c.bancoIds) if (!this.#ordenBanco.includes(id)) this.#ordenBanco.push(id);
      for (const id of c.ventasIds) if (!this.#ordenVentas.includes(id)) this.#ordenVentas.push(id);
    }
  }

  #revertir(r: Registro): void {
    if (r.tipo === 'confirmar') {
      this.#estados.set(r.coincidenciaId, r.anterior!);
    } else if (r.tipo === 'rechazar') {
      // Las pilas garantizan que nada tomó estos movimientos después del rechazo
      // (cualquier acción posterior ya se deshizo antes de llegar aquí).
      this.#estados.set(r.coincidenciaId, r.anterior!);
      this.#ocupar(this.#coincidencias.get(r.coincidenciaId)!);
    } else {
      const c = r.coincidencia;
      this.#liberar(c);
      this.#coincidencias.delete(c.id);
      this.#estados.delete(c.id);
    }
  }

  #ocupar(c: Coincidencia): void {
    for (const id of c.bancoIds) this.#ocupadoBanco.set(id, c.id);
    for (const id of c.ventasIds) this.#ocupadoVentas.set(id, c.id);
  }

  #liberar(c: Coincidencia): void {
    for (const id of c.bancoIds) this.#ocupadoBanco.delete(id);
    for (const id of c.ventasIds) this.#ocupadoVentas.delete(id);
  }
}

// Quita el campo interno "anterior" antes de exponer el evento.
function limpiar(r: Registro): Accion {
  if (r.tipo === 'manual') return { tipo: 'manual', coincidencia: r.coincidencia };
  return { tipo: r.tipo, coincidenciaId: r.coincidenciaId };
}
