# @conciliador/dian

Lee facturas electrónicas de la DIAN (UBL 2.1) y las convierte en movimientos
del lado `ventas`, para cruzar pagos B2B del extracto bancario contra
facturas con el mismo `conciliar()` del núcleo. Sin dependencias externas
(solo `@conciliador/core`): usa el parser XML propio del núcleo, con
namespaces, entidades y CDATA, el mismo del lector camt.053 (rechaza DOCTYPE).

```ts
import { leerFacturas } from '@conciliador/dian';
import { conciliar } from '@conciliador/core';

const { movimientos: facturas, errores } = leerFacturas([xml1, xml2]);
const resultado = conciliar(pagosDelBanco, facturas, perfilConRetenciones);
```

## Qué extrae

| Dato | De dónde (UBL 2.1) |
|---|---|
| Número (`id`, `referencia`) | `cbc:ID` |
| CUFE / CUDE | `cbc:UUID` (SHA-384, 96 caracteres hex) |
| Fecha / vencimiento | `cbc:IssueDate` / `cbc:DueDate` o `cac:PaymentMeans/cbc:PaymentDueDate` |
| NIT emisor y adquirente | `cac:AccountingSupplierParty` / `cac:AccountingCustomerParty` → `cbc:CompanyID` (sin DV) |
| IVA | `cac:TaxTotal` del documento con tributo `01` (no los de cada línea) |
| Retenciones | suma de `cac:WithholdingTaxTotal` (ReteRenta 06, ReteIVA 05, ReteICA 07) |
| Subtotal y total a pagar | `cac:LegalMonetaryTotal` (`LineExtensionAmount`, `PayableAmount`) |

- `montoCentavos` = total a pagar. Las notas crédito (`CreditNote`) quedan en
  negativo; las notas débito usan `RequestedMonetaryTotal`.
- Si la factura trae retenciones, el movimiento lleva
  `desglose.retencionesCentavos`: el cruce explica el faltante del pago
  como "retenciones $X según el desglose".
- Acepta el `AttachedDocument` con el que se envía la factura al cliente: la
  saca del CDATA de `cac:Attachment/.../cbc:Description` y descarta la
  `ApplicationResponse` de la DIAN.
- Errores claros, sin excepciones: XML mal formado (con línea y columna), sin
  CUFE, sin NIT, montos inválidos, moneda distinta de COP. `leerFacturas`
  sigue con el resto del lote y descarta documentos repetidos.
- No verifica la firma digital ni recalcula el CUFE (requiere la clave técnica
  del emisor).

## Muestras (sintéticas)

`muestras/` tiene 6 facturas de Tienda La Ceiba a clientes inventados (una
dentro de un `AttachedDocument`), una nota crédito y `pagos-b2b.csv`
(plantilla `banco-csv-generico`). Los CUFE se calcularon con la fórmula del
anexo técnico y una clave técnica inventada. `src/muestras.ts` trae los mismos
textos para usarlos en el navegador.

| Pago | Factura | Resultado esperado |
|---|---|---|
| $1.011.500 ref. LCE1003 | LCE1003 | exacta |
| $2.888.350 ref. LCE1001 | LCE1001 ($2.975.000) | tolerancia: ReteFuente 2,5 % + ReteICA 9,66 ‰ |
| $4.830.000 ref. LCE1002 | LCE1002 ($4.998.000, en AttachedDocument) | tolerancia: ReteFuente 4 % |
| $1.848.544 sin referencia | LCE1004 ($1.904.000) | tolerancia: ReteFuente + ReteICA |
| $3.581.554 ref. LCE1005 | LCE1005 ($3.689.000) | tolerancia: ReteFuente + ReteICA |
| $145.000 Wompi | — | sin cruzar |
| — | LCE1006 y nota crédito NCL21 | sin cruzar (pendientes de pago) |

Perfil usado: tolerancia de faltante 6 %, ventana de 45 días.

## Pruebas

```sh
node --test packages/dian/test/dian.test.ts
```
