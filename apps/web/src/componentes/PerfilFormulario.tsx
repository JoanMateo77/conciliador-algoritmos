import { useId, useState } from 'react';
import { PERFIL_POR_DEFECTO, validarPerfil } from '@conciliador/core';
import type { Perfil } from '@conciliador/core';
import { guardar } from '../almacen.ts';
import { aSlug } from '../archivos.ts';
import { guardarPerfiles, perfilesGuardados } from '../perfiles.ts';
import type { Avisar } from '../tipos.ts';
import { ReglasEditor } from './ReglasEditor.tsx';
import { TarifasEditor } from './TarifasEditor.tsx';

interface Props {
  perfil: Perfil;
  onCambiar: (p: Perfil) => void;
  hayResultado: boolean;
  listas: boolean;
  onConciliar: () => void;
  avisar: Avisar;
}

// Las fracciones se muestran como porcentaje; se redondea para no ver 5,000000001.
const aPorc = (fraccion: number) => Number((fraccion * 100).toFixed(4));
const dePorc = (texto: string) => Number(texto) / 100;
// Las tolerancias en dinero se escriben en pesos y se guardan en centavos enteros.
const aPesos = (centavos: number) => centavos / 100;
const dePesos = (texto: string) => Math.round(Number(texto) * 100);

export function PerfilFormulario({ perfil, onCambiar, hayResultado, listas, onConciliar, avisar }: Props) {
  const [guardados, setGuardados] = useState(perfilesGuardados);
  const [errores, setErrores] = useState<string[]>([]);
  const idEmpresa = useId();
  const base = useId();

  const cambiar = <K extends keyof Perfil>(campo: K, valor: Perfil[K]) => onCambiar({ ...perfil, [campo]: valor });

  const cambiarRetencion = (i: number, cambio: Partial<{ nombre: string; tasa: number }>) => {
    const retenciones = perfil.retenciones.map((r, j) => (j === i ? { ...r, ...cambio } : r));
    cambiar('retenciones', retenciones);
  };

  const guardarPerfil = () => {
    const id = aSlug(perfil.nombre) || 'perfil';
    const validacion = validarPerfil({ ...perfil, id });
    if (!validacion.ok) {
      setErrores(validacion.errores);
      avisar('El perfil tiene errores; revisa los campos marcados.', 'error');
      return;
    }
    setErrores([]);
    const nuevos = { ...guardados, [id]: validacion.perfil };
    const ok = guardarPerfiles(nuevos) && guardar('perfilActivo', id);
    setGuardados(nuevos);
    onCambiar(validacion.perfil);
    avisar(ok ? `Perfil «${validacion.perfil.nombre}» guardado en este navegador.` : 'El navegador no permite guardar; el perfil se usará solo en esta sesión.', ok ? 'info' : 'error');
  };

  const elegirEmpresa = (id: string) => {
    setErrores([]);
    if (id === '') { onCambiar({ ...PERFIL_POR_DEFECTO, nombre: '' }); return; }
    const p = guardados[id];
    if (p) { onCambiar(p); guardar('perfilActivo', id); }
  };

  const eliminar = () => {
    const { [perfil.id]: _quitado, ...resto } = guardados;
    guardarPerfiles(resto);
    setGuardados(resto);
    onCambiar(PERFIL_POR_DEFECTO);
    avisar('Perfil eliminado de este navegador.');
  };

  const campoNumero = (id: string, etiqueta: string, ayuda: string, valor: number, alCambiar: (t: string) => void, extra: { min?: number; max?: number; step?: number; unidad?: string } = {}) => (
    <div className="campo">
      <label htmlFor={`${base}-${id}`}>{etiqueta}</label>
      <div className="con-unidad">
        <input
          id={`${base}-${id}`}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(valor) ? valor : ''}
          min={extra.min}
          max={extra.max}
          step={extra.step ?? 1}
          onChange={(e) => alCambiar(e.target.value)}
          aria-describedby={`${base}-${id}-ayuda`}
        />
        {extra.unidad && <span className="unidad" aria-hidden="true">{extra.unidad}</span>}
      </div>
      <p id={`${base}-${id}-ayuda`} className="ayuda">{ayuda}</p>
    </div>
  );

  const ids = Object.keys(guardados);

  return (
    <section aria-labelledby="titulo-perfil">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-perfil">Perfil de cruce</h2>
          <p className="suave">Cada empresa ajusta cuánto puede faltar por comisiones, cuántos días tarda el abono y qué retenciones le aplican. Se guarda solo en este navegador.</p>
        </div>
        <div className="campo campo--en-linea">
          <label htmlFor={idEmpresa}>Empresa guardada</label>
          <select id={idEmpresa} value={guardados[perfil.id] ? perfil.id : ''} onChange={(e) => elegirEmpresa(e.target.value)}>
            <option value="">Nueva o sin guardar</option>
            {ids.map((id) => <option key={id} value={id}>{guardados[id].nombre}</option>)}
          </select>
        </div>
      </div>

      <form className="tarjeta formulario" onSubmit={(e) => { e.preventDefault(); guardarPerfil(); }}>
        <div className="campo">
          <label htmlFor={`${base}-nombre`}>Nombre de la empresa o del perfil</label>
          <input id={`${base}-nombre`} type="text" value={perfil.nombre} required onChange={(e) => cambiar('nombre', e.target.value)} />
        </div>

        <fieldset>
          <legend>Tolerancias</legend>
          <div className="rejilla-3">
            {campoNumero('tfp', 'Faltante permitido (%)', 'El banco puede abonar hasta este porcentaje menos (comisiones, IVA, retenciones).', aPorc(perfil.toleranciaFaltantePorcentaje), (t) => cambiar('toleranciaFaltantePorcentaje', dePorc(t)), { min: 0, max: 100, step: 0.1, unidad: '%' })}
            {campoNumero('tfc', 'Faltante permitido (pesos)', 'O hasta este valor fijo; se usa el mayor de los dos.', aPesos(perfil.toleranciaFaltanteCentavos), (t) => cambiar('toleranciaFaltanteCentavos', dePesos(t)), { min: 0, step: 1, unidad: '$' })}
            {campoNumero('tsc', 'Sobrante permitido (pesos)', 'Cuánto más puede llegar. Normalmente 0.', aPesos(perfil.toleranciaSobranteCentavos), (t) => cambiar('toleranciaSobranteCentavos', dePesos(t)), { min: 0, step: 1, unidad: '$' })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Fechas y grupos</legend>
          <div className="rejilla-3">
            {campoNumero('vd', 'Días antes del abono', 'La venta puede ser hasta N días anterior al abono.', perfil.ventanaDias, (t) => cambiar('ventanaDias', Math.round(Number(t))), { min: 0, max: 60, unidad: 'días' })}
            {campoNumero('dd', 'Días después del abono', 'Normalmente 0 o 1.', perfil.diasDespues, (t) => cambiar('diasDespues', Math.round(Number(t))), { min: 0, max: 30, unidad: 'días' })}
            {campoNumero('mg', 'Máximo de ventas por abono', 'Para abonos que liquidan varias ventas juntas.', perfil.maxGrupo, (t) => cambiar('maxGrupo', Math.round(Number(t))), { min: 1, max: 20 })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Umbrales de confianza</legend>
          <div className="rejilla-3">
            {campoNumero('ua', 'Aceptar automáticamente desde', 'Coincidencias con puntaje igual o mayor se marcan como automáticas.', aPorc(perfil.umbralAutomatico), (t) => cambiar('umbralAutomatico', dePorc(t)), { min: 0, max: 100, step: 1, unidad: '%' })}
            {campoNumero('us', 'Sugerir desde', 'Entre este valor y el anterior quedan como sugeridas para revisar.', aPorc(perfil.umbralSugerencia), (t) => cambiar('umbralSugerencia', dePorc(t)), { min: 0, max: 100, step: 1, unidad: '%' })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Retenciones conocidas</legend>
          <p className="ayuda">Sirven para explicar faltantes, por ejemplo ReteFuente 1,5 %.</p>
          {perfil.retenciones.length === 0 && <p className="suave">Sin retenciones.</p>}
          <ul className="retenciones">
            {perfil.retenciones.map((r, i) => (
              <li key={i} className="retencion">
                <div className="campo">
                  <label htmlFor={`${base}-rn-${i}`}>Nombre</label>
                  <input id={`${base}-rn-${i}`} type="text" value={r.nombre} onChange={(e) => cambiarRetencion(i, { nombre: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor={`${base}-rt-${i}`}>Tasa</label>
                  <div className="con-unidad">
                    <input id={`${base}-rt-${i}`} type="number" inputMode="decimal" min={0} max={100} step={0.001} value={aPorc(r.tasa)} onChange={(e) => cambiarRetencion(i, { tasa: dePorc(e.target.value) })} />
                    <span className="unidad" aria-hidden="true">%</span>
                  </div>
                </div>
                <button type="button" className="boton boton--peligro boton--pequeno" onClick={() => cambiar('retenciones', perfil.retenciones.filter((_, j) => j !== i))}>
                  Quitar <span className="sr-only">{r.nombre}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="boton boton--secundario boton--pequeno" onClick={() => cambiar('retenciones', [...perfil.retenciones, { nombre: '', tasa: 0 }])}>
            Agregar retención
          </button>
        </fieldset>

        <fieldset>
          <legend>Asignación</legend>
          <label className="interruptor">
            <input type="checkbox" role="switch" checked={perfil.cruceOptimo !== false}
              aria-describedby={`${base}-hungaro-ayuda`}
              onChange={(e) => cambiar('cruceOptimo', e.target.checked)} />
            <span className="interruptor__pista" aria-hidden="true" />
            <span>Asignación óptima (Húngaro)</span>
          </label>
          <p id={`${base}-hungaro-ayuda`} className="ayuda">
            Encendido, cada grupo de candidatos en conflicto (hasta 60 movimientos) se resuelve con el algoritmo Húngaro, que
            maximiza el puntaje total, y se buscan cruces agrupados N:M. Apagado, se asigna de mayor a menor puntaje (greedy, como el MVP).
          </p>
        </fieldset>

        <ReglasEditor reglas={perfil.reglas ?? []} onCambiar={(reglas) => cambiar('reglas', reglas.length > 0 ? reglas : undefined)} />

        <TarifasEditor
          tarifas={perfil.tarifas ?? []}
          municipio={perfil.municipio ?? ''}
          onCambiar={(tarifas) => cambiar('tarifas', tarifas.length > 0 ? tarifas : undefined)}
          onMunicipio={(m) => cambiar('municipio', m.trim() ? m : undefined)}
        />

        {errores.length > 0 && (
          <ul className="errores" role="alert">
            {errores.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}

        <div className="acciones">
          <button type="submit" className="boton">Guardar perfil</button>
          <button type="button" className="boton boton--secundario" onClick={() => { setErrores([]); onCambiar({ ...PERFIL_POR_DEFECTO, nombre: perfil.nombre || PERFIL_POR_DEFECTO.nombre }); }}>
            Valores por defecto
          </button>
          {guardados[perfil.id] && <button type="button" className="boton boton--peligro" onClick={eliminar}>Eliminar perfil</button>}
          {listas && <button type="button" className="boton boton--secundario" onClick={onConciliar}>{hayResultado ? 'Conciliar de nuevo con este perfil' : 'Conciliar con este perfil'}</button>}
        </div>
        {hayResultado && <p className="suave nota">Los cambios se aplican al volver a conciliar.</p>}
        {!listas && <p className="suave nota">Cuando los dos archivos estén cargados podrás conciliar desde aquí.</p>}
      </form>
    </section>
  );
}
