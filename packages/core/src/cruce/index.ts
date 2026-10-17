// Perfiles, puntaje y cruce.
export type { Perfil } from './perfil.ts';
export { PERFIL_POR_DEFECTO, validarPerfil } from './perfil.ts';
export type { Coincidencia, ResultadoConciliacion } from './conciliar.ts';
export { conciliar } from './conciliar.ts';
export {
  levenshtein, similitudReferencia, dentroDeTolerancia, rangoVentas, faltanteMaximo, formatearPorcentaje,
  explicarDiferencia,
} from './puntaje.ts';
