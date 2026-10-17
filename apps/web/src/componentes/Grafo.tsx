import { useId, useMemo } from 'react';
import { formatearCOP } from '@conciliador/core';
import type { Movimiento } from '@conciliador/core';
import type { Trabajo } from '../tipos.ts';
import { NOMBRE_ESTADO, NOMBRE_TIPO } from './Resultados.tsx';

interface Props {
  trabajo: Trabajo | null;
  seleccionada: string | null;
  onSeleccionar: (id: string | null) => void;
  onIrCargar: () => void;
  onVerDetalle: () => void;
}

const ANCHO = 720;
const X_BANCO = 236;
const X_VENTAS = ANCHO - X_BANCO;
const FILA = 30;
const ARRIBA = 48;

const ordenar = (a: Movimiento, b: Movimiento) => a.fecha.localeCompare(b.fecha) || b.montoCentavos - a.montoCentavos;

export function Grafo({ trabajo, seleccionada, onSeleccionar, onIrCargar, onVerDetalle }: Props) {
  const idSelector = useId();
  const idDescripcion = useId();

  // Posición vertical de cada movimiento: banco a la izquierda, ventas a la derecha, por fecha.
  const posiciones = useMemo(() => {
    if (!trabajo) return null;
    const banco = [...trabajo.banco].sort(ordenar);
    const ventas = [...trabajo.ventas].sort(ordenar);
    const y = (i: number) => ARRIBA + i * FILA;
    return {
      banco,
      ventas,
      yBanco: new Map(banco.map((m, i) => [m.id, y(i)])),
      yVentas: new Map(ventas.map((m, i) => [m.id, y(i)])),
      alto: ARRIBA + Math.max(banco.length, ventas.length, 1) * FILA,
    };
  }, [trabajo]);

  if (!trabajo || !posiciones) {
    return (
      <section aria-labelledby="titulo-grafo" className="vacio">
        <h2 id="titulo-grafo">Grafo de candidatos</h2>
        <p>El grafo aparece después de conciliar.</p>
        <button type="button" className="boton" onClick={onIrCargar}>Ir a Cargar</button>
      </section>
    );
  }

  const { banco, ventas, yBanco, yVentas, alto } = posiciones;
  const filas = trabajo.sesion.coincidencias();
  const actual = filas.find((f) => f.id === seleccionada) ?? null;
  const resaltados = new Set(actual ? [...actual.bancoIds, ...actual.ventasIds] : []);
  const coincidenciaDe = (idMovimiento: string, lado: 'banco' | 'ventas') =>
    filas.find((f) => f.estadoRevision !== 'rechazada' && (lado === 'banco' ? f.bancoIds : f.ventasIds).includes(idMovimiento));

  const aristasCandidatas = trabajo.resultado.grafo.aristas;
  const pesoMaximo = Math.max(1e-9, ...aristasCandidatas.map((a) => a.peso));

  return (
    <section aria-labelledby="titulo-grafo">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-grafo">Grafo de candidatos</h2>
          <p className="suave" id={idDescripcion}>
            Banco a la izquierda y ventas a la derecha, ordenados por fecha. Las líneas grises son candidatos del pase con tolerancia
            (más gruesas = mejor puntaje); las de color son las coincidencias elegidas.
          </p>
        </div>
        <div className="acciones">
          <div className="campo campo--en-linea">
            <label htmlFor={idSelector}>Resaltar</label>
            <select id={idSelector} value={seleccionada ?? ''} onChange={(e) => onSeleccionar(e.target.value || null)}>
              <option value="">Ninguna</option>
              {filas.map((f) => <option key={f.id} value={f.id}>{f.id} · {NOMBRE_TIPO[f.tipo] ?? f.tipo} · {NOMBRE_ESTADO[f.estadoRevision] ?? f.estadoRevision}</option>)}
            </select>
          </div>
          <button type="button" className="boton boton--secundario" disabled={!actual} onClick={onVerDetalle}>Ver detalle</button>
        </div>
      </div>

      <div className="leyenda" aria-hidden="true">
        <span><i className="muestra-linea muestra-linea--candidata" /> Candidato</span>
        <span><i className="muestra-linea muestra-linea--automatica" /> Automática</span>
        <span><i className="muestra-linea muestra-linea--sugerida" /> Sugerida</span>
        <span><i className="muestra-linea muestra-linea--confirmada" /> Confirmada</span>
        <span><i className="muestra-linea muestra-linea--rechazada" /> Rechazada</span>
      </div>

      {actual && <p className="explicacion">{actual.id}: {actual.explicacion}</p>}

      <div className="grafo-envoltura tarjeta">
        <svg
          className={`grafo ${actual ? 'grafo--con-seleccion' : ''}`}
          viewBox={`0 0 ${ANCHO} ${alto}`}
          role="img"
          aria-label={`Grafo bipartito con ${banco.length} movimientos de banco, ${ventas.length} ventas y ${aristasCandidatas.length} aristas candidatas`}
          aria-describedby={idDescripcion}
        >
          <text x={X_BANCO} y={22} textAnchor="middle" className="grafo__titulo">Banco ({banco.length})</text>
          <text x={X_VENTAS} y={22} textAnchor="middle" className="grafo__titulo">Ventas ({ventas.length})</text>

          <g>
            {aristasCandidatas.map((a, i) => {
              const y1 = yBanco.get(a.banco);
              const y2 = yVentas.get(a.venta);
              if (y1 === undefined || y2 === undefined) return null;
              const activa = resaltados.has(a.banco) && resaltados.has(a.venta);
              return (
                <line key={`c${i}`} x1={X_BANCO} y1={y1} x2={X_VENTAS} y2={y2}
                  className={`arista arista--candidata ${activa ? 'arista--activa' : ''}`}
                  strokeWidth={1 + (a.peso / pesoMaximo) * 5}>
                  <title>{`Candidato con puntaje ${Math.round(a.peso * 100)} %`}</title>
                </line>
              );
            })}
          </g>

          <g>
            {filas.flatMap((f) => f.bancoIds.flatMap((b) => f.ventasIds.map((v) => {
              const y1 = yBanco.get(b);
              const y2 = yVentas.get(v);
              if (y1 === undefined || y2 === undefined) return null;
              const activa = f.id === seleccionada;
              return (
                <g key={`${f.id}-${b}-${v}`} className="arista-grupo" onClick={() => onSeleccionar(f.id)}>
                  <line x1={X_BANCO} y1={y1} x2={X_VENTAS} y2={y2} className={`arista arista--${f.estadoRevision} ${activa ? 'arista--activa' : ''}`} />
                  {/* Línea invisible más ancha para que sea fácil tocarla con el dedo. */}
                  <line x1={X_BANCO} y1={y1} x2={X_VENTAS} y2={y2} className="arista-toque">
                    <title>{`${f.id}: ${f.explicacion}`}</title>
                  </line>
                </g>
              );
            })))}
          </g>

          {banco.map((m) => (
            <Nodo key={m.id} m={m} x={X_BANCO} y={yBanco.get(m.id) ?? 0} lado="banco" resaltado={resaltados.has(m.id)}
              libre={!coincidenciaDe(m.id, 'banco')}
              onClick={() => { const c = coincidenciaDe(m.id, 'banco'); if (c) onSeleccionar(c.id); }} />
          ))}
          {ventas.map((m) => (
            <Nodo key={m.id} m={m} x={X_VENTAS} y={yVentas.get(m.id) ?? 0} lado="ventas" resaltado={resaltados.has(m.id)}
              libre={!coincidenciaDe(m.id, 'ventas')}
              onClick={() => { const c = coincidenciaDe(m.id, 'ventas'); if (c) onSeleccionar(c.id); }} />
          ))}
        </svg>
      </div>
      <p className="ayuda">Toca una línea o un movimiento para resaltar su coincidencia. Los círculos huecos son movimientos sin cruzar.</p>
    </section>
  );
}

function Nodo({ m, x, y, lado, resaltado, libre, onClick }: {
  m: Movimiento; x: number; y: number; lado: 'banco' | 'ventas'; resaltado: boolean; libre: boolean; onClick: () => void;
}) {
  const izquierda = lado === 'banco';
  const etiqueta = `${m.fecha.slice(5).replace('-', '/')}  ${formatearCOP(m.montoCentavos)}`;
  const referencia = (m.referencia || m.descripcion || '').slice(0, 16);
  return (
    <g className={`nodo ${resaltado ? 'nodo--resaltado' : ''} ${libre ? 'nodo--libre' : ''}`} onClick={onClick}>
      <title>{`${m.fecha} · ${formatearCOP(m.montoCentavos)} · ${m.referencia || 'sin referencia'}`}</title>
      <circle cx={x} cy={y} r={6} />
      <text x={izquierda ? x - 12 : x + 12} y={y - 1} textAnchor={izquierda ? 'end' : 'start'} className="nodo__monto">{etiqueta}</text>
      <text x={izquierda ? x - 12 : x + 12} y={y + 11} textAnchor={izquierda ? 'end' : 'start'} className="nodo__ref">{referencia}</text>
    </g>
  );
}
