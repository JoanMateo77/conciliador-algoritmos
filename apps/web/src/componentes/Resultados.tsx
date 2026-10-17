import { useId, useMemo, useState } from 'react';
import { formatearCOP } from '@conciliador/core';
import type { Clasificado, Coincidencia, Evento, Movimiento } from '@conciliador/core';
import { PLANTILLAS } from '@conciliador/plantillas';
import { porcentaje } from '../archivos.ts';
import type { Avisar, Trabajo } from '../tipos.ts';

interface Props {
  trabajo: Trabajo | null;
  seleccionada: string | null;
  onSeleccionar: (id: string | null) => void;
  onCambio: () => void;
  onDeshacer: () => void;
  onRehacer: () => void;
  onIrCargar: () => void;
  onIrGrafo: () => void;
  apiUrl?: string;
  token?: string;
  avisar: Avisar;
}

type FilaRevision = Coincidencia & { estadoRevision: string };

export const NOMBRE_TIPO: Record<string, string> = {
  exacta: 'Exacta', tolerancia: 'Con tolerancia', agrupada: 'Agrupada', agrupadaNM: 'Agrupada N:M', manual: 'Manual',
};
export const NOMBRE_ESTADO: Record<string, string> = {
  automatica: 'Automática', sugerida: 'Sugerida', confirmada: 'Confirmada', rechazada: 'Rechazada',
};

export function suma(ids: string[], mapa: Map<string, Movimiento>): number {
  return ids.reduce((s, id) => s + (mapa.get(id)?.montoCentavos ?? 0), 0);
}

export function Resultados(props: Props) {
  const { trabajo } = props;
  if (!trabajo) {
    return (
      <section aria-labelledby="titulo-resultados" className="vacio">
        <h2 id="titulo-resultados">Resultados</h2>
        <p>Todavía no hay una conciliación. Carga los dos archivos (o la demo) y pulsa «Conciliar».</p>
        <button type="button" className="boton" onClick={props.onIrCargar}>Ir a Cargar</button>
      </section>
    );
  }
  return <ResultadosConTrabajo {...props} trabajo={trabajo} />;
}

function ResultadosConTrabajo({ trabajo, seleccionada, onSeleccionar, onCambio, onDeshacer, onRehacer, onIrGrafo, apiUrl, token, avisar }: Props & { trabajo: Trabajo }) {
  const { sesion, resultado } = trabajo;
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const idTipo = useId();
  const idEstado = useId();

  const mapaBanco = useMemo(() => new Map(trabajo.banco.map((m) => [m.id, m])), [trabajo.banco]);
  const mapaVentas = useMemo(() => new Map(trabajo.ventas.map((m) => [m.id, m])), [trabajo.ventas]);

  // La sesión cambia por dentro; se lee en cada render (el padre fuerza el render tras cada decisión).
  const filas: FilaRevision[] = sesion.coincidencias();
  const sinCruzar = sesion.sinCruzar();
  const clasificados = sesion.clasificados();
  const cuenta = (estado: string) => filas.filter((f) => f.estadoRevision === estado).length;
  const vigentes = filas.filter((f) => f.estadoRevision !== 'rechazada');
  const conciliadoBanco = vigentes.reduce((s, f) => s + suma(f.bancoIds, mapaBanco), 0);
  const conciliadoVentas = vigentes.reduce((s, f) => s + suma(f.ventasIds, mapaVentas), 0);

  const visibles = filas.filter((f) =>
    (filtroTipo === 'todos' || f.tipo === filtroTipo) && (filtroEstado === 'todos' || f.estadoRevision === filtroEstado));
  const actual = filas.find((f) => f.id === seleccionada) ?? null;

  const decidir = (accion: 'confirmar' | 'rechazar', id: string) => {
    try {
      if (accion === 'confirmar') sesion.confirmar(id); else sesion.rechazar(id);
      onCambio();
      avisar(accion === 'confirmar' ? `Coincidencia ${id} confirmada.` : `Coincidencia ${id} rechazada; sus movimientos vuelven a la lista sin cruzar.`);
    } catch (e) {
      avisar(`No se pudo ${accion}: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <section aria-labelledby="titulo-resultados">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-resultados">Resultados</h2>
          <p className="suave">Perfil «{trabajo.perfil.nombre}» · {resultado.pases.map((p) => `${p.nombre}: ${p.coincidencias}`).join(' · ')}</p>
        </div>
        <div className="acciones">
          <button type="button" className="boton boton--secundario" onClick={onDeshacer} disabled={!sesion.puedeDeshacer()} title="Ctrl+Z">
            Deshacer
          </button>
          <button type="button" className="boton boton--secundario" onClick={onRehacer} disabled={!sesion.puedeRehacer()} title="Ctrl+Shift+Z">
            Rehacer
          </button>
          <button type="button" className="boton boton--secundario" onClick={onIrGrafo}>Ver grafo</button>
          {apiUrl && <GuardarServidor apiUrl={apiUrl} token={token} trabajo={trabajo} filas={filas} avisar={avisar} />}
        </div>
      </div>

      <div className="resumen">
        <Tarjeta titulo="Automáticas" valor={cuenta('automatica')} tono="ok" />
        <Tarjeta titulo="Sugeridas" valor={cuenta('sugerida')} tono="sugerida" detalle="para revisar" />
        <Tarjeta titulo="Confirmadas" valor={cuenta('confirmada')} tono="ok" />
        <Tarjeta titulo="Sin cruzar" valor={sinCruzar.banco.length + sinCruzar.ventas.length} tono="error" detalle={`${sinCruzar.banco.length} banco · ${sinCruzar.ventas.length} ventas`} />
        {clasificados.length > 0 && <Tarjeta titulo="Clasificados" valor={clasificados.length} detalle="por reglas del perfil" />}
        <Tarjeta titulo="Total banco" valor={formatearCOP(resultado.resumen.totalBancoCentavos)} detalle={`${resultado.resumen.movimientosBanco} abonos`} />
        <Tarjeta titulo="Total ventas" valor={formatearCOP(resultado.resumen.totalVentasCentavos)} detalle={`${resultado.resumen.movimientosVentas} ventas`} />
        <Tarjeta titulo="Conciliado" valor={formatearCOP(conciliadoBanco)} detalle={`diferencia ${formatearCOP(conciliadoBanco - conciliadoVentas)}`} />
      </div>
      <p className="ayuda">Atajos: Ctrl+Z deshace y Ctrl+Shift+Z rehace (Cmd en Mac).</p>

      <div className="rejilla-detalle">
        <div className="tarjeta">
          <div className="filtros">
            <h3>Coincidencias ({visibles.length} de {filas.length})</h3>
            <div className="campo campo--en-linea">
              <label htmlFor={idTipo}>Tipo</label>
              <select id={idTipo} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                <option value="todos">Todos</option>
                {Object.entries(NOMBRE_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="campo campo--en-linea">
              <label htmlFor={idEstado}>Estado</label>
              <select id={idEstado} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
                <option value="todos">Todos</option>
                {Object.entries(NOMBRE_ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          {visibles.length === 0 ? (
            <p className="suave">No hay coincidencias con estos filtros.</p>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Id</th><th scope="col">Tipo</th><th scope="col">Estado</th>
                    <th scope="col" className="num">Banco</th><th scope="col" className="num">Diferencia</th><th scope="col" className="num">Puntaje</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.id} className={f.id === seleccionada ? 'fila--elegida' : ''} onClick={() => onSeleccionar(f.id)}>
                      <td>
                        <button type="button" className="enlace" aria-pressed={f.id === seleccionada} onClick={(e) => { e.stopPropagation(); onSeleccionar(f.id); }}>
                          {f.id}
                        </button>
                      </td>
                      <td>{NOMBRE_TIPO[f.tipo] ?? f.tipo}{f.bancoIds.length > 1 ? ` (${f.bancoIds.length}:${f.ventasIds.length})` : f.ventasIds.length > 1 ? ` (${f.ventasIds.length})` : ''}</td>
                      <td><Estado estado={f.estadoRevision} /></td>
                      <td className="num">{formatearCOP(suma(f.bancoIds, mapaBanco))}</td>
                      <td className={`num ${f.diferenciaCentavos < 0 ? 'texto-error' : ''}`}>{formatearCOP(f.diferenciaCentavos)}</td>
                      <td className="num">{porcentaje(f.puntaje)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Detalle fila={actual} mapaBanco={mapaBanco} mapaVentas={mapaVentas} onDecidir={decidir} />
      </div>

      <Emparejar trabajo={trabajo} sinCruzar={sinCruzar} mapaBanco={mapaBanco} mapaVentas={mapaVentas}
        onEmparejado={(c) => { onSeleccionar(c.id); onCambio(); }} avisar={avisar} />

      {clasificados.length > 0 && <Clasificados lista={clasificados} trabajo={trabajo} mapaBanco={mapaBanco} mapaVentas={mapaVentas} />}

      <Bitacora eventos={sesion.bitacora()} />
    </section>
  );
}

function Tarjeta({ titulo, valor, detalle, tono }: { titulo: string; valor: string | number; detalle?: string; tono?: string }) {
  return (
    <div className={`tarjeta-resumen ${tono ? `tarjeta-resumen--${tono}` : ''}`}>
      <p className="tarjeta-resumen__titulo">{titulo}</p>
      <p className="tarjeta-resumen__valor">{valor}</p>
      {detalle && <p className="tarjeta-resumen__detalle">{detalle}</p>}
    </div>
  );
}

export function Estado({ estado }: { estado: string }) {
  return <span className={`insignia insignia--${estado}`}>{NOMBRE_ESTADO[estado] ?? estado}</span>;
}

function TablaMovimientos({ titulo, ids, mapa }: { titulo: string; ids: string[]; mapa: Map<string, Movimiento> }) {
  return (
    <div>
      <h4>{titulo} · {formatearCOP(suma(ids, mapa))}</h4>
      <ul className="movimientos">
        {ids.map((id) => {
          const m = mapa.get(id);
          if (!m) return <li key={id}>{id} (no encontrado)</li>;
          return (
            <li key={id} className="movimiento">
              <div className="movimiento__fila">
                <span>{m.fecha}</span>
                <strong className="num">{formatearCOP(m.montoCentavos)}</strong>
              </div>
              <div className="movimiento__ref">{m.referencia || 'sin referencia'}</div>
              {m.descripcion && <div className="suave">{m.descripcion}</div>}
              <div className="ayuda">Línea {m.linea} · {m.plantilla}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Detalle({ fila, mapaBanco, mapaVentas, onDecidir }: {
  fila: FilaRevision | null; mapaBanco: Map<string, Movimiento>; mapaVentas: Map<string, Movimiento>;
  onDecidir: (accion: 'confirmar' | 'rechazar', id: string) => void;
}) {
  if (!fila) {
    return <aside className="tarjeta detalle" aria-label="Detalle"><p className="suave">Elige una coincidencia para ver sus movimientos y la explicación.</p></aside>;
  }
  const cerrada = fila.estadoRevision === 'rechazada';
  return (
    <aside className="tarjeta detalle" aria-labelledby="titulo-detalle">
      <div className="detalle__cabeza">
        <h3 id="titulo-detalle">Coincidencia {fila.id}</h3>
        <Estado estado={fila.estadoRevision} />
      </div>
      <p className="explicacion">{fila.explicacion}</p>
      <dl className="cifras">
        <div><dt>Tipo</dt><dd>{NOMBRE_TIPO[fila.tipo] ?? fila.tipo}</dd></div>
        <div><dt>Puntaje</dt><dd>{porcentaje(fila.puntaje)}</dd></div>
        <div><dt>Diferencia</dt><dd className={fila.diferenciaCentavos < 0 ? 'texto-error' : ''}>{formatearCOP(fila.diferenciaCentavos)}</dd></div>
      </dl>
      <div className="detalle__lados">
        <TablaMovimientos titulo="Banco" ids={fila.bancoIds} mapa={mapaBanco} />
        <TablaMovimientos titulo="Ventas" ids={fila.ventasIds} mapa={mapaVentas} />
      </div>
      <div className="acciones">
        <button type="button" className="boton" disabled={cerrada || fila.estadoRevision === 'confirmada'} onClick={() => onDecidir('confirmar', fila.id)}>
          Confirmar
        </button>
        <button type="button" className="boton boton--peligro" disabled={cerrada} onClick={() => onDecidir('rechazar', fila.id)}>
          Rechazar
        </button>
      </div>
    </aside>
  );
}

function Emparejar({ trabajo, sinCruzar, mapaBanco, mapaVentas, onEmparejado, avisar }: {
  trabajo: Trabajo; sinCruzar: { banco: string[]; ventas: string[] };
  mapaBanco: Map<string, Movimiento>; mapaVentas: Map<string, Movimiento>;
  onEmparejado: (c: Coincidencia) => void; avisar: Avisar;
}) {
  const [elegidosBanco, setElegidosBanco] = useState<string[]>([]);
  const [elegidosVentas, setElegidosVentas] = useState<string[]>([]);
  // Un deshacer puede devolver movimientos a "sin cruzar" o sacarlos: se filtra la selección.
  const banco = elegidosBanco.filter((id) => sinCruzar.banco.includes(id));
  const ventas = elegidosVentas.filter((id) => sinCruzar.ventas.includes(id));
  const diferencia = suma(banco, mapaBanco) - suma(ventas, mapaVentas);

  const alternar = (lista: string[], fijar: (l: string[]) => void, id: string) =>
    fijar(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const emparejar = () => {
    try {
      const c = trabajo.sesion.emparejarManual(banco, ventas, trabajo.banco, trabajo.ventas);
      setElegidosBanco([]);
      setElegidosVentas([]);
      onEmparejado(c);
      avisar(`Emparejamiento manual creado (${c.id}).`);
    } catch (e) {
      avisar(`No se pudo emparejar: ${(e as Error).message}`, 'error');
    }
  };

  const lista = (titulo: string, lado: 'banco' | 'ventas', ids: string[], mapa: Map<string, Movimiento>, elegidos: string[], fijar: (l: string[]) => void) => (
    <fieldset className="sin-cruzar">
      <legend>{titulo} sin cruzar ({ids.length})</legend>
      {ids.length === 0 ? <p className="suave">Todo cruzó.</p> : (
        <ul>
          {ids.map((id) => {
            const m = mapa.get(id);
            return (
              <li key={id}>
                <label className="opcion">
                  <input type="checkbox" checked={elegidos.includes(id)} onChange={() => alternar(elegidos, fijar, id)} />
                  <span className="opcion__texto">
                    <span>{m?.fecha ?? ''} · <strong>{m ? formatearCOP(m.montoCentavos) : id}</strong></span>
                    <span className="suave">{m?.referencia || m?.descripcion || 'sin referencia'}</span>
                  </span>
                </label>
                <Motivo texto={trabajo.sesion.motivo(id, lado)} />
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );

  return (
    <section className="tarjeta" aria-labelledby="titulo-emparejar">
      <h3 id="titulo-emparejar">Sin cruzar y emparejamiento manual</h3>
      <p className="suave">Cada movimiento dice por qué no cruzó. Marca uno o más de cada lado y empareja a mano lo que el motor no pudo resolver.</p>
      <div className="rejilla-2">
        {lista('Banco', 'banco', sinCruzar.banco, mapaBanco, banco, setElegidosBanco)}
        {lista('Ventas', 'ventas', sinCruzar.ventas, mapaVentas, ventas, setElegidosVentas)}
      </div>
      <div className="barra-accion">
        <p aria-live="polite">
          {banco.length} de banco · {ventas.length} de ventas
          {banco.length > 0 && ventas.length > 0 && <> · diferencia <strong className={diferencia < 0 ? 'texto-error' : ''}>{formatearCOP(diferencia)}</strong></>}
        </p>
        <button type="button" className="boton" disabled={banco.length === 0 || ventas.length === 0} onClick={emparejar}>
          Emparejar seleccionados
        </button>
      </div>
    </section>
  );
}

// "Por qué no cruzó": lo calcula conciliar (o la sesión, si quedó libre por un rechazo).
function Motivo({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <p className="motivo"><span className="motivo__etiqueta">Por qué no cruzó:</span> {texto}</p>;
}

const NOMBRE_CATEGORIA: Record<string, string> = {
  'gasto:GMF': 'Gasto bancario: GMF (4×1000)',
  'ingreso:efectivo': 'Ingreso en efectivo',
  'gasto:comision': 'Gasto: comisión',
  ignorar: 'Ignorado',
};

function Clasificados({ lista, trabajo, mapaBanco, mapaVentas }: {
  lista: Clasificado[]; trabajo: Trabajo; mapaBanco: Map<string, Movimiento>; mapaVentas: Map<string, Movimiento>;
}) {
  const nombreRegla = (id: string) => trabajo.perfil.reglas?.find((r) => r.id === id)?.nombre ?? id;
  return (
    <section className="tarjeta" aria-labelledby="titulo-clasificados">
      <h3 id="titulo-clasificados">Clasificados ({lista.length})</h3>
      <p className="suave">Movimientos que una regla del perfil sacó del cruce: no son pagos de ventas, así que no cuentan como «sin cruzar».</p>
      <div className="tabla-envoltura">
        <table className="tabla tabla--compacta">
          <thead>
            <tr><th scope="col">Lado</th><th scope="col">Fecha</th><th scope="col">Descripción</th><th scope="col" className="num">Monto</th><th scope="col">Categoría</th></tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const m = (c.lado === 'banco' ? mapaBanco : mapaVentas).get(c.id);
              return (
                <tr key={`${c.lado}:${c.id}`}>
                  <td>{c.lado === 'banco' ? 'Banco' : 'Ventas'}</td>
                  <td>{m?.fecha ?? ''}</td>
                  <td>{m?.descripcion || m?.referencia || c.id}</td>
                  <td className="num">{m ? formatearCOP(m.montoCentavos) : ''}</td>
                  <td>
                    <span className="insignia insignia--neutra">{NOMBRE_CATEGORIA[c.categoria] ?? c.categoria}</span>
                    <span className="ayuda bloque">Regla: {nombreRegla(c.reglaId)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function describirEvento(e: Evento): string {
  switch (e.tipo) {
    case 'confirmar': return `Confirmada la coincidencia ${e.coincidenciaId}`;
    case 'rechazar': return `Rechazada la coincidencia ${e.coincidenciaId}`;
    case 'manual': return `Emparejamiento manual ${e.coincidencia.id}: ${e.coincidencia.bancoIds.length} de banco con ${e.coincidencia.ventasIds.length} de ventas`;
    default: {
      // La sesión anota deshacer/rehacer como eventos propios que envuelven al original.
      const otro = e as { tipo?: string; evento?: Evento; coincidenciaId?: string };
      if ((otro.tipo === 'deshacer' || otro.tipo === 'rehacer') && otro.evento) {
        const verbo = otro.tipo === 'deshacer' ? 'Deshecho' : 'Rehecho';
        return `${verbo}: ${describirEvento(otro.evento).replace(/^./, (c) => c.toLowerCase())}`;
      }
      return `${otro.tipo ?? 'Evento'}${otro.coincidenciaId ? ` ${otro.coincidenciaId}` : ''}`;
    }
  }
}

function Bitacora({ eventos }: { eventos: Evento[] }) {
  return (
    <section className="tarjeta" aria-labelledby="titulo-bitacora">
      <h3 id="titulo-bitacora">Bitácora de decisiones</h3>
      <p className="ayuda">Nada se borra: deshacer agrega un registro nuevo.</p>
      {eventos.length === 0 ? <p className="suave">Aún no hay decisiones.</p> : (
        <ol className="bitacora">
          {eventos.map((e, i) => <li key={i}>{describirEvento(e)}</li>)}
        </ol>
      )}
    </section>
  );
}

function GuardarServidor({ apiUrl, token, trabajo, filas, avisar }: { apiUrl: string; token?: string; trabajo: Trabajo; filas: FilaRevision[]; avisar: Avisar }) {
  const [enviando, setEnviando] = useState(false);
  const base = apiUrl.replace(/\/+$/, '');
  // La API solo conoce las plantillas incluidas; las propias viven en este navegador.
  // Con sesión iniciada la API también conoce las plantillas de la empresa: ella misma valida.
  const propias = token ? [] : [trabajo.archivos.banco.plantillaId, trabajo.archivos.ventas.plantillaId]
    .filter((id): id is string => id !== undefined && !IDS_INCLUIDAS.has(id));
  const autorizacion: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const enviar = async () => {
    // Es la única acción que saca datos del navegador: se pide confirmación explícita.
    if (!window.confirm('Esto enviará los dos archivos y el perfil al servidor configurado. ¿Continuar?')) return;
    setEnviando(true);
    try {
      const r = await fetch(`${base}/conciliaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...autorizacion },
        body: JSON.stringify({ banco: trabajo.archivos.banco, ventas: trabajo.archivos.ventas, perfil: trabajo.perfil }),
      });
      if (!r.ok) {
        // Se muestra el mensaje de la API (viene en español) en vez de solo el código.
        const cuerpo = (await r.json().catch(() => null)) as { error?: { mensaje?: string; detalles?: unknown } } | null;
        const detalles = cuerpo?.error?.detalles;
        const extra = Array.isArray(detalles) && detalles.every((d) => typeof d === 'string') ? ` ${detalles.join(' ')}` : '';
        throw new Error(`el servidor respondió ${r.status}${cuerpo?.error?.mensaje ? `: ${cuerpo.error.mensaje}${extra}` : ''}`);
      }
      const { id } = (await r.json()) as { id: string };
      // El servidor repite el cruce con los mismos datos (ids c1, c2... estables): se replican las decisiones.
      let replicadas = 0;
      for (const f of filas) {
        if (f.tipo === 'manual') continue;
        const accion = f.estadoRevision === 'confirmada' ? 'confirmar' : f.estadoRevision === 'rechazada' ? 'rechazar' : null;
        if (!accion) continue;
        const rr = await fetch(`${base}/conciliaciones/${encodeURIComponent(id)}/coincidencias/${encodeURIComponent(f.id)}/${accion}`, { method: 'POST', headers: autorizacion });
        if (rr.ok) replicadas++;
      }
      const manuales = filas.filter((f) => f.tipo === 'manual').length;
      avisar(`Guardada en el servidor con id ${id}. Decisiones enviadas: ${replicadas}.${manuales ? ` Los ${manuales} emparejamientos manuales no se envían (la API aún no los admite).` : ''}`);
    } catch (e) {
      avisar(`No se pudo guardar en el servidor: ${(e as Error).message}`, 'error');
    } finally {
      setEnviando(false);
    }
  };

  const motivo = trabajo.bloqueoServidor
    ? `No se puede guardar en el servidor: ${trabajo.bloqueoServidor}`
    : propias.length > 0
      ? `No se puede guardar en el servidor: la plantilla ${propias.map((id) => `«${id}»`).join(' y ')} es propia de este navegador y la API solo conoce las plantillas incluidas.`
      : undefined;

  return (
    <>
      <button type="button" className="boton boton--secundario" disabled={enviando || motivo !== undefined} title={motivo}
        aria-describedby={motivo ? 'motivo-guardar' : undefined} onClick={() => void enviar()}>
        {enviando ? 'Guardando…' : 'Guardar en el servidor'}
      </button>
      {motivo && <p id="motivo-guardar" className="ayuda">{motivo}</p>}
    </>
  );
}

const IDS_INCLUIDAS = new Set(PLANTILLAS.map((p) => p.id));
