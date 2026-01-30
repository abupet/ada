// backend/src/pets.routes.js v1
const express = require("express");
const { getPool } = require("./db");
const { randomUUID } = require("crypto");

function petsRouter({ requireAuth }) {
  const router = express.Router();
  const pool = getPool();

  // List pets for current user
  router.get("/api/pets", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const { rows } = await pool.query(
      "SELECT * FROM pets WHERE owner_user_id = $1 ORDER BY updated_at DESC",
      [owner_user_id]
    );
    res.json({ pets: rows });
  });

  // Get single pet
  router.get("/api/pets/:pet_id", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const { pet_id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM pets WHERE owner_user_id = $1 AND pet_id = $2 LIMIT 1",
      [owner_user_id, pet_id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  });

  // Create pet
  router.post("/api/pets", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const pet_id = req.body.pet_id || randomUUID();
    const {
      name,
      species,
      breed = null,
      sex = null,
      birthdate = null,
      weight_kg = null,
      notes = null,
    } = req.body || {};

    if (!name || !species) return res.status(400).json({ error: "name_and_species_required" });

    const { rows } = await pool.query(
      `INSERT INTO pets
        (pet_id, owner_user_id, name, species, breed, sex, birthdate, weight_kg, notes, version)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
       RETURNING *`,
      [pet_id, owner_user_id, name, species, breed, sex, birthdate, weight_kg, notes]
    );

    // change log
    await pool.query(
      `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version)
       VALUES ($1,$2,'pet.upsert',$3,$4)`,
      [owner_user_id, pet_id, rows[0], rows[0].version]
    );

    res.status(201).json(rows[0]);
  });

  // Update pet (optimistic concurrency via base_version)
  router.patch("/api/pets/:pet_id", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const { pet_id } = req.params;
    const { base_version, patch } = req.body || {};
    if (!patch || typeof patch !== "object") return res.status(400).json({ error: "patch_required" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        "SELECT * FROM pets WHERE owner_user_id = $1 AND pet_id = $2 FOR UPDATE",
        [owner_user_id, pet_id]
      );
      if (!cur.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }
      const current = cur.rows[0];
      if (base_version != null && Number(base_version) !== Number(current.version)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "conflict", current_version: current.version, current });
      }

      // whitelist fields
      const allowed = ["name","species","breed","sex","birthdate","weight_kg","notes"];
      const next = { ...current };
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
      }

      const upd = await client.query(
        `UPDATE pets SET
          name=$3, species=$4, breed=$5, sex=$6, birthdate=$7, weight_kg=$8, notes=$9,
          version = version + 1,
          updated_at = NOW()
         WHERE owner_user_id=$1 AND pet_id=$2
         RETURNING *`,
        [owner_user_id, pet_id, next.name, next.species, next.breed, next.sex, next.birthdate, next.weight_kg, next.notes]
      );

      await client.query(
        `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version)
         VALUES ($1,$2,'pet.upsert',$3,$4)`,
        [owner_user_id, pet_id, upd.rows[0], upd.rows[0].version]
      );

      await client.query("COMMIT");
      return res.json(upd.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("PATCH /api/pets error", e);
      return res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  // Delete pet
  router.delete("/api/pets/:pet_id", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const { pet_id } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        "SELECT version FROM pets WHERE owner_user_id=$1 AND pet_id=$2 FOR UPDATE",
        [owner_user_id, pet_id]
      );
      if (!cur.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }
      await client.query("DELETE FROM pets WHERE owner_user_id=$1 AND pet_id=$2", [owner_user_id, pet_id]);

      await client.query(
        `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version)
         VALUES ($1,$2,'pet.delete',NULL,$3)`,
        [owner_user_id, pet_id, cur.rows[0].version]
      );

      await client.query("COMMIT");
      return res.status(204).send();
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("DELETE /api/pets error", e);
      return res.status(500).json({ error: "server_error" });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = { petsRouter };
