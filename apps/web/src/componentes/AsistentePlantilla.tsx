import { useId, useMemo, useState } from 'react';
import { formatearCOP, leerArchivo, validarPlantilla } from '@conciliador/core';
import type { CampoDestino, Lado, Mapeo, Movimiento, Plantilla } from '@conciliador/core';
import { aSlug, decodificar, descargarJSON, detectarSeparador, leerBytes, partirCSV } from '../archivos.ts';
import type { Codificacion } from '../archivos.ts';
import type { Avisar } from '../tipos.ts';

interface Props {
  idsOcupados: string[];          // ids de plantillas incluidas: no se pueden pisar
  idsPropios: string[];
  onGuardar: (p: Plantilla) => void;
  avisar: Avisar;
}

const CAMPOS: { id: CampoDestino; nombre: string; unico: boolean }[] = [
  { id: 'fecha', nombre: 'Fecha (obligatoria)', unico: true },
  { id: 'monto', nombre: 'Monto (obligatorio)', unico: true },
  { id: 'referencia', nombre: 'Referencia', unico: true },
  { id: 'descripcion', nombre: 'Descripción (se pueden unir varias)', unico: false },
  { id: 'id', nombre: 'Identificador único', unico: true },
  { id: 'referenciaPago', nombre: 'Referencia de pago (Bre-B)', unico: true },
  { id: 'bruto', nombre: 'Valor bruto', unico: true },
  { id: 'comision', nombre: 'Comisión', unico: true },
  { id: 'ivaComision', nombre: 'IVA de la comisión', unico: true },
  { id: 'retenciones', nombre: 'Retenciones', unico: true },
];

const FORMATOS_FECHA = ['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd-MM-yyyy', 'yyyy/MM/dd', 'yyyyMMdd', 'dd/MM/yy'];
const SEPARADORES: { valor: string; nombre: string }[] = [
  { valor: 'auto', nombre: 'Detectar' }, { valor: ',', nombre: 'Coma (,)' }, { valor: ';', nombre: 'Punto y coma (;)' },
  { valor: '\t', nombre: 'Tabulador' }, { valor: '|', nombre: 'Barra (|)' },
];

// Ejemplo inventado para probar el asistente sin tener un archivo a mano.
const EJEMPLO = `Fecha movimiento;Concepto;Documento;Valor crédito;Saldo
03/10/2026;TRANSFERENCIA RECIBIDA CLIENTE DEMO;FAC-0012;150.000,00;1.150.000,00
04/10/2026;PAGO PSE;FAC-0013;89.900,50;1.239.900,50
06/10/2026;"CONSIGNACION; OFICINA CENTRO";FAC-0014;45.000,00;1.284.900,50
`;

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Sugerencia por nombre de columna; el orden importa ("iva comision" antes que "comision").
function sugerirCampo(columna: string): CampoDestino | '' {
  const c = sinTildes(columna);
  if (/saldo|balance/.test(c)) return '';
  if (/iva/.test(c)) return 'ivaComision';
  if (/comision|fee/.test(c)) return 'comision';
  if (/retenc|rete|tax|impuesto/.test(c)) return 'retenciones';
  if (/bruto|gross/.test(c)) return 'bruto';
  if (/fecha|date|created|^fec/.test(c)) return 'fecha';
  if (/bre.?b|referencia.?pago/.test(c)) return 'referenciaPago';
  if (/ref|factura|pedido|order|documento/.test(c)) return 'referencia';
  if (/^(id|codigo|cod)\b|^id[_ ]|[_ ]id$/.test(c)) return 'id';
  if (/valor|monto|amount|importe|credito|abono|total|cents/.test(c)) return 'monto';
  if (/desc|concepto|detalle|cliente|nombre|observ|metodo/.test(c)) return 'descripcion';
  return '';
}

function adivinarFecha(valor: string | undefined): string {
  const v = (valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return 'yyyy-MM-dd';
  if (/^\d{4}\/\d{2}\/\d{2}/.test(v)) return 'yyyy/MM/dd';
  if (/^\d{8}$/.test(v)) return 'yyyyMMdd';
  if (/^\d{2}-\d{2}-\d{4}/.test(v)) return 'dd-MM-yyyy';
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(v)) return 'dd/MM/yy';
  // Si el "mes" pasa de 12, es formato estadounidense.
  const m = /^(\d{2})\/(\d{2})\/\d{4}/.exec(v);
  if (m && Number(m[2]) > 12) return 'MM/dd/yyyy';
  return 'dd/MM/yyyy';
}

function adivinarDecimal(valores: string[]): ',' | '.' {
  if (valores.some((v) => /,\d{1,2}$/.test(v.trim()))) return ',';
  if (valores.some((v) => /\.\d{1,2}$/.test(v.trim()))) return '.';
  return ',';
}

export function AsistentePlantilla({ idsOcupados, idsPropios, onGuardar, avisar }: Props) {
  const base = useId();
  const [nombre, setNombre] = useState('');
  const [lado, setLado] = useState<Lado>('banco');
  const [codificacion, setCodificacion] = useState<Codificacion>('utf-8');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [textoPegado, setTextoPegado] = useState('');
  const [separadorElegido, setSeparadorElegido] = useState('auto');
  const [formatoElegido, setFormatoElegido] = useState('');
  const [decimalElegido, setDecimalElegido] = useState<'' | ',' | '.'>('');
  const [soloEntradas, setSoloEntradas] = useState(true);
  const [montoEnCentavos, setMontoEnCentavos] = useState<boolean | null>(null);
  const [asignacion, setAsignacion] = useState<Record<string, CampoDestino | ''>>({});

  // Con archivo subido, el texto sale de los bytes y la codificación elegida.
  const texto = bytes ? decodificar(bytes, codificacion) : textoPegado;
  const separador = separadorElegido === 'auto' ? detectarSeparador(texto) : separadorElegido;
  const filas = useMemo(() => (texto.trim() ? partirCSV(texto, separador, 6) : []), [texto, separador]);
  const encabezados = filas[0] ?? [];
  const ejemplos = filas.slice(1);

  const sugeridos = useMemo(() => {
    const usados = new Set<string>();
    const r: Record<string, CampoDestino | ''> = {};
    for (const col of encabezados) {
      const s = sugerirCampo(col);
      const unico = CAMPOS.find((c) => c.id === s)?.unico;
      r[col] = s && unico && usados.has(s) ? '' : s;
      if (s) usados.add(s);
    }
    return r;
  }, [encabezados.join('\u0000')]);

  const campoDe = (col: string): CampoDestino | '' => (col in asignacion ? asignacion[col] : sugeridos[col] ?? '');
  const columnaDe = (campo: CampoDestino) => encabezados.filter((c) => campoDe(c) === campo);
  const valoresDe = (col: string | undefined) => {
    const i = col === undefined ? -1 : encabezados.indexOf(col);
    return i < 0 ? [] : ejemplos.map((f) => f[i] ?? '');
  };

  const colFecha = columnaDe('fecha')[0];
  const colMonto = columnaDe('monto')[0];
  const formatoFecha = formatoElegido || adivinarFecha(valoresDe(colFecha)[0]);
  const separadorDecimal = decimalElegido || adivinarDecimal(valoresDe(colMonto));
  const enCentavos = montoEnCentavos ?? Boolean(colMonto && /cents|centavos/i.test(colMonto));

  const idPlantilla = useMemo(() => {
    const raiz = `propia-${aSlug(nombre) || 'plantilla'}`;
    return idsOcupados.includes(raiz) ? `${raiz}-2` : raiz;
  }, [nombre, idsOcupados]);

  // Arma la plantilla a partir de las elecciones; los problemas se muestran antes de validar.
  const { borrador, problemas } = useMemo(() => {
    const problemas: string[] = [];
    const columnas: Partial<Record<CampoDestino, Mapeo>> = {};
    for (const campo of CAMPOS) {
      const cols = columnaDe(campo.id);
      if (cols.length === 0) continue;
      if (cols.length > 1 && campo.unico) { problemas.push(`Solo una columna puede ser «${campo.nombre}»: elegiste ${cols.join(', ')}.`); continue; }
      if (cols.length > 1) columnas[campo.id] = { unir: cols };
      else if (campo.id === 'monto' && enCentavos) columnas.monto = { de: cols[0], decimalesImplicitos: 2 };
      else columnas[campo.id] = cols[0];
    }
    if (!columnas.fecha) problemas.push('Asigna la columna de fecha.');
    if (!columnas.monto) problemas.push('Asigna la columna de monto.');
    if (!nombre.trim()) problemas.push('Escribe un nombre para la plantilla.');
    const borrador: Plantilla = {
      id: idPlantilla,
      nombre: nombre.trim() || 'Plantilla sin nombre',
      version: 1,
      lado,
      descripcion: `Creada con el asistente del panel${nombreArchivo ? ` a partir de ${nombreArchivo}` : ''}.`,
      fuente: 'Asistente de plantillas (muestra del usuario)',
      tipo: 'delimitado',
      codificacion,
      separador,
      separadorDecimal,
      formatoFecha,
      filasEncabezado: 1,
      soloEntradas,
      detectar: { encabezados: encabezados.filter((c) => c.trim() !== '') },
      columnas,
    };
    return { borrador, problemas };
  }, [encabezados.join('\u0000'), asignacion, sugeridos, enCentavos, nombre, idPlantilla, lado, nombreArchivo, codificacion, separador, separadorDecimal, formatoFecha, soloEntradas]);

  const vistaPrevia = useMemo(() => {
    if (!texto.trim() || problemas.some((p) => /fecha|monto/.test(p))) return null;
    const v = validarPlantilla(borrador);
    if (!v.ok) return { errores: v.errores.map((m) => ({ linea: 0, mensaje: m })), movimientos: [] as Movimiento[], invalida: true };
    try {
      return { ...leerArchivo(texto, v.plantilla), invalida: false };
    } catch (e) {
      return { errores: [{ linea: 0, mensaje: (e as Error).message }], movimientos: [] as Movimiento[], invalida: true };
    }
  }, [borrador, texto, problemas]);

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return;
    try {
      setBytes(await leerBytes(archivo));
      setNombreArchivo(archivo.name);
      setAsignacion({});
      if (!nombre) setNombre(archivo.name.replace(/\.[^.]+$/, ''));
    } catch {
      avisar(`No se pudo leer ${archivo.name}.`, 'error');
    }
  };

  const guardarPlantilla = () => {
    const v = validarPlantilla(borrador);
    if (problemas.length || !v.ok) {
      avisar(`La plantilla no se puede guardar: ${[...problemas, ...(v.ok ? [] : v.errores)].join(' ')}`, 'error');
      return;
    }
    if (idsPropios.includes(v.plantilla.id) && !window.confirm(`Ya tienes una plantilla «${v.plantilla.id}». ¿Reemplazarla?`)) return;
    onGuardar(v.plantilla);
  };

  const listo = problemas.length === 0 && vistaPrevia && !vistaPrevia.invalida && vistaPrevia.movimientos.length > 0;

  return (
    <section className="tarjeta asistente" aria-labelledby="titulo-asistente">
      <h3 id="titulo-asistente">Asistente: crear una plantilla sin código</h3>
      <p className="suave">Para archivos delimitados (CSV, TXT con ; o |) con una fila de encabezados. La muestra se procesa solo en tu navegador.</p>

      <ol className="pasos">
        <li>
          <h4>Datos básicos</h4>
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor={`${base}-nombre`}>Nombre de la plantilla</label>
              <input id={`${base}-nombre`} type="text" value={nombre} placeholder="Ej.: Extracto de mi banco" onChange={(e) => setNombre(e.target.value)} />
              <p className="ayuda">Id: <code>{idPlantilla}</code></p>
            </div>
            <div className="campo">
              <label htmlFor={`${base}-lado`}>¿De qué lado es?</label>
              <select id={`${base}-lado`} value={lado} onChange={(e) => setLado(e.target.value as Lado)}>
                <option value="banco">Banco (abonos, recaudos)</option>
                <option value="ventas">Ventas (pasarela, ERP)</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`${base}-cod`}>Codificación</label>
              <select id={`${base}-cod`} value={codificacion} onChange={(e) => setCodificacion(e.target.value as Codificacion)}>
                <option value="utf-8">UTF-8</option>
                <option value="latin1">Latin-1 / Windows (tildes raras)</option>
              </select>
            </div>
          </div>
        </li>

        <li>
          <h4>Muestra del archivo</h4>
          <div className="acciones">
            <label htmlFor={`${base}-archivo`} className="boton boton--secundario">Subir una muestra</label>
            <input id={`${base}-archivo`} type="file" className="sr-only" accept=".csv,.txt,.tsv,text/csv,text/plain"
              onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="boton boton--secundario" onClick={() => {
              setBytes(null); setNombreArchivo(''); setTextoPegado(EJEMPLO); setAsignacion({});
              if (!nombre) setNombre('Banco de ejemplo');
            }}>Usar un ejemplo inventado</button>
            {nombreArchivo && <span className="suave">Archivo: {nombreArchivo}</span>}
          </div>
          <div className="campo">
            <label htmlFor={`${base}-texto`}>O pega aquí las primeras líneas</label>
            <textarea id={`${base}-texto`} rows={6} spellCheck={false} value={texto}
              onChange={(e) => { setBytes(null); setNombreArchivo(''); setTextoPegado(e.target.value); }} />
          </div>
        </li>

        <li>
          <h4>Formato</h4>
          <div className="rejilla-3">
            <div className="campo">
              <label htmlFor={`${base}-sep`}>Separador de columnas</label>
              <select id={`${base}-sep`} value={separadorElegido} onChange={(e) => { setSeparadorElegido(e.target.value); setAsignacion({}); }}>
                {SEPARADORES.map((s) => <option key={s.nombre} value={s.valor}>{s.nombre}{s.valor === 'auto' && texto ? ` (${SEPARADORES.find((x) => x.valor === separador)?.nombre ?? separador})` : ''}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`${base}-fecha`}>Formato de fecha</label>
              <select id={`${base}-fecha`} value={formatoFecha} onChange={(e) => setFormatoElegido(e.target.value)}>
                {FORMATOS_FECHA.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {colFecha && <p className="ayuda">Ejemplo: {valoresDe(colFecha)[0] ?? '—'}</p>}
            </div>
            <div className="campo">
              <label htmlFor={`${base}-dec`}>Separador decimal</label>
              <select id={`${base}-dec`} value={separadorDecimal} onChange={(e) => setDecimalElegido(e.target.value as ',' | '.')}>
                <option value=",">Coma: 1.234,56</option>
                <option value=".">Punto: 1,234.56</option>
              </select>
              {colMonto && <p className="ayuda">Ejemplo: {valoresDe(colMonto)[0] ?? '—'}</p>}
            </div>
          </div>
          <div className="opciones">
            <label className="opcion">
              <input type="checkbox" checked={soloEntradas} onChange={(e) => setSoloEntradas(e.target.checked)} />
              <span>Solo entradas de dinero (descarta montos en cero o negativos)</span>
            </label>
            <label className="opcion">
              <input type="checkbox" checked={enCentavos} onChange={(e) => setMontoEnCentavos(e.target.checked)} />
              <span>El monto viene en centavos sin separador (ej. 8950000 = $89.500)</span>
            </label>
          </div>
        </li>

        <li>
          <h4>Columnas detectadas</h4>
          {encabezados.length === 0 ? <p className="suave">Sube o pega una muestra para ver sus columnas.</p> : (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th scope="col">Columna</th><th scope="col">Ejemplos</th><th scope="col">Campo destino</th></tr></thead>
                <tbody>
                  {encabezados.map((col, i) => (
                    <tr key={`${col}-${i}`}>
                      <th scope="row">{col || <em>(sin nombre)</em>}</th>
                      <td className="ejemplos">{ejemplos.slice(0, 2).map((f) => f[i] ?? '').filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <label htmlFor={`${base}-col-${i}`} className="sr-only">Campo destino para {col}</label>
                        <select id={`${base}-col-${i}`} value={campoDe(col)} onChange={(e) => setAsignacion((a) => ({ ...a, [col]: e.target.value as CampoDestino | '' }))}>
                          <option value="">No usar</option>
                          {CAMPOS.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {problemas.length > 0 && texto.trim() && (
            <ul className="errores" aria-live="polite">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
        </li>

        <li>
          <h4>Vista previa de movimientos</h4>
          {!vistaPrevia ? <p className="suave">Aparece cuando asignes fecha y monto.</p> : (
            <>
              <p aria-live="polite">
                Se leyeron <strong>{vistaPrevia.movimientos.length}</strong> movimientos
                {vistaPrevia.errores.length > 0 && <> y <strong className="texto-error">{vistaPrevia.errores.length}</strong> líneas con error</>}.
              </p>
              {vistaPrevia.movimientos.length > 0 && (
                <div className="tabla-envoltura">
                  <table className="tabla tabla--compacta">
                    <thead><tr><th scope="col">Línea</th><th scope="col">Fecha</th><th scope="col">Referencia</th><th scope="col">Descripción</th><th scope="col" className="num">Monto</th></tr></thead>
                    <tbody>
                      {vistaPrevia.movimientos.slice(0, 10).map((m) => (
                        <tr key={m.id}><td>{m.linea}</td><td>{m.fecha}</td><td className="ref">{m.referencia || '—'}</td><td>{m.descripcion}</td><td className="num">{formatearCOP(m.montoCentavos)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {vistaPrevia.errores.length > 0 && (
                <ul className="errores">
                  {vistaPrevia.errores.slice(0, 10).map((e, i) => <li key={i}>{e.linea > 0 && <strong>Línea {e.linea}: </strong>}{e.mensaje}</li>)}
                </ul>
              )}
            </>
          )}
        </li>

        <li>
          <h4>Guardar</h4>
          <p className="suave">Se guarda en este navegador y se usa para detectar archivos con los mismos encabezados.</p>
          <div className="acciones">
            <button type="button" className="boton" disabled={!listo} onClick={guardarPlantilla}>Guardar plantilla</button>
            <button type="button" className="boton boton--secundario" disabled={problemas.length > 0} onClick={() => descargarJSON(`${borrador.id}.json`, borrador)}>
              Exportar JSON
            </button>
          </div>
          <details>
            <summary>Ver el JSON</summary>
            <pre className="json">{JSON.stringify(borrador, null, 2)}</pre>
          </details>
        </li>
      </ol>
    </section>
  );
}
