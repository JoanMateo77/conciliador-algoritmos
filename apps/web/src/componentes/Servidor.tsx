// Modo servidor (fases 12 y 13): sesión con la API multiempresa, plantillas y perfiles de la
// empresa con su historial de versiones, y conciliación asíncrona por la cola de trabajos.
// Solo aparece si el panel se compiló con VITE_API_URL.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Perfil, Plantilla } from '@conciliador/core';
import { ErrorApi, pedirApi } from '../api.ts';
import type { EstadoTrabajo, VersionGuardada } from '../api.ts';
import type { Avisar, Lectura, SesionServidor } from '../tipos.ts';

interface Props {
  apiUrl: string;
  sesion: SesionServidor | null;
  onSesion: (s: SesionServidor | null) => void;
  lecturas: { banco: Lectura | null; ventas: Lectura | null };
  perfil: Perfil;
  propias: Plantilla[];
  avisar: Avisar;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function Servidor(props: Props) {
  const { apiUrl, sesion, onSesion, avisar } = props;

  // Si la API rechaza el token (vencido o usuario desactivado) se cierra la sesión local.
  const alError = (e: unknown, que: string) => {
    if (e instanceof ErrorApi && e.estado === 401 && sesion) {
      onSesion(null);
      avisar('La sesión venció o fue revocada. Vuelve a ingresar.', 'error');
      return;
    }
    avisar(`${que}: ${mensaje(e)}`, 'error');
  };

  return (
    <section aria-labelledby="titulo-servidor">
      <div className="encabezado-seccion">
        <div>
          <h2 id="titulo-servidor">Servidor</h2>
          <p className="suave">
            Conectado a <code>{apiUrl}</code>. Lo que hagas aquí sí sale del navegador. La sesión se guarda solo en memoria:
            al recargar la página hay que ingresar de nuevo.
          </p>
        </div>
        {sesion && (
          <div className="acciones">
            <p className="suave sesion-activa">
              <strong>{sesion.usuario.nombre}</strong> · {sesion.usuario.rol}{sesion.empresaNombre ? ` · ${sesion.empresaNombre}` : ''}
            </p>
            <button type="button" className="boton boton--secundario" onClick={() => { onSesion(null); avisar('Sesión cerrada.'); }}>
              Cerrar sesión
            </button>
          </div>
        )}
      </div>

      {sesion ? (
        <div className="rejilla-2">
          <Versionados tipo="plantillas" {...props} sesion={sesion} alError={alError} />
          <Versionados tipo="perfiles" {...props} sesion={sesion} alError={alError} />
        </div>
      ) : (
        <Acceso apiUrl={apiUrl} onSesion={onSesion} avisar={avisar} />
      )}

      <Asincrona {...props} alError={alError} />
    </section>
  );
}

function Acceso({ apiUrl, onSesion, avisar }: Pick<Props, 'apiUrl' | 'onSesion' | 'avisar'>) {
  const [modo, setModo] = useState<'ingreso' | 'registro'>('ingreso');
  const [datos, setDatos] = useState({ empresa: '', nombre: '', correo: '', contrasena: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = useId();

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      if (modo === 'ingreso') {
        const { datos: r } = await pedirApi<{ token: string; usuario: SesionServidor['usuario'] }>(apiUrl, '/auth/ingreso', {
          metodo: 'POST', cuerpo: { correo: datos.correo, contrasena: datos.contrasena },
        });
        onSesion({ token: r.token, usuario: r.usuario });
        avisar(`Bienvenido, ${r.usuario.nombre}.`);
      } else {
        const { datos: r } = await pedirApi<{ token: string; usuario: SesionServidor['usuario']; empresa: { nombre: string } }>(apiUrl, '/auth/registro', {
          metodo: 'POST', cuerpo: datos,
        });
        onSesion({ token: r.token, usuario: r.usuario, empresaNombre: r.empresa.nombre });
        avisar(`Empresa «${r.empresa.nombre}» registrada. Eres su administrador.`);
      }
      // La contraseña no se queda en el estado del formulario.
      setDatos((d) => ({ ...d, contrasena: '' }));
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setEnviando(false);
    }
  };

  const campo = (id: keyof typeof datos, etiqueta: string, tipo: string, autocompletar: string) => (
    <div className="campo">
      <label htmlFor={`${base}-${id}`}>{etiqueta}</label>
      <input id={`${base}-${id}`} type={tipo} required autoComplete={autocompletar} value={datos[id]}
        minLength={id === 'contrasena' && modo === 'registro' ? 8 : undefined}
        onChange={(e) => setDatos({ ...datos, [id]: e.target.value })} />
    </div>
  );

  return (
    <form className="tarjeta formulario acceso" onSubmit={(e) => void enviar(e)} aria-labelledby={`${base}-titulo`}>
      <h3 id={`${base}-titulo`}>{modo === 'ingreso' ? 'Iniciar sesión' : 'Registrar empresa'}</h3>
      <div className="segmentado" role="radiogroup" aria-label="Qué quieres hacer">
        <label><input type="radio" name={`${base}-modo`} checked={modo === 'ingreso'} onChange={() => setModo('ingreso')} /> Ya tengo cuenta</label>
        <label><input type="radio" name={`${base}-modo`} checked={modo === 'registro'} onChange={() => setModo('registro')} /> Empresa nueva</label>
      </div>
      {modo === 'registro' && campo('empresa', 'Nombre de la empresa', 'text', 'organization')}
      {modo === 'registro' && campo('nombre', 'Tu nombre', 'text', 'name')}
      {campo('correo', 'Correo', 'email', 'email')}
      {campo('contrasena', modo === 'registro' ? 'Contraseña (mínimo 8 caracteres)' : 'Contraseña', 'password', modo === 'registro' ? 'new-password' : 'current-password')}
      {error && <p className="errores" role="alert">{error}</p>}
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Enviando…' : modo === 'ingreso' ? 'Ingresar' : 'Registrar empresa'}
        </button>
      </div>
      <p className="ayuda">Sin sesión, las conciliaciones van al espacio público de demostración.</p>
    </form>
  );
}

function Versionados({ tipo, apiUrl, sesion, perfil, propias, avisar, alError }: Props & {
  tipo: 'plantillas' | 'perfiles'; sesion: SesionServidor; alError: (e: unknown, que: string) => void;
}) {
  const [lista, setLista] = useState<VersionGuardada[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [versiones, setVersiones] = useState<VersionGuardada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const titulo = tipo === 'plantillas' ? 'Plantillas de la empresa' : 'Perfiles de la empresa';
  const idTitulo = useId();

  const cargar = async () => {
    try {
      const { datos } = await pedirApi<VersionGuardada[]>(apiUrl, `/empresa/${tipo}?limite=100`, { token: sesion.token });
      setLista(datos);
    } catch (e) {
      alError(e, `No se pudieron leer las ${tipo}`);
    }
  };

  // Al iniciar sesión (o cambiar de usuario) se piden los datos de su empresa.
  useEffect(() => { void cargar(); }, [sesion.token]);

  const verVersiones = async (id: string) => {
    if (abierta === id) { setAbierta(null); return; }
    try {
      const { datos } = await pedirApi<VersionGuardada[]>(apiUrl, `/empresa/${tipo}/${encodeURIComponent(id)}/versiones?limite=50`, { token: sesion.token });
      setVersiones(datos);
      setAbierta(id);
    } catch (e) {
      alError(e, 'No se pudo leer el historial');
    }
  };

  // Cada guardado crea una versión nueva: el servidor nunca sobrescribe.
  const subir = async () => {
    const elementos: unknown[] = tipo === 'perfiles' ? [perfil] : propias;
    if (elementos.length === 0) return;
    setOcupado(true);
    try {
      for (const e of elementos) await pedirApi(apiUrl, `/empresa/${tipo}`, { metodo: 'POST', cuerpo: e, token: sesion.token });
      avisar(tipo === 'perfiles' ? `Perfil «${perfil.nombre}» guardado como versión nueva.` : `${elementos.length} plantilla(s) guardadas como versión nueva.`);
      await cargar();
    } catch (e) {
      alError(e, 'No se pudo guardar');
    } finally {
      setOcupado(false);
    }
  };

  const puedeEscribir = sesion.usuario.rol !== 'lector';
  const nombreDe = (v: VersionGuardada) => (v.contenido as { nombre?: string } | null)?.nombre ?? v.id;

  return (
    <article className="tarjeta" aria-labelledby={idTitulo}>
      <h3 id={idTitulo}>{titulo}</h3>
      {lista === null ? <p className="suave">Cargando…</p> : lista.length === 0 ? (
        <p className="suave">{tipo === 'plantillas' ? 'La empresa usa solo las plantillas incluidas.' : 'La empresa aún no tiene perfiles guardados.'}</p>
      ) : (
        <ul className="versionados">
          {lista.map((v) => (
            <li key={v.id}>
              <div className="versionado__fila">
                <span><strong>{nombreDe(v)}</strong> <span className="ref">{v.id}</span></span>
                <span className="insignia insignia--neutra">v{v.version}</span>
              </div>
              <button type="button" className="enlace" aria-expanded={abierta === v.id} onClick={() => void verVersiones(v.id)}>
                {abierta === v.id ? 'Ocultar historial' : 'Ver historial'} <span className="sr-only">de {nombreDe(v)}</span>
              </button>
              {abierta === v.id && (
                <ol className="historial">
                  {versiones.map((h) => <li key={h.version}>Versión {h.version} · {fecha(h.fecha)}</li>)}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
      {puedeEscribir && (
        <div className="acciones">
          <button type="button" className="boton boton--secundario boton--pequeno" disabled={ocupado || (tipo === 'plantillas' && propias.length === 0)} onClick={() => void subir()}>
            {tipo === 'perfiles' ? 'Guardar el perfil activo' : `Subir mis plantillas (${propias.length})`}
          </button>
        </div>
      )}
    </article>
  );
}

const NOMBRE_ESTADO_TRABAJO: Record<EstadoTrabajo['estado'], string> = {
  pendiente: 'En cola', procesando: 'Procesando', hecho: 'Terminado', fallido: 'Falló',
};
const CLASE_ESTADO: Record<EstadoTrabajo['estado'], string> = {
  pendiente: 'neutra', procesando: 'sugerida', hecho: 'automatica', fallido: 'rechazada',
};

function Asincrona({ apiUrl, sesion, lecturas, perfil, avisar, alError }: Props & { alError: (e: unknown, que: string) => void }) {
  const [trabajo, setTrabajo] = useState<EstadoTrabajo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const temporizador = useRef<number | undefined>(undefined);
  const montado = useRef(true);
  const token = sesion?.token;

  // Se deja de consultar al salir de la pestaña (también si había una consulta en vuelo).
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; window.clearTimeout(temporizador.current); };
  }, []);

  const consultar = async (id: string) => {
    try {
      const { datos } = await pedirApi<EstadoTrabajo>(apiUrl, `/trabajos/${id}`, { token });
      if (!montado.current) return;
      setTrabajo(datos);
      if (datos.estado === 'pendiente' || datos.estado === 'procesando') {
        temporizador.current = window.setTimeout(() => void consultar(id), 1500);
      } else {
        avisar(datos.estado === 'hecho' ? 'El servidor terminó la conciliación.' : `El trabajo falló: ${datos.error?.mensaje ?? 'sin detalle'}`, datos.estado === 'hecho' ? 'info' : 'error');
      }
    } catch (e) {
      alError(e, 'No se pudo consultar el trabajo');
    }
  };

  const b = lecturas.banco;
  const v = lecturas.ventas;
  const bloqueo = !b || !v ? 'Primero carga los dos archivos en la pestaña Cargar.'
    : !b.plantilla || !v.plantilla ? (b.bloqueoServidor ?? v.bloqueoServidor ?? 'Los dos archivos necesitan una plantilla.')
      : b.bloqueoServidor ?? v.bloqueoServidor ?? null;

  const enviar = async () => {
    if (!b?.plantilla || !v?.plantilla) return;
    if (!window.confirm('Esto enviará los dos archivos y el perfil al servidor. ¿Continuar?')) return;
    window.clearTimeout(temporizador.current);
    setEnviando(true);
    try {
      const { datos } = await pedirApi<{ trabajoId: string; estado: string }>(apiUrl, '/conciliaciones?asincrono=1', {
        metodo: 'POST', token,
        cuerpo: {
          banco: { nombre: b.carga.nombre, texto: b.texto, plantillaId: b.plantilla.id },
          ventas: { nombre: v.carga.nombre, texto: v.texto, plantillaId: v.plantilla.id },
          perfil,
        },
      });
      avisar('Conciliación en cola. El estado se actualiza solo.');
      setTrabajo({ id: datos.trabajoId, estado: 'pendiente', intentos: 0, maxIntentos: 0, conciliacionId: null, error: null, creado: new Date().toISOString(), tomado: null, terminado: null });
      void consultar(datos.trabajoId);
    } catch (e) {
      alError(e, 'No se pudo encolar');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <article className="tarjeta" aria-labelledby="titulo-asincrona">
      <h3 id="titulo-asincrona">Conciliación en el servidor (asíncrona)</h3>
      <p className="suave">
        Para archivos grandes: el servidor la pone en una cola y un proceso aparte la resuelve sin bloquear la API.
        {sesion ? ' Se guarda en tu empresa.' : ' Sin sesión va al espacio de demostración.'}
      </p>
      <div className="barra-accion">
        <p className="suave">{b && v ? `${b.carga.nombre} + ${v.carga.nombre} · perfil «${perfil.nombre}»` : 'Sin archivos cargados.'}</p>
        <button type="button" className="boton" disabled={enviando || bloqueo !== null} aria-describedby={bloqueo ? 'motivo-asincrona' : undefined} onClick={() => void enviar()}>
          {enviando ? 'Enviando…' : 'Enviar a la cola'}
        </button>
      </div>
      {bloqueo && <p id="motivo-asincrona" className="ayuda">{bloqueo.startsWith('Primero') || bloqueo.startsWith('Los dos') ? bloqueo : `No se puede enviar: ${bloqueo}`}</p>}
      {trabajo && (
        <div aria-live="polite">
          <dl className="cifras">
            <div><dt>Trabajo</dt><dd className="ref">{trabajo.id.slice(0, 8)}</dd></div>
            <div><dt>Estado</dt><dd><span className={`insignia insignia--${CLASE_ESTADO[trabajo.estado]}`}>{NOMBRE_ESTADO_TRABAJO[trabajo.estado]}</span></dd></div>
            <div><dt>Intentos</dt><dd>{trabajo.intentos}{trabajo.maxIntentos ? ` de ${trabajo.maxIntentos}` : ''}</dd></div>
            <div><dt>Creado</dt><dd>{fecha(trabajo.creado)}</dd></div>
            {trabajo.terminado && <div><dt>Terminado</dt><dd>{fecha(trabajo.terminado)}</dd></div>}
          </dl>
          {trabajo.conciliacionId && <p className="ayuda">Conciliación guardada con id <code>{trabajo.conciliacionId}</code>.</p>}
          {trabajo.error && <p className="texto-error">{trabajo.error.mensaje}</p>}
        </div>
      )}
    </article>
  );
}
