// @conciliador/dian: facturas electrónicas DIAN (UBL 2.1) como movimientos del lado 'ventas'.
export { leerFacturaUBL, leerFacturas, montoUBL, NS, PLANTILLA_DIAN, VERSION_LECTOR_DIAN } from './factura.ts';
export { analizarXML, ErrorXML, hijo, hijos, ruta, descendientes, atributo, textoDe } from './xml.ts';
export type { ElementoXML, AtributoXML } from './xml.ts';
export { MUESTRAS_DIAN, FACTURAS_MUESTRA, PAGOS_B2B_MUESTRA } from './muestras.ts';
export type { MuestraDian } from './muestras.ts';
