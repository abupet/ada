-- sql/001_pets_and_changes.sql
-- Minimal pets storage + change log for offline sync.
-- Safe to run once. If you need idempotent, wrap with IF NOT EXISTS blocks.

CREATE TABLE IF NOT EXISTS pets (
  pet_id UUID PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  breed TEXT,
  sex TEXT,
  birthdate DATE,
  weight_kg NUMERIC(6,2),
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pets_owner_user_id ON pets(owner_user_id);

CREATE TABLE IF NOT EXISTS pet_changes (
  change_id BIGSERIAL PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  pet_id UUID NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('pet.upsert','pet.delete')),
  record JSONB,
  version INTEGER,
  client_ts TIMESTAMPTZ,
  device_id TEXT,
  op_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_changes_owner_change_id ON pet_changes(owner_user_id, change_id);
CREATE INDEX IF NOT EXISTS idx_pet_changes_pet_id ON pet_changes(pet_id);
