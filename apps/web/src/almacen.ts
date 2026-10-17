// localStorage puede no existir o lanzar (modo privado, cuota llena):
// toda lectura y escritura va en try/catch y el panel sigue funcionando sin él.
const PREFIJO = 'conciliador.';

export function leerGuardado<T>(clave: string, porDefecto: T): T {
  try {
    const texto = localStorage.getItem(PREFIJO + clave);
    return texto === null ? porDefecto : (JSON.parse(texto) as T);
  } catch {
    return porDefecto;
  }
}

export function guardar(clave: string, valor: unknown): boolean {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}
