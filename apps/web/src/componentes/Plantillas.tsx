import { useId } from 'react';
import { validarPlantilla } from '@conciliador/core';
import type { Plantilla } from '@conciliador/core';
import { decodificar, descargarJSON, leerBytes } from '../archivos.ts';
import type { Avisar } from '../tipos.ts';
import { AsistentePlantilla } from './AsistentePlantilla.tsx';

const NOMBRE_TIPO_PLANTILLA: Record<string, string> = {
  delimitado: 'delimitado (CSV o Excel)', anchoFijo: 'ancho fijo', mt940: 'MT940 (SWIFT)', camt053: 'camt.053 (ISO 20022, XML)',
};

interface Props {
  plantillas: Plantilla[];
  propias: Plantilla[];
  idsIncluidas: string[];
  onGuardarPropias: (lista: Plantilla[]) => void;
  avisar: Avisar;
}

export function Plantillas({ plantillas, propias, idsIncluidas, onGuardarPropias, avisar }: Props) {
  const idImportar = useId();
  const esPropia = (id: string) => propias.some((p) => p.id === id);

  const agregar = (p: Plantilla) => {
    onGuardarPropias([...propias.filter((x) => x.id !== p.id), p]);
    avisar(`Plantilla «${p.nombre}» guardada. Ya se usa para detectar archivos.`);
  };

  const importar = async (archivo: File | undefined) => {
    if (!archivo) return;
    try {
      const datos: unknown = JSON.parse(decodificar(await leerBytes(archivo)));
      const v = validarPlantilla(datos);
      if (!v.ok) { avisar(`La plantilla no es válida: ${v.errores.join(' ')}`, 'error'); return; }
      if (idsIncluidas.includes(v.plantilla.id)) { avisar(`Ya existe una plantilla incluida con id «${v.plantilla.id}». Cámbiale el id.`, 'error'); return; }
      agregar(v.plantilla);
    } catch (e) {
      avisar(`No se pudo importar: ${(e as Error).message}`, 'error');
    }
  };

  const eliminar = (p: Plantilla) => {
    if (!window.confirm(`¿Eliminar la plantilla «${p.nombre}» de este navegador?`)) return;
    onGuardarPropias(propias.filter((x) => x.id !== p.id));
    avisar(`Plantilla «${p.nombre}» eliminada.`);
  };

  return (
    <section aria-labelledby="titulo-plantillas">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-plantillas">Plantillas</h2>
          <p className="suave">Una plantilla describe un formato de archivo en JSON. Agregar un banco nuevo es agregar una plantilla, sin programar.</p>
        </div>
        <div className="acciones">
          <label htmlFor={idImportar} className="boton boton--secundario">Importar JSON</label>
          <input id={idImportar} type="file" className="sr-only" accept=".json,application/json"
            onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>

      <ul className="lista-plantillas">
        {plantillas.map((p) => (
          <li key={p.id} className="tarjeta plantilla">
            <div className="plantilla__cabeza">
              <h3>{p.nombre}</h3>
              <span className={`insignia ${esPropia(p.id) ? 'insignia--confirmada' : 'insignia--neutra'}`}>{esPropia(p.id) ? 'Creada por ti' : 'Incluida'}</span>
            </div>
            <p className="suave">
              {p.lado === 'banco' ? 'Banco' : 'Ventas'} · {NOMBRE_TIPO_PLANTILLA[p.tipo] ?? p.tipo}{p.formatoFecha ? ` · fechas ${p.formatoFecha}` : ''} · versión {p.version}
            </p>
            {p.descripcion && <p>{p.descripcion}</p>}
            {p.fuente && <p className="ayuda">Fuente: {p.fuente}</p>}
            <div className="acciones">
              <button type="button" className="boton boton--secundario boton--pequeno" onClick={() => descargarJSON(`${p.id}.json`, p)}>
                Exportar JSON <span className="sr-only">de {p.nombre}</span>
              </button>
              {esPropia(p.id) && (
                <button type="button" className="boton boton--peligro boton--pequeno" onClick={() => eliminar(p)}>
                  Eliminar <span className="sr-only">{p.nombre}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <AsistentePlantilla idsOcupados={idsIncluidas} idsPropios={propias.map((p) => p.id)} onGuardar={agregar} avisar={avisar} />
    </section>
  );
}
