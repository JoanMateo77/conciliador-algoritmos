// Parser XML mínimo y propio (el núcleo no tiene dependencias). Uno solo para todo el
// proyecto: lo usan el lector camt.053 y @conciliador/dian, así la lógica de entidades,
// CDATA y comentarios, y la política de seguridad, no se separan con el tiempo.
// Soporta namespaces (se compara por URI, no por prefijo), entidades predefinidas y numéricas,
// CDATA, comentarios e instrucciones de proceso. Rechaza DOCTYPE: ni camt.053 ni UBL lo usan,
// y rechazarlo evita ataques de expansión de entidades. Un solo recorrido del texto: O(largo).
import { ErrorDeDato } from '../modelo.ts';
import { Pila } from '../estructuras/Pila.ts';

export interface AtributoXML {
  nombre: string;   // tal cual aparece, con prefijo
  prefijo: string;
  local: string;
  uri: string;      // '' si no tiene prefijo (los atributos no heredan el namespace por defecto)
  valor: string;
}

export interface ElementoXML {
  nombre: string;
  prefijo: string;
  local: string;
  uri: string;
  atributos: AtributoXML[];
  hijos: ElementoXML[];
  texto: string;    // texto directo concatenado (incluye CDATA), sin recortar
  linea: number;
  columna: number;
}

// ErrorDeDato: para quien lee archivos es un dato malo, no un fallo del programa.
export class ErrorXML extends ErrorDeDato {
  linea: number;
  columna: number;
  constructor(mensaje: string, linea: number, columna: number) {
    super(`${mensaje} (línea ${linea}, columna ${columna})`);
    this.name = 'ErrorXML';
    this.linea = linea;
    this.columna = columna;
  }
}

const NS_XML = 'http://www.w3.org/XML/1998/namespace';
const NS_XMLNS = 'http://www.w3.org/2000/xmlns/';
const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const NOMBRE = /[A-Za-z_À-￿][\w.\-:·À-￿]*/y;

interface Abierto { elemento: ElementoXML; espacios: Map<string, string> }

export function analizarXML(texto: string): ElementoXML {
  // Inicio de cada línea, para traducir posiciones a línea/columna con búsqueda binaria.
  const iniciosLinea = [0];
  for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) === 10) iniciosLinea.push(i + 1);
  const ubicar = (pos: number) => {
    let bajo = 0, alto = iniciosLinea.length - 1;
    while (bajo < alto) {
      const medio = (bajo + alto + 1) >> 1;
      if (iniciosLinea[medio] <= pos) bajo = medio; else alto = medio - 1;
    }
    return { linea: bajo + 1, columna: pos - iniciosLinea[bajo] + 1 };
  };
  const fallar = (mensaje: string, pos: number): never => {
    const { linea, columna } = ubicar(pos);
    throw new ErrorXML(mensaje, linea, columna);
  };

  const decodificar = (crudo: string, inicio: number): string => {
    if (!crudo.includes('&')) return crudo;
    return crudo.replace(/&([^;&\s<]*);?/g, (todo, nombre: string, desplazamiento: number) => {
      const pos = inicio + desplazamiento;
      if (!todo.endsWith(';')) fallar(`"&" sin cerrar con ";" (usa &amp; para escribir &)`, pos);
      if (nombre.startsWith('#')) {
        const hex = nombre[1] === 'x';
        const digitos = nombre.slice(hex ? 2 : 1);
        const valido = hex ? /^[0-9a-fA-F]+$/.test(digitos) : /^\d+$/.test(digitos);
        const codigo = valido ? parseInt(digitos, hex ? 16 : 10) : NaN;
        if (!Number.isInteger(codigo) || codigo > 0x10ffff || codigo === 0) fallar(`Referencia de carácter inválida "&${nombre};"`, pos);
        return String.fromCodePoint(codigo);
      }
      if (!(nombre in ENTIDADES)) fallar(`Entidad desconocida "&${nombre};"`, pos);
      return ENTIDADES[nombre];
    });
  };

  // Resuelve el prefijo contra los namespaces visibles (el más interno gana).
  const resolver = (prefijo: string, espacios: Map<string, string>, pos: number, esAtributo: boolean): string => {
    if (prefijo === 'xml') return NS_XML;
    if (prefijo === 'xmlns') return NS_XMLNS;
    if (prefijo === '' && esAtributo) return '';
    const uri = espacios.get(prefijo);
    if (uri === undefined) {
      if (prefijo === '') return '';
      fallar(`Prefijo de namespace no declarado "${prefijo}"`, pos);
    }
    return uri as string;
  };

  const abiertos = new Pila<Abierto>();
  let raiz: ElementoXML | null = null;
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0; // BOM

  const leerNombre = (): string => {
    NOMBRE.lastIndex = i;
    const m = NOMBRE.exec(texto);
    if (!m) fallar('Se esperaba un nombre de etiqueta o atributo', i);
    i += (m as RegExpExecArray)[0].length;
    return (m as RegExpExecArray)[0];
  };
  const saltarEspacios = () => { while (i < texto.length && /\s/.test(texto[i])) i++; };
  const partir = (nombre: string) => {
    const dos = nombre.indexOf(':');
    return dos < 0 ? { prefijo: '', local: nombre } : { prefijo: nombre.slice(0, dos), local: nombre.slice(dos + 1) };
  };

  while (i < texto.length) {
    const lt = texto.indexOf('<', i);
    const fin = lt < 0 ? texto.length : lt;
    if (fin > i) {
      const crudo = texto.slice(i, fin);
      if (abiertos.estaVacia()) {
        if (crudo.trim() !== '') fallar('Texto fuera del elemento raíz', i + crudo.search(/\S/));
      } else {
        if (crudo.includes(']]>')) fallar('"]]>" no puede aparecer en el texto', i + crudo.indexOf(']]>'));
        (abiertos.cima() as Abierto).elemento.texto += decodificar(crudo, i);
      }
    }
    if (lt < 0) break;
    i = lt;

    if (texto.startsWith('<!--', i)) {
      const cierre = texto.indexOf('-->', i + 4);
      if (cierre < 0) fallar('Comentario sin cerrar', i);
      i = cierre + 3;
    } else if (texto.startsWith('<![CDATA[', i)) {
      const cierre = texto.indexOf(']]>', i + 9);
      if (cierre < 0) fallar('Sección CDATA sin cerrar', i);
      if (abiertos.estaVacia()) fallar('CDATA fuera del elemento raíz', i);
      (abiertos.cima() as Abierto).elemento.texto += texto.slice(i + 9, cierre);
      i = cierre + 3;
    } else if (texto.startsWith('<?', i)) {
      const cierre = texto.indexOf('?>', i + 2);
      if (cierre < 0) fallar('Instrucción de proceso sin cerrar', i);
      i = cierre + 2;
    } else if (texto.startsWith('<!', i)) {
      fallar('DOCTYPE y declaraciones <! no están soportados', i);
    } else if (texto[i + 1] === '/') {
      const inicio = i;
      i += 2;
      const nombre = leerNombre();
      saltarEspacios();
      if (texto[i] !== '>') fallar(`Etiqueta de cierre </${nombre}> mal formada`, i);
      i++;
      const abierto = abiertos.desapilar();
      if (!abierto) fallar(`Etiqueta de cierre </${nombre}> sin apertura`, inicio);
      if ((abierto as Abierto).elemento.nombre !== nombre) {
        fallar(`Se esperaba </${(abierto as Abierto).elemento.nombre}> y llegó </${nombre}>`, inicio);
      }
    } else {
      const inicio = i;
      if (raiz && abiertos.estaVacia()) fallar('Solo puede haber un elemento raíz', inicio);
      i++;
      const nombre = leerNombre();
      const crudos: { nombre: string; valor: string; pos: number }[] = [];
      let autocierre = false;
      for (;;) {
        const antes = i;
        saltarEspacios();
        if (i >= texto.length) fallar(`Etiqueta <${nombre}> sin cerrar`, inicio);
        if (texto.startsWith('/>', i)) { autocierre = true; i += 2; break; }
        if (texto[i] === '>') { i++; break; }
        if (i === antes) fallar(`Falta un espacio entre atributos en <${nombre}>`, i);
        const pos = i;
        const nombreAtr = leerNombre();
        saltarEspacios();
        if (texto[i] !== '=') fallar(`Al atributo "${nombreAtr}" le falta "="`, i);
        i++;
        saltarEspacios();
        const comilla = texto[i];
        if (comilla !== '"' && comilla !== "'") fallar(`El valor del atributo "${nombreAtr}" debe ir entre comillas`, i);
        const cierre = texto.indexOf(comilla, i + 1);
        if (cierre < 0) fallar(`Valor del atributo "${nombreAtr}" sin cerrar`, i);
        const crudo = texto.slice(i + 1, cierre);
        if (crudo.includes('<')) fallar(`"<" no puede ir dentro del atributo "${nombreAtr}"`, i + 1 + crudo.indexOf('<'));
        if (crudos.some((a) => a.nombre === nombreAtr)) fallar(`Atributo repetido "${nombreAtr}"`, pos);
        // Los saltos de línea y tabulaciones en atributos se normalizan a espacio (regla XML).
        crudos.push({ nombre: nombreAtr, valor: decodificar(crudo, i + 1).replace(/[\t\r\n]/g, ' '), pos });
        i = cierre + 1;
      }

      // Primero los xmlns del propio elemento: valen para él y sus atributos.
      const padre = abiertos.cima();
      const espacios = new Map(padre ? padre.espacios : []);
      for (const a of crudos) {
        if (a.nombre === 'xmlns') espacios.set('', a.valor);
        else if (a.nombre.startsWith('xmlns:')) {
          if (a.valor === '') fallar(`El prefijo "${a.nombre.slice(6)}" no puede declararse vacío`, a.pos);
          espacios.set(a.nombre.slice(6), a.valor);
        }
      }
      const { prefijo, local } = partir(nombre);
      const { linea, columna } = ubicar(inicio);
      const elemento: ElementoXML = {
        nombre, prefijo, local,
        uri: resolver(prefijo, espacios, inicio, false),
        atributos: crudos.map((a) => {
          const p = partir(a.nombre);
          return { nombre: a.nombre, prefijo: p.prefijo, local: p.local, uri: resolver(p.prefijo, espacios, a.pos, true), valor: a.valor };
        }),
        hijos: [], texto: '', linea, columna,
      };
      if (padre) padre.elemento.hijos.push(elemento);
      else raiz = elemento;
      if (!autocierre) abiertos.apilar({ elemento, espacios });
    }
  }

  if (!abiertos.estaVacia()) {
    const e = (abiertos.cima() as Abierto).elemento;
    throw new ErrorXML(`Etiqueta <${e.nombre}> sin cerrar al final del documento`, e.linea, e.columna);
  }
  if (!raiz) fallar('El documento no tiene elemento raíz', texto.length);
  return raiz as ElementoXML;
}

// --- Navegación por URI + nombre local: no importa qué prefijo use cada emisor (DIAN) ---

export function hijosXML(e: ElementoXML | undefined, uri: string, local: string): ElementoXML[] {
  return e ? e.hijos.filter((h) => h.uri === uri && h.local === local) : [];
}

export function hijoXML(e: ElementoXML | undefined, uri: string, local: string): ElementoXML | undefined {
  return e?.hijos.find((h) => h.uri === uri && h.local === local);
}

// Sigue una ruta de hijos directos: [[uri, local], [uri, local], ...]. Toma el primero en cada paso.
export function rutaXML(e: ElementoXML | undefined, pasos: [string, string][]): ElementoXML | undefined {
  let actual = e;
  for (const [uri, local] of pasos) actual = hijoXML(actual, uri, local);
  return actual;
}

// Todos los descendientes (en profundidad, en orden de documento) con ese nombre.
export function descendientesXML(e: ElementoXML | undefined, uri: string, local: string): ElementoXML[] {
  const salida: ElementoXML[] = [];
  if (!e) return salida;
  const pendientes = new Pila<ElementoXML>();
  for (let k = e.hijos.length - 1; k >= 0; k--) pendientes.apilar(e.hijos[k]);
  while (!pendientes.estaVacia()) {
    const x = pendientes.desapilar() as ElementoXML;
    if (x.uri === uri && x.local === local) salida.push(x);
    for (let k = x.hijos.length - 1; k >= 0; k--) pendientes.apilar(x.hijos[k]);
  }
  return salida;
}

export function atributoXML(e: ElementoXML | undefined, local: string, uri = ''): string | undefined {
  return e?.atributos.find((a) => a.local === local && a.uri === uri)?.valor;
}

export function textoXML(e: ElementoXML | undefined): string {
  return e ? e.texto.trim() : '';
}

// --- Navegación por nombre local solo (camt.053: un único vocabulario, versiones de URI distintas) ---

// Primer descendiente por ruta de nombres locales ("NtryDtls/TxDtls/Refs").
export function buscar(nodo: ElementoXML | undefined, ruta: string): ElementoXML | undefined {
  let actual = nodo;
  for (const parte of ruta.split('/')) {
    if (!actual) return undefined;
    actual = actual.hijos.find((h) => h.local === parte);
  }
  return actual;
}

// Todos los nodos que cumplen la ruta (en cada nivel se recorren todos los hijos con ese nombre).
export function buscarTodos(nodo: ElementoXML | undefined, ruta: string): ElementoXML[] {
  let actuales = nodo ? [nodo] : [];
  for (const parte of ruta.split('/')) actuales = actuales.flatMap((n) => n.hijos.filter((h) => h.local === parte));
  return actuales;
}

// Texto recortado del nodo en la ruta, '' si no existe.
export function textoEn(nodo: ElementoXML | undefined, ruta: string): string {
  return buscar(nodo, ruta)?.texto.trim() ?? '';
}
