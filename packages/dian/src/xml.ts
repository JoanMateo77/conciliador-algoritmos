// El parser XML vive en @conciliador/core (lo comparte con el lector camt.053): una sola
// implementación de entidades, CDATA y comentarios, y una sola política ante DOCTYPE (se
// rechaza). Aquí solo se reexporta con los nombres cortos que usa este paquete.
export {
  analizarXML, ErrorXML,
  hijoXML as hijo, hijosXML as hijos, rutaXML as ruta, descendientesXML as descendientes,
  atributoXML as atributo, textoXML as textoDe,
} from '@conciliador/core';
export type { ElementoXML, AtributoXML } from '@conciliador/core';
