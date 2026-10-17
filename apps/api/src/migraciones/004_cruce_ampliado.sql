-- 004: espacio para lo que agregan las fases 9 a 11 sin perder datos al guardar.
-- Coincidencia.tipo admite 'agrupadaNM' y los campos que el núcleo agregue a
-- coincidencias o movimientos (plantillaVersion, documento...) van en 'extra'.

ALTER TABLE coincidencias DROP CONSTRAINT IF EXISTS coincidencias_tipo_check;
ALTER TABLE coincidencias ADD CONSTRAINT coincidencias_tipo_check
  CHECK (tipo IN ('exacta', 'tolerancia', 'agrupada', 'agrupadaNM', 'manual'));
ALTER TABLE coincidencias ADD COLUMN IF NOT EXISTS extra jsonb;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS extra jsonb;
