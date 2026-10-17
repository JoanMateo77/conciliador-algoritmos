-- 003: cola persistente de trabajos. Los workers toman filas con FOR UPDATE SKIP LOCKED,
-- así varios procesos trabajan a la vez sin tomar dos veces el mismo trabajo.

CREATE TABLE IF NOT EXISTS trabajos (
  id              uuid PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES empresas (id),
  usuario_id      uuid REFERENCES usuarios (id),
  tipo            text NOT NULL DEFAULT 'conciliar' CHECK (tipo IN ('conciliar')),
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'hecho', 'fallido')),
  intentos        integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  max_intentos    integer NOT NULL DEFAULT 3 CHECK (max_intentos >= 1),
  -- Entrada del trabajo; se vacía al terminar bien (el resultado ya quedó en conciliaciones).
  carga           jsonb,
  conciliacion_id uuid REFERENCES conciliaciones (id) ON DELETE SET NULL,
  error           text,
  error_detalles  jsonb,
  -- Ficha de la toma vigente: solo quien la tiene puede cerrar el trabajo.
  toma            uuid,
  worker          text,
  creado          timestamptz NOT NULL DEFAULT now(),
  disponible_en   timestamptz NOT NULL DEFAULT now(),
  tomado_en       timestamptz,
  terminado_en    timestamptz
);

-- Índices parciales: la cola solo mira lo pendiente y lo que se está procesando.
CREATE INDEX IF NOT EXISTS trabajos_pendientes_idx ON trabajos (disponible_en, creado) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS trabajos_procesando_idx ON trabajos (tomado_en) WHERE estado = 'procesando';
CREATE INDEX IF NOT EXISTS trabajos_empresa_idx ON trabajos (empresa_id, creado DESC, id DESC);
CREATE INDEX IF NOT EXISTS trabajos_empresa_estado_idx ON trabajos (empresa_id, estado);
