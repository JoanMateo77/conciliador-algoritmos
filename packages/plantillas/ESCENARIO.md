# Escenario de demostración: Tienda La Ceiba (octubre 2026)

Datos 100 % sintéticos. Tienda La Ceiba es ficticia; correos `@ejemplo.test`,
NIT, cuentas y códigos de entidad (`999`) son inventados.

Este documento es la **prueba de aceptación** del cruce: dice qué debería
salir al conciliar cada par de muestras y por qué.

## Perfil para la demo

Los casos con comisión + IVA + ReteFuente dejan un faltante de 4,65 %, así
que la tolerancia porcentual debe ser al menos 5 %:

| Campo | Valor |
|---|---|
| `toleranciaFaltantePorcentaje` | 0.05 (el escenario se verificó entre 0.05 y 0.07) |
| `toleranciaFaltanteCentavos` | 0 (o un valor pequeño; no cambia el resultado) |
| `toleranciaSobranteCentavos` | 0 |
| `ventanaDias` | 3 a 6 (la venta más vieja de un abono tiene 3 días) |
| `diasDespues` | 0 o 1 |
| `maxGrupo` | 4 o más |
| `retenciones` | `[{ nombre: 'ReteFuente', tasa: 0.015 }]` |

Con un perfil del 4 % las filas B6 y B9 (comisión + ReteFuente) quedarían
sin cruzar: también es un resultado útil para mostrar por qué existe el perfil.

El escenario se generó con un simulador simplificado de los tres pases y se
comprobó que, en todo ese rango de perfiles, cada abono tiene **una sola**
solución posible (sin ambigüedades en el pase 2 ni en la suma de subconjuntos
del pase 3).

Tarifas usadas para construir los faltantes (por venta, redondeo al centavo):
comisión Wompi 2,65 % del bruto, IVA 19 % sobre la comisión (3,1535 % en
total) y, cuando aplica, ReteFuente 1,5 % del bruto (4,6535 % en total).

## Par 1: `extracto-banco.csv` (banco-csv-generico) contra `ventas-wompi.csv` (wompi-transacciones)

Lectura esperada:

- Banco: 17 filas de datos; se omiten `SALDO ANTERIOR` y `TOTAL ABONOS`
  (omitirSi) y el débito `GMF 4X1000` (soloEntradas). Quedan **14 abonos**.
  Como la plantilla no mapea `id`, los ids son `banco-csv-generico:<línea>`
  (línea 1 = encabezado). La fila 10 trae `"LIQUIDACION WOMPI; LOTE 3 TRX"`
  entre comillas con un `;` adentro: debe leerse como una sola columna.
- Ventas: 25 filas; se omiten 4 que no son `APPROVED` (PED-2026-115090
  DECLINED, PED-2026-139921 DECLINED, PED-2026-176613 ERROR,
  PED-2026-188740 VOIDED). Quedan **21 ventas**. Dos rechazadas tienen el
  mismo monto que ventas aprobadas (245.000 y 73.450): si omitirSi fallara,
  aparecerían candidatos falsos.

Coincidencias esperadas (B = línea del extracto; las ventas se nombran por `reference`):

| B | Fecha abono | Valor abono | Ventas que paga | Tipo | Diferencia | Por qué |
|---|---|---|---|---|---|---|
| 3 | 2026-10-01 | 89.500,00 | PED-2026-104823 (89.500) | exacta | 0 | Mismo monto y misma referencia (PSE). |
| 4 | 2026-10-02 | 89.776,71 | PED-2026-160021 (34.900) + PED-2026-160487 (57.800) | agrupada | -2.923,29 | Liquidación de 2 ventas del 01/10: bruto 92.700, comisión 2.456,55 + IVA 466,74. La referencia `WOMPI20261002` no se parece a ninguna venta. |
| 5 | 2026-10-02 | 245.000,00 | PED-2026-117350 (245.000) | exacta | 0 | Mismo monto y referencia (transferencia). |
| 6 | 2026-10-05 | 62.300,00 | PED-2026-121904 (62.300) | exacta | 0 | Mismo monto y referencia. |
| 7 | 2026-10-05 | 163.573,74 | PED-2026-126415 (168.900) | tolerancia | -5.326,26 | Venta del sábado 03/10 pagada el lunes: comisión 4.475,85 + IVA 850,41 (3,15 %). Misma referencia. |
| 8 | 2026-10-06 | 495.801,80 | PED-2026-118842 (520.000) | tolerancia | -24.198,20 | Comisión 13.780 + IVA 2.618,20 + ReteFuente 7.800 (4,65 %). La explicación debe mencionar ReteFuente. |
| 9 | 2026-10-07 | 71.133,75 | PED-2026-140277 (73.450) | tolerancia | -2.316,25 | Comisión 1.946,43 + IVA 369,82. |
| 10 | 2026-10-08 | 151.032,11 | PED-2026-171032 (41.200) + PED-2026-171568 (18.750) + PED-2026-171944 (96.000) | agrupada | -4.917,89 | Liquidación de 3 ventas del 07/10: bruto 155.950, comisión 4.132,68 + IVA 785,21. |
| 12 | 2026-10-09 | 190.597,65 | PED-2026-147390 (199.900) | tolerancia | -9.302,35 | Comisión 5.297,35 + IVA 1.006,50 + ReteFuente 2.998,50 (4,65 %). |
| 14 | 2026-10-09 | 410.000,00 | PED-2026-133018 (410.000) | exacta | 0 | Mismo monto y referencia. |
| 15 | 2026-10-13 | 302.161,08 | PED-2026-152936 (312.000) | tolerancia | -9.838,92 | Venta del sábado 10/10; el lunes 12/10 es festivo, abona el martes 13/10. Comisión 8.268 + IVA 1.570,92. |
| 16 | 2026-10-14 | 135.700,00 | PED-2026-109377 (135.700) | tolerancia | 0 | Referencia truncada por el banco a 12 caracteres (`PED-2026-109`, normalizada `PED2026109`, prefijo único de `PED2026109377`) y abono un día después: no entra en el pase exacto (ni monto+referencia ni monto+fecha), pero el pase 2 la encuentra con monto exacto y prefijo vía Trie. |
| 17 | 2026-10-14 | 213.255,99 | PED-2026-183205 (27.300) + PED-2026-183617 (64.900) + PED-2026-184090 (15.600) + PED-2026-184452 (112.400) | agrupada | -6.944,01 | Liquidación de 4 ventas del 12 y 13/10: bruto 220.200, comisión 5.835,30 + IVA 1.108,71. |

Sin cruzar:

| Lado | Movimiento | Por qué |
|---|---|---|
| banco | B13, 2026-10-09, 350.000,00, `CONSIGNACION EFECTIVO OFICINA`, sin referencia | Consignación desconocida: ninguna venta ni suma de ventas libres cabe en la tolerancia. |
| ventas | PED-2026-112268, 2026-10-02, 389.000, NEQUI | Venta sin abono (el pago nunca llegó). |
| ventas | PED-2026-190553, 2026-10-15, 289.000, CARD | Venta sin abono (aún no se liquida). |

Resumen esperado:

| Campo | Valor |
|---|---|
| movimientosBanco | 14 |
| movimientosVentas | 21 |
| coincidencias | 13 (4 exactas, 6 tolerancia, 3 agrupadas) |
| sinCruzarBanco | 1 |
| sinCruzarVentas | 2 |
| totalBancoCentavos | 296.983.283 ($2.969.832,83) |
| totalVentasCentavos | 336.360.000 ($3.363.600) |
| suma de abonos conciliados | 261.983.283 ($2.619.832,83) |
| suma de ventas conciliadas | 268.560.000 ($2.685.600) |
| diferencia total conciliada | -6.576.717 (-$65.767,17, todo explicado por comisión, IVA y ReteFuente) |

Notas para el equipo de cruce:

- Las 4 exactas deben salir en el pase 1 por `monto|referencia`. Ningún abono
  coincide por accidente con otra venta por `monto|fecha`.
- La venta rechazada PED-2026-115090 (245.000, 02/10) existe solo para
  probar omitirSi; no debe aparecer en el resultado.
- `totalConciliadoCentavos` no está definido con precisión en el contrato
  (lado banco o ventas); arriba están ambas sumas.

## Par 2: `recaudo-asobancaria.txt` (asobancaria-2001) contra `ventas-erp.csv` (ventas-csv-generico)

Lectura esperada:

- Recaudo: 9 líneas de 162 caracteres (01, 05, cinco 06, 08, 09). Solo se
  leen los 5 registros 06; ids `asobancaria-2001:<línea>` (líneas 3 a 7).
  Fecha 2026-10-14 (posiciones 98-105, copia de la fecha del registro 01).
  La referencia viene con ceros a la izquierda en 48 posiciones; la regex
  `0*([^\s0]\S*)` deja `100245`, etc. Control: 5 registros, 821.700,00.
- ERP: 6 ventas. La fila V-2103 tiene el cliente entre comillas con una coma
  (`"Cliente Ejemplo 03, Sucursal Norte"`): debe leerse como una sola columna.

| Línea recaudo | Referencia | Valor | Venta ERP | Tipo | Diferencia |
|---|---|---|---|---|---|
| 3 | 100245 | 125.000,00 | V-2101 (2026-10-09) | exacta | 0 |
| 4 | 100251 | 87.350,00 | V-2102 (2026-10-10) | exacta | 0 |
| 5 | 100263 | 342.900,00 | V-2103 (2026-10-12) | exacta | 0 |
| 6 | 100270 | 56.000,00 | V-2104 (2026-10-13) | exacta | 0 |
| 7 | 100288 | 210.450,00 | V-2105 (2026-10-13) | exacta | 0 |

Sin cruzar: venta V-2106 (100294, 99.800, 2026-10-14), factura aún no pagada.
Ningún recaudo queda sin cruzar.

Resumen: 5 movimientos banco, 6 ventas, 5 exactas, totalBanco 82.170.000,
totalVentas 92.150.000.

## Archivo suelto: `liquidacion-mercadopago.csv` (mercadopago-liquidacion)

No tiene pareja en el escenario; sirve para probar la lectura y el desglose.
8 filas: se omiten el REFUND y el PAYOUTS (omitirSi sobre TRANSACTION_TYPE),
quedan **6 ventas** con `montoCentavos` = TRANSACTION_AMOUNT (bruto) y
`desglose` con bruto, comisión (|FEE_AMOUNT|) y retenciones (|TAXES_AMOUNT|).
Ejemplo, primera fila: monto 15.000.000, comision 682.465, retenciones
225.000; bruto - comisión - retenciones = 14.092.535 = SETTLEMENT_NET_AMOUNT.

## El mismo extracto en otros formatos (fase 9)

- `extracto-banco-mt940.txt` (mt940-generico) y `extracto-banco-camt053.xml`
  (camt053-generico) traen **los mismos 16 movimientos** que
  `extracto-banco.csv` (14 abonos, el débito GMF y la consignación), con saldo
  inicial 2.350.000,00 y final 5.319.784,83 (`:60F:`/`:62F:` y `OPBD`/`CLBD`
  cuadran). Leídos con su plantilla dan los mismos 14 abonos (fecha, monto,
  referencia y descripción) y el mismo cruce del par 1 contra
  `ventas-wompi.csv`; solo cambian los ids (`<plantilla>:<línea>`).
  En MT940 la consignación y el GMF vienen como `NONREF` (referencia vacía)
  y el `:86:` de la liquidación del 08/10 ocupa dos líneas
  (`LIQUIDACION WOMPI;` + `LOTE 3 TRX`). En camt.053 ese texto viene en dos
  `<Ustrd>` y la referencia vacía es `NOTPROVIDED`.
- `extracto-banco-breb.csv` (banco-csv-generico) agrega la columna opcional
  `REFERENCIA PAGO`. Tiene 4 abonos: uno PSE como en el extracto principal y
  tres transferencias Bre-B sin referencia bancaria pero con `REFERENCIA
  PAGO` = la referencia del pedido (PED-2026-117350, PED-2026-121904 y
  PED-2026-133018, mismos montos que en `ventas-wompi.csv`), que llega a
  `referenciaPago`. Saldo final 3.156.752,00.
