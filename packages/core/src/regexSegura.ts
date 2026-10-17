// Regex que llegan de usuarios (reglas del perfil y plantillas): el motor de JavaScript
// hace retroceso, así que un patrón como ^(a+)+$ tarda tiempo exponencial y puede dejar
// colgado un servidor (ReDoS). Este revisor rechaza las formas que causan eso y acota el
// costo de las que quedan: patrón corto, sin cuantificadores anidados, sin alternancias
// repetidas, sin referencias hacia atrás y con un costo de retroceso estimado acotado.

export const LARGO_MAXIMO_PATRON = 200;
// El texto que se prueba contra una regex de usuario se recorta a este largo, así cada
// cuantificador como mucho ofrece LARGO_MAXIMO_TEXTO_REGEX + 1 formas de repartirse.
export const LARGO_MAXIMO_TEXTO_REGEX = 256;
// Costo = producto de las opciones de cada cuantificador ('*' cuenta 257, '?' 2, {0,20} 21).
// El tope equivale a dos '*' más dos '?': medido, el peor caso de una prueba queda por
// debajo de un segundo (a*a*! en 10 ms, a{0,20} cuatro veces en ~650 ms), mientras que
// tres '*' seguidos ya pasan del minuto. El total lo acota además crearProbador.
export const COSTO_MAXIMO_REGEX = (LARGO_MAXIMO_TEXTO_REGEX + 1) ** 2 * 4;

interface Grupo { cuantificado: boolean; alternancia: boolean }

// Lee un cuantificador que empiece en i: su largo, cuántas repeticiones distintas admite
// (acotado por el largo del texto) y si repite (máximo > 1).
function leerCuantificador(p: string, i: number): { largo: number; opciones: number; repite: boolean } | null {
  const c = p[i];
  const n = LARGO_MAXIMO_TEXTO_REGEX;
  if (c === '*') return { largo: 1, opciones: n + 1, repite: true };
  if (c === '+') return { largo: 1, opciones: n, repite: true };
  if (c === '?') return { largo: 1, opciones: 2, repite: false };
  if (c !== '{') return null;
  const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i, i + 24));
  if (!m) return null; // una llave suelta es un literal
  const min = Math.min(Number(m[1]), n);
  const max = m[2] === undefined ? min : m[3] === '' ? n : Math.min(Number(m[3]), n);
  return { largo: m[0].length, opciones: Math.max(1, max - min + 1), repite: Number(m[3] || m[1]) > 1 || m[3] === '' };
}

// Devuelve null si el patrón es aceptable, o el motivo del rechazo en español.
export function revisarRegex(patron: string, banderas = ''): string | null {
  if (patron.length > LARGO_MAXIMO_PATRON) return `la expresión regular supera ${LARGO_MAXIMO_PATRON} caracteres`;
  try { new RegExp(patron, banderas); } catch { return 'expresión regular inválida'; }

  const pila: Grupo[] = [{ cuantificado: false, alternancia: false }];
  let costo = 1;
  let i = 0;
  // Tras un átomo puede venir un cuantificador; 'interior' dice qué contenía el grupo que cerró.
  // Repetir algo que ya repite o alterna es lo que da tiempo exponencial; un '?' no repite.
  const despuesDeAtomo = (interior: Grupo | null): string | null => {
    const q = leerCuantificador(patron, i);
    const padre = pila[pila.length - 1];
    if (q?.repite && interior?.cuantificado) return 'cuantificadores anidados, como (a+)+, no se permiten';
    if (q?.repite && interior?.alternancia) return 'una alternancia repetida, como (a|b)+, no se permite';
    if (interior) {
      padre.cuantificado ||= interior.cuantificado;
      padre.alternancia ||= interior.alternancia;
    }
    if (!q) return null;
    costo *= q.opciones;
    if (costo > COSTO_MAXIMO_REGEX) return 'demasiados cuantificadores (*, +, ?, {n,m}); a lo sumo dos sin límite';
    padre.cuantificado = true;
    i += q.largo;
    if (patron[i] === '?') i++; // modo perezoso
    return null;
  };

  while (i < patron.length) {
    const c = patron[i];
    let error: string | null = null;
    if (c === '\\') {
      const s = patron[i + 1];
      if (/[1-9]/.test(s) || s === 'k') return 'las referencias hacia atrás (\\1, \\k<...>) no se permiten';
      i += 2;
      error = despuesDeAtomo(null);
    } else if (c === '[') {
      // Clase de caracteres: hasta el ']' sin escapar (un ']' justo al inicio es literal).
      i++;
      if (patron[i] === '^') i++;
      if (patron[i] === ']') i++;
      while (i < patron.length && patron[i] !== ']') i += patron[i] === '\\' ? 2 : 1;
      i++;
      error = despuesDeAtomo(null);
    } else if (c === '(') {
      i++;
      if (patron[i] === '?') {
        // (?: (?= (?! (?<= (?<! (?<nombre>
        i++;
        if (patron[i] === '<' && patron[i + 1] !== '=' && patron[i + 1] !== '!') {
          while (i < patron.length && patron[i] !== '>') i++;
          i++;
        } else i += patron[i] === '<' ? 2 : 1;
      }
      pila.push({ cuantificado: false, alternancia: false });
    } else if (c === ')') {
      const grupo = pila.length > 1 ? pila.pop() as Grupo : { cuantificado: false, alternancia: false };
      i++;
      error = despuesDeAtomo(grupo);
    } else if (c === '|') {
      pila[pila.length - 1].alternancia = true;
      i++;
    } else {
      i++;
      // '^' y '$' no son átomos repetibles, pero cuantificarlos ya lo rechaza RegExp.
      error = despuesDeAtomo(null);
    }
    if (error) return error;
  }
  return null;
}

// Para quien ejecuta un patrón sin haberlo validado antes: lanza con el motivo.
export function regexSegura(patron: string, banderas = ''): RegExp {
  const problema = revisarRegex(patron, banderas);
  if (problema) throw new Error(`Regex "${patron.slice(0, 40)}" rechazada: ${problema}.`);
  return new RegExp(patron, banderas);
}

export class ErrorRegexCostosa extends Error {}

// Ejecuta regex de usuario sobre texto recortado y lleva la cuenta del tiempo gastado:
// si supera limiteMs más 20 µs por prueba (lo normal es ~1 µs), lanza ErrorRegexCostosa.
// Así un patrón que pasó la revisión pero es lento no puede bloquear el proceso por minutos.
export function crearProbador(limiteMs = 2000): (re: RegExp, texto: string) => RegExpExecArray | null {
  let acumulado = 0;
  let pruebas = 0;
  return (re, texto) => {
    const recortado = texto.length > LARGO_MAXIMO_TEXTO_REGEX ? texto.slice(0, LARGO_MAXIMO_TEXTO_REGEX) : texto;
    const inicio = performance.now();
    const r = re.exec(recortado);
    acumulado += performance.now() - inicio;
    pruebas++;
    if (acumulado > limiteMs + pruebas * 0.02) {
      throw new ErrorRegexCostosa(`La regex /${re.source.slice(0, 40)}/ es demasiado lenta con estos datos (${Math.round(acumulado)} ms); simplifíquela.`);
    }
    return r;
  };
}
