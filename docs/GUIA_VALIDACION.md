# Guía de validación con usuarios (fase 8)

Objetivo de la semana: 5 a 10 entrevistas cortas y 3 a 5 archivos reales
**anonimizados** (extracto de banco, recaudo Asobancaria, exportación de Wompi
o Mercado Pago) que se conviertan en plantillas y vectores de prueba.

## 1. A quién entrevistar

| Perfil | Por qué | Dónde encontrarlo |
|---|---|---|
| Contador o auxiliar contable de una pyme | Hace la conciliación a mano cada mes | Profesores y egresados de Contaduría, firmas pequeñas de contabilidad |
| Dueño o administrador de una tienda en línea | Recibe pagos por Wompi, Mercado Pago, PSE o Nequi | Comercios con tienda propia, grupos de emprendedores |
| Tesorería de una empresa mediana | Recibe recaudos Asobancaria o archivos MT940 | Contactos de prácticas profesionales |

No entrevistar a nadie de la empresa donde trabaja el autor ni pedir archivos
de ella (ver riesgos en `PLAN.md`).

## 2. Guion de 10 minutos

Regla: preguntar por lo que la persona **hizo la última vez**, no por lo que
haría. No mostrar el producto hasta el minuto 7.

| Minuto | Pregunta | Qué se busca |
|---|---|---|
| 0–1 | «Le cuento: estudio Ingeniería en la UAO y estoy investigando cómo se cruzan los pagos con las ventas. No le voy a vender nada. ¿Le puedo hacer unas preguntas y tomar notas?» | Permiso |
| 1–3 | «Cuénteme la última vez que concilió el banco con las ventas. ¿Qué archivos abrió? ¿De qué banco y de qué pasarela?» | Formatos reales (CSV, Excel, Asobancaria, MT940) |
| 3–4 | «¿Cuánto tiempo le tomó? ¿Cada cuánto lo hace?» | Tamaño del dolor (horas al mes) |
| 4–5 | «¿Qué fue lo más difícil? ¿Hubo algún pago que no pudo cuadrar? ¿Qué hizo con él?» | Casos: comisiones, ReteFuente, abonos agrupados, referencias truncadas |
| 5–6 | Contador: «¿Cómo registra la comisión y las retenciones de la pasarela?» E-commerce: «¿Cómo sabe que un pedido ya se pagó?» | Reglas y tolerancias para el perfil |
| 6–7 | «¿Usa algo hoy (Excel con BUSCARV, Siigo, Alegra, el ERP)? ¿Qué le falta?» | Alternativas y por qué no bastan |
| 7–9 | Mostrar la demo «La Ceiba» en el panel: cargar, ver las coincidencias y la explicación de un faltante. «¿Esto le serviría? ¿Qué cambiaría?» | Reacción concreta, no cortesía |
| 9–10 | «¿Me podría compartir un extracto y un archivo de ventas de un mes, anonimizados con un programa que le explico? ¿Conoce a alguien más que haga esto?» | Archivos y siguiente entrevista |

Señales a anotar (no interpretar durante la entrevista):

- Horas al mes dedicadas a conciliar y número de movimientos por mes.
- Formatos y bancos exactos (nombre del archivo, extensión, codificación).
- Diferencias típicas: porcentaje de comisión, retenciones, días de demora.
- Si ofreció un archivo sin que se lo pidieran (señal fuerte de interés).

Plantilla de notas por entrevista: fecha, perfil, bancos/pasarelas, formatos,
horas al mes, casos difíciles (textual), herramienta actual, reacción a la
demo (textual), ¿compartirá archivo? (sí/no/cuándo), referidos.

## 3. Cómo pedir los archivos

Mensaje sugerido:

> Gracias por la entrevista. Para probar el conciliador con un formato real
> necesito un extracto bancario y el archivo de ventas o de la pasarela de un
> mes cualquiera. **No necesito datos reales de sus clientes**: le paso un
> programa que reemplaza nombres, cédulas, correos, cuentas y referencias por
> valores inventados y deja el formato igual. Usted lo corre en su equipo y
> revisa el resultado antes de enviármelo. Si prefiere, lo corremos juntos en
> una videollamada y el archivo original nunca sale de su computador.

Reglas:

- Nunca recibir el archivo original. Solo la versión anonimizada, revisada
  por la persona.
- Pedir el archivo **tal como lo descarga** del portal (sin abrirlo y
  guardarlo en Excel, que cambia fechas y decimales). Si solo existe en
  Excel, pedir el `.xlsx`: `scripts/anonimizar.ts` lo convierte a CSV con
  `;` (primera hoja, u otra con `--hoja`) antes de anonimizar.
- Anotar banco, producto, cómo se descargó y la codificación.
- Guardar los archivos donados fuera del repositorio hasta convertirlos en
  muestras; en el repositorio solo entran versiones anonimizadas y revisadas.

## 4. Cómo anonimizar

Requisito: Node 22.18 o superior y una copia del repositorio.

```bash
# 1. Primer archivo: el programa detecta la plantilla y genera una clave.
node scripts/anonimizar.ts extracto-original.csv extracto-anonimo.csv
#    Clave generada: 3f9c...   <- guárdela, NO la envíe con los archivos

# 2. Los demás archivos del mismo comercio, con la misma clave,
#    para que el banco y las ventas sigan cruzando entre sí.
node scripts/anonimizar.ts ventas-original.csv ventas-anonimo.csv --clave 3f9c...

# Si no se detecta el formato, se indica la plantilla:
node scripts/anonimizar.ts recaudo.txt recaudo-anonimo.txt --plantilla asobancaria-2001 --clave 3f9c...

# Opcional: correr las fechas y escalar los montos (los porcentajes de comisión se conservan).
node scripts/anonimizar.ts extracto.csv extracto-anonimo.csv --clave 3f9c... --desplazar-dias 17 --factor-montos 1.07
```

Qué hace:

- Reemplaza nombres, cédulas/NIT, correos, cuentas, teléfonos y referencias.
  Cada letra se cambia por una letra y cada dígito por un dígito, así que las
  longitudes, columnas, separadores y comillas quedan iguales.
- El reemplazo es **estable**: con la misma clave, el mismo valor da siempre
  lo mismo, en todos los archivos. Una referencia truncada por el banco sigue
  siendo prefijo de la referencia completa de la venta.
- Conserva las palabras de banca (ABONO, PSE, WOMPI, SALDO, TOTAL…), los
  montos y las fechas (salvo que se pidan `--desplazar-dias` o
  `--factor-montos`).
- Al final vuelve a leer el archivo con la plantilla y avisa si la lectura
  cambió.

Qué revisar antes de enviar (la anonimización es automática y puede fallar):

1. Abrir el archivo anonimizado y buscar nombres, cédulas o correos que
   hayan quedado (por ejemplo, en una columna con un encabezado raro).
2. En Asobancaria y otros archivos de ancho fijo, las líneas de encabezado y
   control se copian sin cambios: revisar el NIT y la cuenta de la empresa.
3. En MT940 y camt.053 las fechas y montos no se desplazan (los saldos
   dejarían de cuadrar).
4. Leer los avisos que imprime el programa.

## 5. De archivo donado a vector de prueba

1. Si ninguna plantilla incluida lo lee, crear una con el asistente del panel
   o a mano (`README.md`, «Agregar un banco nuevo»).
2. Copiar el archivo anonimizado a `packages/plantillas/muestras/`, sumarlo a
   `muestras/index.ts` y escribir su prueba (cantidad de movimientos, suma,
   casos raros).
3. `npm test`. Criterio de terminado de la fase 8: cada archivo real se lee
   sin errores y tiene su prueba.
