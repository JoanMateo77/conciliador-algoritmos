import { useId, useState } from 'react';
import type { DragEvent } from 'react';
import { formatearCOP } from '@conciliador/core';
import type { Lado, Perfil, Plantilla } from '@conciliador/core';
import { decodificar, leerBytes, porcentaje } from '../archivos.ts';
import { DEMOS } from '../perfiles.ts';
import type { Avisar, Carga, Lectura } from '../tipos.ts';

interface Props {
  lecturas: { banco: Lectura | null; ventas: Lectura | null };
  plantillas: Plantilla[];
  perfil: Perfil;
  listas: boolean;
  hayResultado: boolean;
  onCarga: (lado: Lado, carga: Carga | null) => void;
  onDemo: (demoId: string) => void;
  onDemoB2B: () => void;
  onConciliar: () => void;
  onIrPerfil: () => void;
  avisar: Avisar;
}

export function Cargar(props: Props) {
  const { lecturas, plantillas, perfil, listas, hayResultado } = props;
  const [demo, setDemo] = useState(DEMOS[0].id);
  const idDemo = useId();

  return (
    <section aria-labelledby="titulo-cargar">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-cargar">Cargar archivos</h2>
          <p className="suave">Arrastra el extracto del banco y el reporte de ventas, o prueba con la demo de Tienda La Ceiba (datos inventados).</p>
        </div>
        <div className="demo">
          <label htmlFor={idDemo} className="sr-only">Demo a cargar</label>
          <select id={idDemo} value={demo} onChange={(e) => setDemo(e.target.value)}>
            {DEMOS.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
          <button type="button" className="boton boton--secundario" onClick={() => props.onDemo(demo)}>Usar datos de demo</button>
          <button type="button" className="boton boton--secundario" onClick={props.onDemoB2B}>Demo B2B con facturas DIAN</button>
        </div>
      </div>

      <div className="rejilla-2">
        <ZonaArchivo titulo="Banco" ayuda="Extracto o recaudo: CSV, TXT, Excel (.xlsx, .xls), MT940 (.sta, .940) o camt.053 (.xml)" lado="banco" lectura={lecturas.banco} plantillas={plantillas} onCarga={props.onCarga} avisar={props.avisar} />
        <ZonaArchivo titulo="Ventas" ayuda="Pasarela, ERP (CSV o Excel) o facturas electrónicas DIAN (varios .xml a la vez)" lado="ventas" lectura={lecturas.ventas} plantillas={plantillas} onCarga={props.onCarga} avisar={props.avisar} />
      </div>

      <div className="barra-accion">
        <p className="suave">
          Perfil activo: <strong>{perfil.nombre}</strong> · tolerancia {porcentaje(perfil.toleranciaFaltantePorcentaje, 1)} · ventana {perfil.ventanaDias} días.{' '}
          <button type="button" className="enlace" onClick={props.onIrPerfil}>Cambiar perfil</button>
        </p>
        <button type="button" className="boton" disabled={!listas} onClick={props.onConciliar}>
          {hayResultado ? 'Conciliar de nuevo' : 'Conciliar'}
        </button>
      </div>
      {hayResultado && <p className="suave nota">Volver a conciliar reemplaza las decisiones de revisión actuales.</p>}
    </section>
  );
}

interface ZonaProps {
  titulo: string;
  ayuda: string;
  lado: Lado;
  lectura: Lectura | null;
  plantillas: Plantilla[];
  onCarga: (lado: Lado, carga: Carga | null) => void;
  avisar: Avisar;
}

const MAX_ERRORES = 30;

const ACEPTA = {
  banco: '.csv,.txt,.tsv,.xlsx,.xls,.sta,.940,.mt940,.xml,text/csv,text/plain,application/xml,text/xml',
  ventas: '.csv,.txt,.tsv,.xlsx,.xls,.xml,text/csv,text/plain,application/xml,text/xml',
};

const esExcel = (nombre: string) => /\.(xlsx|xls)$/i.test(nombre);
// Una factura UBL (o el AttachedDocument con que se envía) se reconoce por su raíz y el namespace de OASIS.
const esFacturaUBL = (texto: string) =>
  /urn:oasis:names:specification:ubl/.test(texto) && /<(?:[\w-]+:)?(Invoice|CreditNote|DebitNote|AttachedDocument)[\s>]/.test(texto);

// SheetJS pesa cientos de KB: se carga solo cuando alguien suelta un Excel.
async function convertirExcel(bytes: Uint8Array, hoja?: string): Promise<{ hojas: string[]; texto: string }> {
  const { leerExcel } = await import('@conciliador/excel');
  return leerExcel(bytes, hoja ? { hoja } : {});
}

function ZonaArchivo({ titulo, ayuda, lado, lectura, plantillas, onCarga, avisar }: ZonaProps) {
  const [encima, setEncima] = useState(false);
  const idInput = useId();
  const idSelector = useId();
  const idHoja = useId();

  const tomarArchivos = async (lista: FileList | null | undefined) => {
    const archivos = lista ? [...lista] : [];
    const archivo = archivos[0];
    if (!archivo) return;
    try {
      // Facturas DIAN: todos los XML soltados juntos forman el lado ventas.
      if (lado === 'ventas') {
        const xmls = archivos.filter((a) => /\.xml$/i.test(a.name));
        if (xmls.length > 0) {
          const facturas = await Promise.all(xmls.map(async (a) => ({ nombre: a.name, texto: decodificar(await leerBytes(a)) })));
          if (facturas.some((f) => esFacturaUBL(f.texto))) {
            const nombre = facturas.length === 1 ? facturas[0].nombre : `${facturas.length} facturas DIAN (XML)`;
            onCarga(lado, { nombre, facturas, plantillaElegida: null });
            avisar(`Facturas electrónicas cargadas: ${facturas.length} documento${facturas.length === 1 ? '' : 's'}.`);
            return;
          }
        }
      }
      if (archivos.length > 1) avisar('Solo se usa el primer archivo; varios a la vez solo aplica a facturas DIAN (.xml).');
      const bytes = await leerBytes(archivo);
      if (esExcel(archivo.name)) {
        const { hojas, texto } = await convertirExcel(bytes);
        onCarga(lado, { nombre: archivo.name, bytes, textoFijo: texto, excel: { hojas, hoja: hojas[0] }, plantillaElegida: null });
        avisar(`Excel de ${titulo.toLowerCase()} cargado: ${archivo.name} (${hojas.length} hoja${hojas.length === 1 ? '' : 's'}).`);
        return;
      }
      onCarga(lado, { nombre: archivo.name, bytes, plantillaElegida: null });
      avisar(`Archivo de ${titulo.toLowerCase()} cargado: ${archivo.name}.`);
    } catch (e) {
      avisar(`No se pudo leer ${archivo.name}: ${(e as Error).message}`, 'error');
    }
  };

  const cambiarHoja = async (hoja: string) => {
    const carga = lectura?.carga;
    if (!carga?.excel || !carga.bytes) return;
    try {
      const { hojas, texto } = await convertirExcel(carga.bytes, hoja);
      onCarga(lado, { ...carga, textoFijo: texto, excel: { hojas, hoja }, plantillaElegida: null });
    } catch (e) {
      avisar(`No se pudo leer la hoja «${hoja}»: ${(e as Error).message}`, 'error');
    }
  };

  const alSoltar = (e: DragEvent) => {
    e.preventDefault();
    setEncima(false);
    void tomarArchivos(e.dataTransfer.files);
  };

  const movimientos = lectura?.ingesta.movimientos ?? [];
  const errores = lectura?.ingesta.errores ?? [];
  const total = movimientos.reduce((s, m) => s + m.montoCentavos, 0);
  const delLado = plantillas.filter((p) => p.lado === lado);
  const confianzaElegida = lectura?.candidatas.find((c) => c.plantilla.id === lectura.plantilla?.id)?.confianza;

  return (
    <article className="tarjeta zona">
      <h3>{titulo}</h3>
      <div
        className={`soltar ${encima ? 'soltar--encima' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={alSoltar}
      >
        <p>{lectura ? <strong>{lectura.carga.nombre}</strong> : lado === 'ventas' ? 'Arrastra aquí el archivo o las facturas' : 'Arrastra aquí el archivo'}</p>
        <p className="suave">{ayuda}</p>
        <label htmlFor={idInput} className="boton boton--secundario">
          {lectura ? 'Cambiar archivo' : 'Elegir archivo'}
        </label>
        <input
          id={idInput}
          className="sr-only"
          type="file"
          accept={ACEPTA[lado]}
          multiple={lado === 'ventas'}
          onChange={(e) => { void tomarArchivos(e.target.files); e.target.value = ''; }}
        />
        {lectura && (
          <button type="button" className="enlace" onClick={() => onCarga(lado, null)}>Quitar archivo</button>
        )}
      </div>

      {lectura && (
        <div className="lectura">
          {lectura.formato === 'dian' ? (
            <p className="suave">
              <span className="insignia insignia--confirmada">DIAN</span>{' '}
              Facturas electrónicas UBL 2.1: total a pagar como monto, número de factura como referencia y CUFE como documento.
            </p>
          ) : (<>
          {lectura.carga.excel && (
            <div className="campo">
              <label htmlFor={idHoja}>Hoja del Excel</label>
              <select id={idHoja} value={lectura.carga.excel.hoja} onChange={(e) => void cambiarHoja(e.target.value)}>
                {lectura.carga.excel.hojas.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          )}
          <div className="campo">
            <label htmlFor={idSelector}>Plantilla</label>
            <select
              id={idSelector}
              value={lectura.plantilla?.id ?? ''}
              onChange={(e) => onCarga(lado, { ...lectura.carga, plantillaElegida: e.target.value || null })}
            >
              {!lectura.plantilla && <option value="">Sin plantilla</option>}
              {delLado.map((p) => {
                const c = lectura.candidatas.find((x) => x.plantilla.id === p.id);
                return <option key={p.id} value={p.id}>{p.nombre}{c ? ` (${porcentaje(c.confianza)})` : ''}</option>;
              })}
            </select>
          </div>
          {lectura.plantilla ? (
            <p className="suave">
              {lectura.carga.plantillaElegida && lectura.carga.plantillaElegida !== lectura.candidatas[0]?.plantilla.id
                ? 'Plantilla elegida a mano'
                : 'Plantilla detectada'}
              {confianzaElegida !== undefined ? <> con confianza <strong>{porcentaje(confianzaElegida)}</strong></> : ' (sin coincidencia de encabezados)'}
              {lectura.plantilla.codificacion ? ` · codificación ${lectura.plantilla.codificacion}` : ''}.
            </p>
          ) : null}
          {lectura.otroLado && (
            <p className="alerta">Este archivo parece de {lectura.otroLado.lado === 'banco' ? 'banco' : 'ventas'} ({lectura.otroLado.nombre}). ¿Lo pusiste en la zona correcta?</p>
          )}
          </>)}

          <dl className="cifras">
            <div><dt>Movimientos</dt><dd>{movimientos.length}</dd></div>
            <div><dt>Total</dt><dd>{formatearCOP(total)}</dd></div>
            <div><dt>Errores</dt><dd className={errores.length ? 'texto-error' : ''}>{errores.length}</dd></div>
          </dl>

          {movimientos.length > 0 && (
            <details>
              <summary>Ver los primeros movimientos</summary>
              <div className="tabla-envoltura">
                <table className="tabla tabla--compacta">
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Referencia</th><th scope="col" className="num">Monto</th></tr></thead>
                  <tbody>
                    {movimientos.slice(0, 8).map((m) => (
                      <tr key={m.id}><td>{m.fecha}</td><td className="ref">{m.referencia || '—'}</td><td className="num">{formatearCOP(m.montoCentavos)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {errores.length > 0 && (
            <details open={movimientos.length === 0}>
              <summary>Errores de lectura ({errores.length})</summary>
              <ul className="errores">
                {errores.slice(0, MAX_ERRORES).map((er, i) => (
                  <li key={i}>{er.linea > 0 ? <strong>Línea {er.linea}: </strong> : null}{er.mensaje}</li>
                ))}
                {errores.length > MAX_ERRORES && <li>… y {errores.length - MAX_ERRORES} más.</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
