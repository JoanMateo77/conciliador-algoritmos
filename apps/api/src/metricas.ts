// Métricas del proceso en memoria: conteo y tiempos por ruta (por nombre de ruta, no por URL,
// para que los ids no inflen la tabla). Se reinician al reiniciar el proceso.

interface Acumulado { conteo: number; totalMs: number; maximoMs: number; errores: number }

export class Metricas {
  readonly iniciado = new Date();
  #porRuta = new Map<string, Acumulado>();
  #porEstado = new Map<string, number>();
  #total = 0;

  registrarPeticion(ruta: string, estado: number, ms: number): void {
    this.#total++;
    const familia = `${Math.floor(estado / 100)}xx`;
    this.#porEstado.set(familia, (this.#porEstado.get(familia) ?? 0) + 1);
    let a = this.#porRuta.get(ruta);
    if (!a) { a = { conteo: 0, totalMs: 0, maximoMs: 0, errores: 0 }; this.#porRuta.set(ruta, a); }
    a.conteo++;
    a.totalMs += ms;
    if (ms > a.maximoMs) a.maximoMs = ms;
    if (estado >= 500) a.errores++;
  }

  instantanea() {
    const porRuta: Record<string, { conteo: number; promedioMs: number; maximoMs: number; errores5xx: number }> = {};
    for (const [ruta, a] of [...this.#porRuta].sort(([x], [y]) => x.localeCompare(y))) {
      porRuta[ruta] = { conteo: a.conteo, promedioMs: redondear(a.totalMs / a.conteo), maximoMs: redondear(a.maximoMs), errores5xx: a.errores };
    }
    const memoria = process.memoryUsage();
    return {
      iniciado: this.iniciado.toISOString(),
      segundosActivo: Math.round((Date.now() - this.iniciado.getTime()) / 1000),
      memoriaMb: { rss: mb(memoria.rss), heapUsado: mb(memoria.heapUsed) },
      peticiones: { total: this.#total, porEstado: Object.fromEntries(this.#porEstado), porRuta },
    };
  }
}

const redondear = (x: number) => Math.round(x * 10) / 10;
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
