-- 001: esquema del MVP (antes esquema.sql). Idempotente (IF NOT EXISTS): sobre una
-- base creada por el MVP no cambia nada y la deja registrada en la tabla migraciones.

CREATE TABLE IF NOT EXISTS conciliaciones (
  id               uuid PRIMARY KEY,
  creada           timestamptz NOT NULL DEFAULT now(),
  archivo_banco    text NOT NULL,
  archivo_ventas   text NOT NULL,
  plantilla_banco  text NOT NULL,
  plantilla_ventas text NOT NULL,
  perfil           jsonb NOT NULL,
  resumen          jsonb NOT NULL,
  -- Lo que no tiene tabla propia (grafo, pases, sin cruzar originales):
  -- se guarda tal cual salió del cruce para poder reproducir el resultado.
  detalle          jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS coincidencias (
  conciliacion_id     uuid NOT NULL REFERENCES conciliaciones (id) ON DELETE CASCADE,
  id                  text NOT NULL,
  orden               integer NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('exacta', 'tolerancia', 'agrupada', 'manual')),
  banco_ids           text[] NOT NULL,
  ventas_ids          text[] NOT NULL,
  puntaje             double precision NOT NULL CHECK (puntaje >= 0 AND puntaje <= 1),
  diferencia_centavos bigint NOT NULL,
  explicacion         text NOT NULL,
  -- estado_inicial es lo que dijo el motor; estado es la decisión vigente.
  estado_inicial      text NOT NULL CHECK (estado_inicial IN ('automatica', 'sugerida')),
  estado              text NOT NULL CHECK (estado IN ('automatica', 'sugerida', 'confirmada', 'rechazada')),
  actualizada         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conciliacion_id, id)
);

CREATE TABLE IF NOT EXISTS movimientos (
  conciliacion_id uuid NOT NULL REFERENCES conciliaciones (id) ON DELETE CASCADE,
  lado            text NOT NULL CHECK (lado IN ('banco', 'ventas')),
  id              text NOT NULL,
  fecha           date NOT NULL,
  monto_centavos  bigint NOT NULL,
  referencia      text NOT NULL DEFAULT '',
  descripcion     text NOT NULL DEFAULT '',
  referencia_pago text,
  desglose        jsonb,
  plantilla       text NOT NULL,
  linea           integer NOT NULL,
  -- NULL = libre. Rechazar una coincidencia devuelve sus movimientos a NULL.
  coincidencia_id text,
  PRIMARY KEY (conciliacion_id, lado, id),
  FOREIGN KEY (conciliacion_id, coincidencia_id) REFERENCES coincidencias (conciliacion_id, id)
);

-- Bitácora: solo se anexa, nunca se actualiza.
CREATE TABLE IF NOT EXISTS eventos (
  id              bigserial PRIMARY KEY,
  conciliacion_id uuid NOT NULL REFERENCES conciliaciones (id) ON DELETE CASCADE,
  coincidencia_id text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('confirmar', 'rechazar', 'manual')),
  estado_anterior text NOT NULL CHECK (estado_anterior IN ('automatica', 'sugerida', 'confirmada', 'rechazada')),
  estado_nuevo    text NOT NULL CHECK (estado_nuevo IN ('automatica', 'sugerida', 'confirmada', 'rechazada')),
  creado          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conciliacion_id, coincidencia_id) REFERENCES coincidencias (conciliacion_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conciliaciones_creada_idx ON conciliaciones (creada DESC);
CREATE INDEX IF NOT EXISTS coincidencias_estado_idx ON coincidencias (conciliacion_id, estado);
CREATE INDEX IF NOT EXISTS movimientos_coincidencia_idx ON movimientos (conciliacion_id, coincidencia_id);
CREATE INDEX IF NOT EXISTS eventos_conciliacion_idx ON eventos (conciliacion_id, id);
