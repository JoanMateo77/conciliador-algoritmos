// Editor de reglas del perfil (fase 10): lista ordenada por prioridad, condiciones Y / O y una acción.
import { useId } from 'react';
import { REGLA_GMF } from '@conciliador/core';
import type { AccionRegla, Condicion, Regla } from '@conciliador/core';

interface Props {
  reglas: Regla[];
  onCambiar: (reglas: Regla[]) => void;
}

const CAMPOS: { id: Condicion['campo']; nombre: string }[] = [
  { id: 'descripcion', nombre: 'Descripción' },
  { id: 'referencia', nombre: 'Referencia' },
  { id: 'plantilla', nombre: 'Plantilla' },
  { id: 'monto', nombre: 'Monto' },
  { id: 'fecha', nombre: 'Fecha' },
];
const OPERADORES = [
  { id: 'contiene', nombre: 'contiene' },
  { id: 'igual', nombre: 'es igual a' },
  { id: 'empiezaPor', nombre: 'empieza por' },
  { id: 'regex', nombre: 'cumple la expresión' },
] as const;
const ACCIONES: { id: AccionRegla['tipo']; nombre: string }[] = [
  { id: 'clasificar', nombre: 'Clasificar (sale del cruce)' },
  { id: 'exigirReferencia', nombre: 'Exigir la misma referencia' },
  { id: 'tolerancia', nombre: 'Usar otra tolerancia' },
];
const CATEGORIAS = ['gasto:GMF', 'gasto:comision', 'ingreso:efectivo', 'ingreso:intereses', 'ignorar'];

const aPesos = (centavos: number) => (Number.isFinite(centavos) ? centavos / 100 : '');
const dePesos = (texto: string) => Math.round(Number(texto) * 100);
const aPorc = (fraccion: number | undefined) => (fraccion === undefined ? '' : Number((fraccion * 100).toFixed(4)));

function condicionNueva(campo: Condicion['campo']): Condicion {
  if (campo === 'monto') return { campo, op: 'entre', min: 0, max: 100_000_00 };
  if (campo === 'fecha') return { campo, op: 'entre', desde: '2026-01-01', hasta: '2026-12-31' };
  return { campo, op: 'contiene', valor: '' };
}

function accionNueva(tipo: AccionRegla['tipo']): AccionRegla {
  if (tipo === 'clasificar') return { tipo, categoria: 'ignorar' };
  if (tipo === 'tolerancia') return { tipo, faltantePorcentaje: 0.05 };
  return { tipo };
}

// Prioridades 10, 20, 30...: dejan espacio para intercalar reglas al editar el JSON a mano.
function renumerar(lista: Regla[]): Regla[] {
  return lista.map((r, i) => ({ ...r, prioridad: (i + 1) * 10 }));
}

function idLibre(lista: Regla[], base: string): string {
  let n = lista.length + 1;
  while (lista.some((r) => r.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function ReglasEditor({ reglas, onCambiar }: Props) {
  // Se muestran en el orden en que el cruce las evalúa (menor prioridad primero).
  const ordenadas = [...reglas].sort((a, b) => a.prioridad - b.prioridad);
  const base = useId();

  const fijar = (lista: Regla[]) => onCambiar(renumerar(lista));
  const cambiar = (i: number, cambio: Partial<Regla>) => fijar(ordenadas.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= ordenadas.length) return;
    const copia = [...ordenadas];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    fijar(copia);
  };
  const agregar = (r: Regla) => fijar([...ordenadas, r]);

  return (
    <fieldset>
      <legend>Reglas</legend>
      <p className="ayuda">
        Se evalúan de arriba abajo; para cada acción gana la primera regla que se cumple. «Clasificar» saca el movimiento
        del cruce (por ejemplo el 4×1000 como gasto) y lo muestra aparte en Resultados.
      </p>
      {ordenadas.length === 0 && <p className="suave">Sin reglas: todos los movimientos entran al cruce.</p>}
      <ol className="reglas">
        {ordenadas.map((r, i) => (
          <li key={i} className="regla">
            <div className="regla__cabeza">
              <span className="insignia insignia--neutra" aria-label={`Prioridad ${i + 1}`}>{i + 1}</span>
              <div className="campo regla__nombre">
                <label htmlFor={`${base}-n-${i}`}>Nombre</label>
                <input id={`${base}-n-${i}`} type="text" value={r.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor={`${base}-l-${i}`}>Aplica a</label>
                <select id={`${base}-l-${i}`} value={r.lado} onChange={(e) => cambiar(i, { lado: e.target.value as Regla['lado'] })}>
                  <option value="banco">Banco</option>
                  <option value="ventas">Ventas</option>
                </select>
              </div>
            </div>

            <GrupoCondiciones titulo="Deben cumplirse todas (Y)" idBase={`${base}-t-${i}`} condiciones={r.si.todas ?? []}
              onCambiar={(todas) => cambiar(i, { si: { ...r.si, todas } })} />
            <GrupoCondiciones titulo="Basta con alguna (O)" idBase={`${base}-a-${i}`} condiciones={r.si.alguna ?? []}
              onCambiar={(alguna) => cambiar(i, { si: { ...r.si, alguna } })} />

            <EditorAccion idBase={`${base}-x-${i}`} accion={r.accion} onCambiar={(accion) => cambiar(i, { accion })} />

            <div className="acciones">
              <button type="button" className="boton boton--secundario boton--pequeno" disabled={i === 0} onClick={() => mover(i, -1)}>
                Subir <span className="sr-only">la regla {r.nombre}</span>
              </button>
              <button type="button" className="boton boton--secundario boton--pequeno" disabled={i === ordenadas.length - 1} onClick={() => mover(i, 1)}>
                Bajar <span className="sr-only">la regla {r.nombre}</span>
              </button>
              <button type="button" className="boton boton--peligro boton--pequeno" onClick={() => fijar(ordenadas.filter((_, j) => j !== i))}>
                Quitar <span className="sr-only">la regla {r.nombre}</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="acciones">
        <button type="button" className="boton boton--secundario boton--pequeno" onClick={() => agregar({
          id: idLibre(ordenadas, 'regla'), nombre: 'Nueva regla', prioridad: 0, lado: 'banco',
          si: { todas: [condicionNueva('descripcion')] }, accion: accionNueva('clasificar'),
        })}>
          Agregar regla
        </button>
        {!ordenadas.some((r) => r.id === REGLA_GMF.id) && (
          <button type="button" className="boton boton--secundario boton--pequeno" onClick={() => agregar(structuredClone(REGLA_GMF))}>
            Agregar regla del 4×1000 (GMF)
          </button>
        )}
      </div>
    </fieldset>
  );
}

function GrupoCondiciones({ titulo, idBase, condiciones, onCambiar }: {
  titulo: string; idBase: string; condiciones: Condicion[]; onCambiar: (c: Condicion[] | undefined) => void;
}) {
  // Un grupo vacío se omite del JSON (undefined), como lo escribiría una persona.
  const fijar = (lista: Condicion[]) => onCambiar(lista.length > 0 ? lista : undefined);
  const cambiar = (k: number, c: Condicion) => fijar(condiciones.map((x, j) => (j === k ? c : x)));
  return (
    <div className="grupo-condiciones">
      <p className="grupo-condiciones__titulo">{titulo}</p>
      {condiciones.length > 0 && (
        <ul className="condiciones">
          {condiciones.map((c, k) => (
            <li key={k} className="condicion">
              <div className="campo">
                <label htmlFor={`${idBase}-c-${k}`}>Campo</label>
                <select id={`${idBase}-c-${k}`} value={c.campo} onChange={(e) => cambiar(k, condicionNueva(e.target.value as Condicion['campo']))}>
                  {CAMPOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
              {c.campo === 'monto' ? (<>
                <div className="campo">
                  <label htmlFor={`${idBase}-min-${k}`}>Desde ($)</label>
                  <input id={`${idBase}-min-${k}`} type="number" inputMode="decimal" min={0} step={1} value={aPesos(c.min)}
                    onChange={(e) => cambiar(k, { ...c, min: dePesos(e.target.value) })} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idBase}-max-${k}`}>Hasta ($)</label>
                  <input id={`${idBase}-max-${k}`} type="number" inputMode="decimal" min={0} step={1} value={aPesos(c.max)}
                    onChange={(e) => cambiar(k, { ...c, max: dePesos(e.target.value) })} />
                </div>
              </>) : c.campo === 'fecha' ? (<>
                <div className="campo">
                  <label htmlFor={`${idBase}-de-${k}`}>Desde</label>
                  <input id={`${idBase}-de-${k}`} type="date" value={c.desde} onChange={(e) => cambiar(k, { ...c, desde: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor={`${idBase}-ha-${k}`}>Hasta</label>
                  <input id={`${idBase}-ha-${k}`} type="date" value={c.hasta} onChange={(e) => cambiar(k, { ...c, hasta: e.target.value })} />
                </div>
              </>) : (<>
                <div className="campo">
                  <label htmlFor={`${idBase}-o-${k}`}>Condición</label>
                  <select id={`${idBase}-o-${k}`} value={c.op} onChange={(e) => cambiar(k, { ...c, op: e.target.value as typeof c.op })}>
                    {OPERADORES.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`${idBase}-v-${k}`}>Valor</label>
                  <input id={`${idBase}-v-${k}`} type="text" value={c.valor} onChange={(e) => cambiar(k, { ...c, valor: e.target.value })} />
                </div>
              </>)}
              <button type="button" className="boton boton--peligro boton--pequeno" onClick={() => fijar(condiciones.filter((_, j) => j !== k))}>
                Quitar <span className="sr-only">condición</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="enlace" onClick={() => fijar([...condiciones, condicionNueva('descripcion')])}>
        Agregar condición <span className="sr-only">a «{titulo}»</span>
      </button>
    </div>
  );
}

function EditorAccion({ idBase, accion, onCambiar }: { idBase: string; accion: AccionRegla; onCambiar: (a: AccionRegla) => void }) {
  return (
    <div className="rejilla-3">
      <div className="campo">
        <label htmlFor={`${idBase}-tipo`}>Entonces</label>
        <select id={`${idBase}-tipo`} value={accion.tipo} onChange={(e) => onCambiar(accionNueva(e.target.value as AccionRegla['tipo']))}>
          {ACCIONES.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>
      {accion.tipo === 'clasificar' && (
        <div className="campo">
          <label htmlFor={`${idBase}-cat`}>Categoría</label>
          <input id={`${idBase}-cat`} type="text" list={`${idBase}-cats`} value={accion.categoria}
            onChange={(e) => onCambiar({ ...accion, categoria: e.target.value })} />
          <datalist id={`${idBase}-cats`}>{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      )}
      {accion.tipo === 'tolerancia' && (<>
        <div className="campo">
          <label htmlFor={`${idBase}-tp`}>Faltante permitido (%)</label>
          <input id={`${idBase}-tp`} type="number" inputMode="decimal" min={0} max={99} step={0.1} value={aPorc(accion.faltantePorcentaje)}
            onChange={(e) => onCambiar({ ...accion, faltantePorcentaje: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} />
        </div>
        <div className="campo">
          <label htmlFor={`${idBase}-tc`}>Faltante permitido ($)</label>
          <input id={`${idBase}-tc`} type="number" inputMode="decimal" min={0} step={1}
            value={accion.faltanteCentavos === undefined ? '' : aPesos(accion.faltanteCentavos)}
            onChange={(e) => onCambiar({ ...accion, faltanteCentavos: e.target.value === '' ? undefined : dePesos(e.target.value) })} />
        </div>
      </>)}
      {accion.tipo === 'exigirReferencia' && (
        <p className="ayuda">Solo cruza con movimientos del otro lado que tengan la misma referencia.</p>
      )}
    </div>
  );
}
