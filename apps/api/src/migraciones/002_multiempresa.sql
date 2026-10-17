-- 002: multiempresa. Empresas, usuarios con rol, empresa_id en todos los datos de
-- negocio y plantillas/perfiles por empresa con versiones que nunca se sobrescriben.
-- Lo que ya existía (base del MVP) queda en la empresa pública 'demo'.

CREATE TABLE IF NOT EXISTS empresas (
  id      uuid PRIMARY KEY,
  nombre  text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  -- Solo la empresa pública de demostración tiene código ('demo').
  codigo  text UNIQUE,
  creada  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO empresas (id, nombre, codigo)
VALUES ('00000000-0000-4000-8000-000000000001', 'Demostración pública', 'demo')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS usuarios (
  id              uuid PRIMARY KEY,
  empresa_id      uuid NOT NULL REFERENCES empresas (id),
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  correo          text NOT NULL CHECK (length(correo) BETWEEN 3 AND 254),
  -- scrypt$N$r$p$sal$hash (base64): la sal y los parámetros viajan con el hash.
  hash_contrasena text NOT NULL,
  rol             text NOT NULL CHECK (rol IN ('admin', 'analista', 'lector')),
  activo          boolean NOT NULL DEFAULT true,
  creado          timestamptz NOT NULL DEFAULT now()
);
-- Un correo identifica a una sola persona en toda la instancia (el ingreso no pide empresa).
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_idx ON usuarios (lower(correo));
CREATE INDEX IF NOT EXISTS usuarios_empresa_idx ON usuarios (empresa_id, creado, id);

-- ---------- empresa_id en los datos del MVP ----------

ALTER TABLE conciliaciones ADD COLUMN IF NOT EXISTS empresa_id uuid
  NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES empresas (id);
-- El valor por defecto solo sirvió para las filas viejas: desde aquí cada INSERT dice su empresa.
ALTER TABLE conciliaciones ALTER COLUMN empresa_id DROP DEFAULT;
ALTER TABLE conciliaciones ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios (id);
ALTER TABLE conciliaciones ADD COLUMN IF NOT EXISTS perfil_id text;
ALTER TABLE conciliaciones ADD COLUMN IF NOT EXISTS perfil_version integer;
-- Permite que las tablas hijas exijan la MISMA empresa que su conciliación.
ALTER TABLE conciliaciones ADD CONSTRAINT conciliaciones_id_empresa_uk UNIQUE (id, empresa_id);
CREATE INDEX IF NOT EXISTS conciliaciones_empresa_creada_idx ON conciliaciones (empresa_id, creada DESC, id DESC);

-- Las hijas copian la empresa de su conciliación si el INSERT no la trae.
CREATE OR REPLACE FUNCTION completar_empresa_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    SELECT c.empresa_id INTO NEW.empresa_id FROM conciliaciones c WHERE c.id = NEW.conciliacion_id;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE coincidencias ADD COLUMN IF NOT EXISTS empresa_id uuid;
UPDATE coincidencias k SET empresa_id = c.empresa_id FROM conciliaciones c WHERE c.id = k.conciliacion_id AND k.empresa_id IS NULL;
ALTER TABLE coincidencias ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE coincidencias ADD CONSTRAINT coincidencias_empresa_fk
  FOREIGN KEY (conciliacion_id, empresa_id) REFERENCES conciliaciones (id, empresa_id) ON DELETE CASCADE;
CREATE TRIGGER coincidencias_empresa BEFORE INSERT ON coincidencias
  FOR EACH ROW EXECUTE FUNCTION completar_empresa_id();

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS empresa_id uuid;
UPDATE movimientos m SET empresa_id = c.empresa_id FROM conciliaciones c WHERE c.id = m.conciliacion_id AND m.empresa_id IS NULL;
ALTER TABLE movimientos ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_empresa_fk
  FOREIGN KEY (conciliacion_id, empresa_id) REFERENCES conciliaciones (id, empresa_id) ON DELETE CASCADE;
CREATE TRIGGER movimientos_empresa BEFORE INSERT ON movimientos
  FOR EACH ROW EXECUTE FUNCTION completar_empresa_id();

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS empresa_id uuid;
UPDATE eventos e SET empresa_id = c.empresa_id FROM conciliaciones c WHERE c.id = e.conciliacion_id AND e.empresa_id IS NULL;
ALTER TABLE eventos ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE eventos ADD CONSTRAINT eventos_empresa_fk
  FOREIGN KEY (conciliacion_id, empresa_id) REFERENCES conciliaciones (id, empresa_id) ON DELETE CASCADE;
CREATE TRIGGER eventos_empresa BEFORE INSERT ON eventos
  FOR EACH ROW EXECUTE FUNCTION completar_empresa_id();
-- Auditoría: quién tomó la decisión (NULL = espacio público de demostración).
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios (id);
CREATE INDEX IF NOT EXISTS eventos_usuario_idx ON eventos (usuario_id) WHERE usuario_id IS NOT NULL;

-- Historial inmutable: lo escrito en una tabla de versiones no se edita ni se borra.
CREATE OR REPLACE FUNCTION prohibir_cambios() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % solo admite agregar filas (historial inmutable).', TG_TABLE_NAME;
END
$$;
-- La bitácora tampoco se reescribe (sí se borra en cascada si se borra la conciliación).
CREATE TRIGGER eventos_inmutables BEFORE UPDATE ON eventos
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

-- ---------- Plantillas y perfiles por empresa, con versiones ----------

CREATE TABLE IF NOT EXISTS plantillas_empresa (
  empresa_id     uuid NOT NULL REFERENCES empresas (id),
  id             text NOT NULL CHECK (length(id) BETWEEN 1 AND 100),
  lado           text NOT NULL CHECK (lado IN ('banco', 'ventas')),
  version_actual integer NOT NULL CHECK (version_actual >= 1),
  creada         timestamptz NOT NULL DEFAULT now(),
  actualizada    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id)
);

CREATE TABLE IF NOT EXISTS plantillas_versiones (
  empresa_id   uuid NOT NULL,
  plantilla_id text NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  contenido    jsonb NOT NULL,
  usuario_id   uuid REFERENCES usuarios (id),
  creada       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, plantilla_id, version),
  FOREIGN KEY (empresa_id, plantilla_id) REFERENCES plantillas_empresa (empresa_id, id)
);
CREATE TRIGGER plantillas_versiones_inmutables BEFORE UPDATE OR DELETE ON plantillas_versiones
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

CREATE TABLE IF NOT EXISTS perfiles_empresa (
  empresa_id     uuid NOT NULL REFERENCES empresas (id),
  id             text NOT NULL CHECK (length(id) BETWEEN 1 AND 100),
  version_actual integer NOT NULL CHECK (version_actual >= 1),
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id)
);

CREATE TABLE IF NOT EXISTS perfiles_versiones (
  empresa_id uuid NOT NULL,
  perfil_id  text NOT NULL,
  version    integer NOT NULL CHECK (version >= 1),
  contenido  jsonb NOT NULL,
  usuario_id uuid REFERENCES usuarios (id),
  creado     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, perfil_id, version),
  FOREIGN KEY (empresa_id, perfil_id) REFERENCES perfiles_empresa (empresa_id, id)
);
CREATE TRIGGER perfiles_versiones_inmutables BEFORE UPDATE OR DELETE ON perfiles_versiones
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
