import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PERFIL_POR_DEFECTO,
  REGLA_GMF,
  RegistroPlantillas,
  SesionRevision,
  TARIFAS_EJEMPLO,
  conciliar,
  leerArchivo,
  procesarArchivos,
  validarReglas,
  validarTarifas,
} from '@conciliador/core';
import type { Lado, Perfil, Plantilla, Regla, ResultadoIngesta } from '@conciliador/core';
import { MUESTRAS, PLANTILLAS } from '@conciliador/plantillas';
import { MUESTRAS_DIAN, PAGOS_B2B_MUESTRA, PLANTILLA_DIAN, leerFacturas } from '@conciliador/dian';
import { guardar, leerGuardado } from './almacen.ts';
import { decodificar } from './archivos.ts';
import type { Avisar, Carga, Lectura, Pestana, SesionServidor, Trabajo } from './tipos.ts';
import { Cargar } from './componentes/Cargar.tsx';
import { PerfilFormulario } from './componentes/PerfilFormulario.tsx';
import { DEMOS, PERFIL_B2B, perfilesGuardados } from './perfiles.ts';
import { Resultados } from './componentes/Resultados.tsx';
import { Grafo } from './componentes/Grafo.tsx';
import { Plantillas } from './componentes/Plantillas.tsx';
import { Servidor } from './componentes/Servidor.tsx';

const API_URL: string | undefined = import.meta.env?.VITE_API_URL || undefined;

const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: 'cargar', titulo: 'Cargar' },
  { id: 'perfil', titulo: 'Perfil' },
  { id: 'resultados', titulo: 'Resultados' },
  { id: 'grafo', titulo: 'Grafo' },
  { id: 'plantillas', titulo: 'Plantillas' },
  // El modo servidor solo existe si el panel se compiló con VITE_API_URL.
  ...(API_URL ? [{ id: 'servidor' as const, titulo: 'Servidor' }] : []),
];

// Ejemplo de regla de la fase 10: una consignación en efectivo no es el pago de una venta en línea.
const REGLA_EFECTIVO: Regla = {
  id: 'consignacion-efectivo',
  nombre: 'Consignaciones en efectivo como ingreso de caja',
  prioridad: 20,
  lado: 'banco',
  si: { todas: [{ campo: 'descripcion', op: 'contiene', valor: 'CONSIGNACION EFECTIVO' }] },
  accion: { tipo: 'clasificar', categoria: 'ingreso:efectivo' },
};

// El escenario necesita al menos 5 % de tolerancia (comisión + IVA + ReteFuente = 4,65 %).
function perfilDemo(): Perfil {
  const guardado = perfilesGuardados()['tienda-la-ceiba'];
  if (guardado) return guardado;
  return {
    ...PERFIL_POR_DEFECTO,
    id: 'tienda-la-ceiba',
    nombre: 'Tienda La Ceiba (demo)',
    toleranciaFaltantePorcentaje: Math.max(PERFIL_POR_DEFECTO.toleranciaFaltantePorcentaje, 0.05),
    ventanaDias: Math.min(Math.max(PERFIL_POR_DEFECTO.ventanaDias, 3), 6),
    diasDespues: Math.min(Math.max(PERFIL_POR_DEFECTO.diasDespues, 0), 1),
    maxGrupo: Math.max(PERFIL_POR_DEFECTO.maxGrupo, 4),
    retenciones: [{ nombre: 'ReteFuente', tasa: 0.015 }],
    // Fases 10 y 11: reglas que sacan del cruce lo que no es una venta, tarifas con vigencia y Húngaro.
    reglas: [REGLA_GMF, REGLA_EFECTIVO],
    tarifas: TARIFAS_EJEMPLO,
    municipio: 'Cali',
    cruceOptimo: true,
  };
}

function crearRegistro(propias: Plantilla[]): { registro: RegistroPlantillas; invalidas: string[] } {
  const registro = new RegistroPlantillas();
  const invalidas: string[] = [];
  for (const p of PLANTILLAS) registro.registrar(p);
  // Una plantilla guardada que ya no valida no debe tumbar el panel.
  for (const p of propias) {
    try { registro.registrar(p); } catch { invalidas.push(p?.nombre ?? p?.id ?? 'sin nombre'); }
  }
  return { registro, invalidas };
}

function ingestaFallida(nombre: string, mensaje: string): ResultadoIngesta {
  return { nombre, plantillaId: null, movimientos: [], errores: [{ linea: 0, mensaje }] };
}

// Excel llega convertido a CSV con ';' y números con ',' decimal (sin miles): se lee con una
// copia de la plantilla delimitada que usa esos separadores. Así sirve la misma plantilla del CSV.
function paraExcel(p: Plantilla): Plantilla {
  return { ...p, separador: ';', separadorDecimal: ',' };
}

function leerFacturasDian(carga: Carga): Lectura {
  const facturas = carga.facturas ?? [];
  const { movimientos, errores } = leerFacturas(facturas.map((f) => f.texto));
  const ingesta: ResultadoIngesta = {
    nombre: carga.nombre,
    plantillaId: PLANTILLA_DIAN,
    movimientos,
    // linea = posición del documento en el lote; el nombre ayuda a ubicar el XML con problemas.
    errores: errores.map((e) => ({ linea: 0, mensaje: `${facturas[e.indice]?.nombre ?? `Documento ${e.indice + 1}`}: ${e.mensaje}` })),
  };
  return {
    lado: 'ventas', carga, candidatas: [], otroLado: null, plantilla: null, texto: '', ingesta, formato: 'dian',
    bloqueoServidor: 'la API aún no recibe facturas DIAN (solo archivos con una plantilla).',
  };
}

function leerCarga(carga: Carga, lado: Lado, registro: RegistroPlantillas): Lectura {
  if (carga.facturas) return leerFacturasDian(carga);
  const formato = carga.excel ? 'excel' : 'texto';
  // Primero se decodifica de forma provisional para detectar; luego con la codificación de la plantilla.
  const provisional = carga.textoFijo ?? decodificar(carga.bytes ?? new Uint8Array(), 'utf-8');
  let todas: { plantilla: Plantilla; confianza: number }[] = [];
  try { todas = registro.detectar(provisional); } catch { todas = []; }
  // Un Excel solo puede usar plantillas delimitadas (es una tabla, no ancho fijo ni MT940).
  if (carga.excel) todas = todas.filter((d) => d.plantilla.tipo === 'delimitado');
  const candidatas = todas.filter((d) => d.plantilla.lado === lado && d.confianza > 0);
  const otroLado = candidatas.length === 0
    ? todas.find((d) => d.plantilla.lado !== lado && d.confianza > 0)?.plantilla ?? null
    : null;
  const elegidaId = carga.plantillaElegida ?? candidatas[0]?.plantilla.id ?? null;
  const plantilla = elegidaId ? registro.obtener(elegidaId) ?? null : null;
  const texto = carga.textoFijo ?? decodificar(carga.bytes ?? new Uint8Array(), plantilla?.codificacion ?? 'utf-8');

  let ingesta: ResultadoIngesta;
  let bloqueoServidor: string | undefined;
  if (!plantilla) {
    ingesta = ingestaFallida(carga.nombre, 'No se reconoció el formato. Elige una plantilla o crea una en la pestaña Plantillas.');
  } else if (carga.excel) {
    if (plantilla.tipo !== 'delimitado') {
      ingesta = ingestaFallida(carga.nombre, `Un Excel solo se puede leer con una plantilla delimitada; «${plantilla.nombre}» es de tipo ${plantilla.tipo}.`);
    } else {
      try {
        const r = leerArchivo(texto, paraExcel(plantilla));
        ingesta = { nombre: carga.nombre, plantillaId: plantilla.id, movimientos: r.movimientos, errores: r.errores };
      } catch (e) {
        ingesta = ingestaFallida(carga.nombre, `No se pudo leer el Excel: ${(e as Error).message}`);
      }
      // El servidor leería el CSV con los separadores originales de la plantilla.
      if ((plantilla.separador ?? ';') !== ';' || (plantilla.separadorDecimal ?? ',') !== ',') {
        bloqueoServidor = `el Excel se convirtió con ';' y ',' decimal, y la plantilla «${plantilla.nombre}» usa otros separadores.`;
      }
    }
  } else {
    try {
      // procesarArchivos usa una Cola; aquí llega un archivo por zona.
      ingesta = procesarArchivos([{ nombre: carga.nombre, texto, plantillaId: plantilla.id }], registro)[0]
        ?? ingestaFallida(carga.nombre, 'No se pudo leer el archivo.');
    } catch (e) {
      ingesta = ingestaFallida(carga.nombre, `No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }
  return { lado, carga, candidatas, otroLado, plantilla, texto, ingesta, formato, bloqueoServidor };
}

// Las reglas y tarifas mal escritas harían fallar el cruce: se revisan antes con el validador del núcleo.
function erroresDeReglas(perfil: Perfil): string[] {
  return [
    ...(perfil.reglas ? validarReglas(perfil.reglas) : []),
    ...(perfil.tarifas ? validarTarifas(perfil.tarifas) : []),
  ];
}

export function App() {
  const [pestana, setPestana] = useState<Pestana>('cargar');
  const [propias, setPropias] = useState<Plantilla[]>(() => leerGuardado<Plantilla[]>('plantillas', []));
  const { registro, invalidas } = useMemo(() => crearRegistro(propias), [propias]);
  const [cargas, setCargas] = useState<{ banco: Carga | null; ventas: Carga | null }>({ banco: null, ventas: null });
  const [perfil, setPerfil] = useState<Perfil>(() => {
    const activo = leerGuardado<string | null>('perfilActivo', null);
    return (activo && perfilesGuardados()[activo]) || PERFIL_POR_DEFECTO;
  });
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [, setVersion] = useState(0);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: 'info' | 'error' } | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  // Token de la API solo en memoria: no se escribe en localStorage para no dejarlo expuesto.
  const [sesionServidor, setSesionServidor] = useState<SesionServidor | null>(null);

  const avisar: Avisar = useCallback((texto, tipo = 'info') => {
    setAviso({ texto, tipo });
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAviso(null), 6000);
  }, []);

  // La sesión es mutable (pilas de deshacer); un contador fuerza el re-render tras cada cambio.
  const refrescar = useCallback(() => setVersion((v) => v + 1), []);

  const lecturas = useMemo(() => ({
    banco: cargas.banco ? leerCarga(cargas.banco, 'banco', registro) : null,
    ventas: cargas.ventas ? leerCarga(cargas.ventas, 'ventas', registro) : null,
  }), [cargas, registro]);

  const cambiarCarga = (lado: Lado, carga: Carga | null) => setCargas((c) => ({ ...c, [lado]: carga }));

  const cargarDemo = (demoId: string) => {
    const demo = DEMOS.find((d) => d.id === demoId) ?? DEMOS[0];
    const banco = MUESTRAS.find((m) => m.id === demo.banco);
    const ventas = MUESTRAS.find((m) => m.id === demo.ventas);
    if (!banco || !ventas) { avisar('No se encontraron las muestras de la demo.', 'error'); return; }
    setCargas({
      banco: { nombre: banco.archivo, textoFijo: banco.texto, plantillaElegida: banco.plantillaId },
      ventas: { nombre: ventas.archivo, textoFijo: ventas.texto, plantillaElegida: ventas.plantillaId },
    });
    setPerfil(perfilDemo());
    setTrabajo(null);
    avisar(`Demo cargada: ${demo.titulo}. Revisa la detección y pulsa «Conciliar».`);
  };

  const cargarDemoB2B = () => {
    const facturas = MUESTRAS_DIAN.filter((m) => m.tipo === 'xml').map((m) => ({ nombre: m.archivo, texto: m.texto }));
    setCargas({
      banco: { nombre: 'pagos-b2b.csv', textoFijo: PAGOS_B2B_MUESTRA, plantillaElegida: 'banco-csv-generico' },
      ventas: { nombre: `${facturas.length} facturas DIAN (XML)`, facturas, plantillaElegida: null },
    });
    setPerfil(perfilesGuardados()[PERFIL_B2B.id] ?? PERFIL_B2B);
    setTrabajo(null);
    avisar('Demo B2B cargada: pagos de clientes empresariales contra facturas electrónicas DIAN. Pulsa «Conciliar».');
  };

  const conciliarAhora = () => {
    const b = lecturas.banco;
    const v = lecturas.ventas;
    if (!b || !v || !b.ingesta.movimientos.length || !v.ingesta.movimientos.length) return;
    const errores = erroresDeReglas(perfil);
    if (errores.length > 0) {
      avisar(`Revisa las reglas o tarifas del perfil: ${errores.slice(0, 3).join(' · ')}`, 'error');
      setPestana('perfil');
      return;
    }
    try {
      const resultado = conciliar(b.ingesta.movimientos, v.ingesta.movimientos, perfil);
      setTrabajo({
        resultado,
        sesion: new SesionRevision(resultado),
        banco: b.ingesta.movimientos,
        ventas: v.ingesta.movimientos,
        perfil,
        archivos: {
          banco: { nombre: b.carga.nombre, texto: b.texto, plantillaId: b.plantilla?.id ?? b.ingesta.plantillaId ?? undefined },
          ventas: { nombre: v.carga.nombre, texto: v.texto, plantillaId: v.plantilla?.id ?? v.ingesta.plantillaId ?? undefined },
        },
        bloqueoServidor: b.bloqueoServidor ?? v.bloqueoServidor,
      });
      setSeleccionada(resultado.coincidencias[0]?.id ?? null);
      setPestana('resultados');
      const clasificados = resultado.clasificados?.length ?? 0;
      avisar(`Conciliación lista: ${resultado.resumen.automaticas} automáticas y ${resultado.resumen.sugeridas} sugeridas${clasificados ? `; ${clasificados} clasificados por reglas` : ''}.`);
    } catch (e) {
      avisar(`No se pudo conciliar: ${(e as Error).message}`, 'error');
    }
  };

  const deshacer = useCallback(() => {
    if (!trabajo) return;
    if (trabajo.sesion.deshacer()) { refrescar(); avisar('Se deshizo la última decisión.'); }
    else avisar('No hay nada que deshacer.');
  }, [trabajo, refrescar, avisar]);

  const rehacer = useCallback(() => {
    if (!trabajo) return;
    if (trabajo.sesion.rehacer()) { refrescar(); avisar('Se rehízo la decisión.'); }
    else avisar('No hay nada que rehacer.');
  }, [trabajo, refrescar, avisar]);

  // Ctrl+Z / Ctrl+Shift+Z (Cmd en Mac), salvo cuando se escribe en un campo:
  // ahí el atajo pertenece al campo de texto.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (!trabajo || !(e.ctrlKey || e.metaKey)) return;
      const objetivo = e.target as HTMLElement | null;
      if (objetivo && (objetivo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(objetivo.tagName))) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); }
      else if ((tecla === 'z' && e.shiftKey) || tecla === 'y') { e.preventDefault(); rehacer(); }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [trabajo, deshacer, rehacer]);

  const guardarPropias = (lista: Plantilla[]) => {
    setPropias(lista);
    if (!guardar('plantillas', lista)) avisar('No se pudo guardar en este navegador (almacenamiento bloqueado).', 'error');
  };

  const listas = Boolean(lecturas.banco?.ingesta.movimientos.length && lecturas.ventas?.ingesta.movimientos.length);

  return (
    <div className="app">
      <header className="cabecera">
        <div className="cabecera__marca">
          <span className="logo" aria-hidden="true">⇄</span>
          <div>
            <h1>Conciliador de pagos</h1>
            <p className="suave">Cruza el extracto del banco con tus ventas, con reglas a la medida de tu empresa.</p>
          </div>
        </div>
        <p className="privacidad">
          <span aria-hidden="true">🔒</span> Tus archivos no salen de tu computador<span className="privacidad__mas">: todo se procesa en este navegador</span>.
        </p>
      </header>

      <nav className="pestanas" aria-label="Pasos">
        {PESTANAS.map((p, i) => {
          // Los pasos que ya tienen lo necesario se marcan, así se ve de un vistazo qué falta.
          const hecho = (p.id === 'cargar' && listas) || ((p.id === 'resultados' || p.id === 'grafo') && Boolean(trabajo));
          return (
            <button
              key={p.id}
              type="button"
              className={`pestana ${hecho ? 'pestana--hecha' : ''}`}
              aria-current={pestana === p.id ? 'page' : undefined}
              onClick={() => setPestana(p.id)}
            >
              <span className="pestana__num" aria-hidden="true">{hecho ? '✓' : i + 1}</span>
              <span>{p.titulo}</span>
              {hecho && <span className="sr-only"> (listo)</span>}
            </button>
          );
        })}
      </nav>

      <p className={`aviso ${aviso ? 'aviso--visible' : ''} ${aviso?.tipo === 'error' ? 'aviso--error' : ''}`} role="status" aria-live="polite">
        {aviso?.texto ?? ''}
      </p>

      {invalidas.length > 0 && (
        <p className="alerta" role="alert">
          Algunas plantillas guardadas ya no son válidas y no se cargaron: {invalidas.join(', ')}.
        </p>
      )}

      <main className="contenido">
        {pestana === 'cargar' && (
          <Cargar
            lecturas={lecturas}
            plantillas={registro.listar()}
            perfil={perfil}
            listas={listas}
            hayResultado={Boolean(trabajo)}
            onCarga={cambiarCarga}
            onDemo={cargarDemo}
            onDemoB2B={cargarDemoB2B}
            onConciliar={conciliarAhora}
            onIrPerfil={() => setPestana('perfil')}
            avisar={avisar}
          />
        )}
        {pestana === 'perfil' && (
          <PerfilFormulario
            perfil={perfil}
            onCambiar={setPerfil}
            hayResultado={Boolean(trabajo)}
            listas={listas}
            onConciliar={conciliarAhora}
            avisar={avisar}
          />
        )}
        {pestana === 'resultados' && (
          <Resultados
            trabajo={trabajo}
            seleccionada={seleccionada}
            onSeleccionar={setSeleccionada}
            onCambio={refrescar}
            onDeshacer={deshacer}
            onRehacer={rehacer}
            onIrCargar={() => setPestana('cargar')}
            onIrGrafo={() => setPestana('grafo')}
            apiUrl={API_URL}
            token={sesionServidor?.token}
            avisar={avisar}
          />
        )}
        {pestana === 'grafo' && (
          <Grafo
            trabajo={trabajo}
            seleccionada={seleccionada}
            onSeleccionar={setSeleccionada}
            onIrCargar={() => setPestana('cargar')}
            onVerDetalle={() => setPestana('resultados')}
          />
        )}
        {pestana === 'plantillas' && (
          <Plantillas
            plantillas={registro.listar()}
            propias={propias}
            idsIncluidas={PLANTILLAS.map((p) => p.id)}
            onGuardarPropias={guardarPropias}
            avisar={avisar}
          />
        )}
        {pestana === 'servidor' && API_URL && (
          <Servidor
            apiUrl={API_URL}
            sesion={sesionServidor}
            onSesion={setSesionServidor}
            lecturas={lecturas}
            perfil={perfil}
            propias={propias}
            avisar={avisar}
          />
        )}
      </main>

      <footer className="pie suave">
        Proyecto académico de Algoritmos II. Los datos de demostración son sintéticos e inventados.
      </footer>
    </div>
  );
}
