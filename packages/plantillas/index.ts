// Plantillas incluidas y archivos de muestra. Todo es dato: agregar un banco
// es agregar un JSON en formatos/ y sumarlo a esta lista.
import type { Plantilla } from '../core/src/plantillas/tipos.ts';
import asobancaria2001 from './formatos/asobancaria-2001.json' with { type: 'json' };
import bancoCsvGenerico from './formatos/banco-csv-generico.json' with { type: 'json' };
import mercadopagoLiquidacion from './formatos/mercadopago-liquidacion.json' with { type: 'json' };
import ventasCsvGenerico from './formatos/ventas-csv-generico.json' with { type: 'json' };
import wompiTransacciones from './formatos/wompi-transacciones.json' with { type: 'json' };

// El JSON se tipa como string genérico ('lado' no queda como 'banco' | 'ventas'),
// por eso el cast; quien registre las plantillas las valida con validarPlantilla.
export const PLANTILLAS: Plantilla[] = [
  bancoCsvGenerico,
  asobancaria2001,
  wompiTransacciones,
  mercadopagoLiquidacion,
  ventasCsvGenerico,
] as Plantilla[];

export { MUESTRAS } from './muestras/index.ts';
export type { Muestra } from './muestras/index.ts';
