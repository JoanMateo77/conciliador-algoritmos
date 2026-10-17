# @conciliador/core

Motor de conciliación de pagos para Colombia: cruza los abonos del banco con
las ventas y explica cada diferencia (comisión, IVA, retenciones, GMF). Sin
dependencias, sin E/S y con montos en centavos enteros.

*Payment reconciliation engine for Colombia: matches bank deposits against
sales and explains every difference (fees, VAT, withholdings, GMF). No
dependencies, no I/O, amounts in integer cents. Spanish API.*

```bash
npm install @conciliador/core @conciliador/plantillas
```

## Ejemplo / Example

```js
import { RegistroPlantillas, procesarArchivos, conciliar, SesionRevision } from '@conciliador/core';
import { PLANTILLAS, MUESTRAS } from '@conciliador/plantillas';

const registro = new RegistroPlantillas();
for (const p of PLANTILLAS) registro.registrar(p);
const archivo = (id) => { const m = MUESTRAS.find((x) => x.id === id); return { nombre: m.archivo, texto: m.texto }; };
const [banco, ventas] = procesarArchivos([archivo('extracto-banco'), archivo('ventas-wompi')], registro);
const resultado = conciliar(banco.movimientos, ventas.movimientos); // perfil opcional
for (const c of resultado.coincidencias) console.log(c.id, c.tipo, c.estado, c.explicacion);
new SesionRevision(resultado).confirmar(resultado.coincidencias[0].id); // deshacer/rehacer
```

Con sus propios archivos, pase `{ nombre, texto }` leídos del disco o del
navegador; la plantilla se detecta por los encabezados.

*With your own files pass `{ nombre, texto }`; the template is detected from
the headers.*

## Qué trae / What's inside

- Plantillas JSON (delimitado, ancho fijo) y lectores MT940 y camt.053.
- Cruce por pases: exacto, con tolerancia, agrupado N:1 y N:M con asignación
  óptima (algoritmo Húngaro); reglas AND/OR y tarifas con vigencia.
- `SesionRevision`: confirmar, rechazar y emparejar a mano con deshacer y
  bitácora.

Paquetes relacionados: `@conciliador/plantillas` (formatos incluidos),
`@conciliador/excel` (.xlsx/.xls) y `@conciliador/dian` (facturas UBL 2.1).

Requiere Node 22 o posterior (ESM). Licencia MIT.
