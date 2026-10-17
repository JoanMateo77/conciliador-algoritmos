// Editor de tarifas con vigencia (fase 10): explican faltantes según la fecha del abono.
import { useId } from 'react';
import { TARIFAS_EJEMPLO } from '@conciliador/core';
import type { Tarifa } from '@conciliador/core';

interface Props {
  tarifas: Tarifa[];
  municipio: string;
  onCambiar: (tarifas: Tarifa[]) => void;
  onMunicipio: (municipio: string) => void;
}

const BASES: { id: Tarifa['base']; nombre: string }[] = [
  { id: 'bruto', nombre: 'Valor de la venta' },
  { id: 'comision', nombre: 'Comisión' },
  { id: 'iva', nombre: 'IVA de la comisión' },
];

const aPorc = (fraccion: number) => Number((fraccion * 100).toFixed(4));

// Los opcionales vacíos se quitan del objeto: el validador rechaza textos vacíos.
function limpiar(t: Tarifa): Tarifa {
  const copia: Tarifa = { ...t };
  if (!copia.hasta) delete copia.hasta;
  if (!copia.medioPago?.trim()) delete copia.medioPago;
  if (!copia.municipio?.trim()) delete copia.municipio;
  return copia;
}

export function TarifasEditor({ tarifas, municipio, onCambiar, onMunicipio }: Props) {
  const base = useId();
  const cambiar = (i: number, cambio: Partial<Tarifa>) => onCambiar(tarifas.map((t, j) => (j === i ? limpiar({ ...t, ...cambio }) : t)));

  return (
    <fieldset>
      <legend>Tarifas con vigencia</legend>
      <p className="ayuda">
        Comisión, IVA y retenciones con fecha de inicio y fin. Al explicar un faltante se usan las vigentes a la fecha del
        abono; las que tienen municipio solo aplican si coincide con el del perfil.
      </p>
      <div className="campo campo--corto">
        <label htmlFor={`${base}-mun`}>Municipio de la empresa</label>
        <input id={`${base}-mun`} type="text" value={municipio} placeholder="Ej. Cali" onChange={(e) => onMunicipio(e.target.value)} />
      </div>
      {tarifas.length === 0 && <p className="suave">Sin tarifas: se usan solo las retenciones conocidas.</p>}
      <ul className="tarifas">
        {tarifas.map((t, i) => (
          <li key={i} className="tarifa">
            <div className="campo">
              <label htmlFor={`${base}-n-${i}`}>Nombre</label>
              <input id={`${base}-n-${i}`} type="text" value={t.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`${base}-t-${i}`}>Tasa (%)</label>
              <input id={`${base}-t-${i}`} type="number" inputMode="decimal" min={0} max={99} step={0.001} value={aPorc(t.tasa)}
                onChange={(e) => cambiar(i, { tasa: Number(e.target.value) / 100 })} />
            </div>
            <div className="campo">
              <label htmlFor={`${base}-b-${i}`}>Sobre</label>
              <select id={`${base}-b-${i}`} value={t.base} onChange={(e) => cambiar(i, { base: e.target.value as Tarifa['base'] })}>
                {BASES.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`${base}-d-${i}`}>Vigente desde</label>
              <input id={`${base}-d-${i}`} type="date" value={t.desde} onChange={(e) => cambiar(i, { desde: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`${base}-h-${i}`}>Hasta (opcional)</label>
              <input id={`${base}-h-${i}`} type="date" value={t.hasta ?? ''} onChange={(e) => cambiar(i, { hasta: e.target.value || undefined })} />
            </div>
            <div className="campo">
              <label htmlFor={`${base}-m-${i}`}>Medio de pago</label>
              <input id={`${base}-m-${i}`} type="text" placeholder="Todos" value={t.medioPago ?? ''} onChange={(e) => cambiar(i, { medioPago: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`${base}-u-${i}`}>Municipio</label>
              <input id={`${base}-u-${i}`} type="text" placeholder="Todos" value={t.municipio ?? ''} onChange={(e) => cambiar(i, { municipio: e.target.value })} />
            </div>
            <button type="button" className="boton boton--peligro boton--pequeno" onClick={() => onCambiar(tarifas.filter((_, j) => j !== i))}>
              Quitar <span className="sr-only">{t.nombre}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="acciones">
        <button type="button" className="boton boton--secundario boton--pequeno"
          onClick={() => onCambiar([...tarifas, { nombre: 'ReteFuente', tasa: 0.015, base: 'bruto', desde: '2026-01-01' }])}>
          Agregar tarifa
        </button>
        <button type="button" className="boton boton--secundario boton--pequeno" onClick={() => onCambiar(structuredClone(TARIFAS_EJEMPLO))}>
          Usar tarifas de ejemplo
        </button>
      </div>
    </fieldset>
  );
}
