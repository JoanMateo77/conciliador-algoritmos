// Perfiles, puntaje y cruce.
export type { Perfil } from './perfil.ts';
export { PERFIL_POR_DEFECTO, validarPerfil } from './perfil.ts';
export type { Coincidencia, ResultadoConciliacion, Clasificado } from './conciliar.ts';
export { conciliar } from './conciliar.ts';
export {
  levenshtein, similitudReferencia, dentroDeTolerancia, rangoVentas, faltanteMaximo, formatearPorcentaje,
  explicarDiferencia,
} from './puntaje.ts';
// Fases 10 y 11: reglas, tarifas y asignación óptima.
export type { Condicion, Regla, AccionRegla } from './reglas.ts';
export { REGLA_GMF, validarReglas, compilarReglas, REGLAS_MAXIMAS, CONDICIONES_MAXIMAS_POR_REGLA } from './reglas.ts';
export type { Tarifa, ParteTarifa } from './tarifas.ts';
export { TARIFAS_EJEMPLO, validarTarifas, tarifaVigente, calcularTarifas } from './tarifas.ts';
export { asignacionMinima, emparejamientoMaximo } from './hungaro.ts';
export { asignarGreedy, asignarOptimo } from './pases.ts';
export type { AristaCruce } from './pases.ts';
