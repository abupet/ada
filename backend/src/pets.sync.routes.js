// backend/src/pets.sync.routes.js v1
const express = require("express");
const { getPool } = require("./db");

/**
 * Offline-first sync:
 * - push: client sends ops from outbox
 * - pull: client asks for changes since cursor
 *
 * This uses pet_changes.change_id as cursor.
 */
function petsSyncRouter({ requireAuth }) {
  const router = express.Router();
  const pool = getPool();

  // PULL changes since cursor
  router.get("/api/sync/pets/pull", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const since = Number(req.query.since || 0);
    const device_id = String(req.query.device_id || "unknown");

    const { rows } = await pool.query(
      `SELECT change_id, change_type, pet_id, record, version
       FROM pet_changes
       WHERE owner_user_id = $1 AND change_id > $2
       ORDER BY change_id ASC
       LIMIT 500`,
      [owner_user_id, since]
    );

    const next_cursor = rows.length ? rows[rows.length - 1].change_id : since;

    const changes = rows.map((r) => {
      if (r.change_type === "pet.delete") {
        return { change_id: r.change_id, type: "pet.delete", pet_id: r.pet_id };
      }
      return {
        change_id: r.change_id,
        type: "pet.upsert",
        pet_id: r.pet_id,
        record: r.record,
        version: r.version,
      };
    });

    res.json({ next_cursor, device_id, changes });
  });

  // PUSH ops
  router.post("/api/sync/pets/push", requireAuth, async (req, res) => {
    const owner_user_id = req.user?.sub;
    const device_id = String(req.body.device_id || "unknown");
    const ops = Array.isArray(req.body.ops) ? req.body.ops : [];

    const accepted = [];
    const rejected = [];

    for (const op of ops) {
      const { op_id, type, pet_id, base_version, patch, client_ts } = op || {};
      if (!op_id || !type || !pet_id) {
        rejected.push({ op_id: op_id || null, reason: "invalid_op" });
        continue;
      }

      if (type !== "pet.upsert" && type !== "pet.delete") {
        rejected.push({ op_id, reason: "unsupported_type" });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const cur = await client.query(
          "SELECT * FROM pets WHERE owner_user_id=$1 AND pet_id=$2 FOR UPDATE",
          [owner_user_id, pet_id]
        );

        if (type === "pet.delete") {
          if (!cur.rows[0]) {
            // idempotent delete: accept
            accepted.push(op_id);
            await client.query(
              `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version, client_ts, device_id, op_id)
               VALUES ($1,$2,'pet.delete',NULL,NULL,$3,$4,$5)`,
              [owner_user_id, pet_id, client_ts || null, device_id, op_id]
            );
            await client.query("COMMIT");
            continue;
          }

          await client.query("DELETE FROM pets WHERE owner_user_id=$1 AND pet_id=$2", [owner_user_id, pet_id]);

          await client.query(
            `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version, client_ts, device_id, op_id)
             VALUES ($1,$2,'pet.delete',NULL,$3,$4,$5,$6)`,
            [owner_user_id, pet_id, cur.rows[0].version, client_ts || null, device_id, op_id]
          );

          await client.query("COMMIT");
          accepted.push(op_id);
          continue;
        }

        // upsert
        if (cur.rows[0]) {
          const current = cur.rows[0];
          if (base_version != null && Number(base_version) !== Number(current.version)) {
            await client.query("ROLLBACK");
            rejected.push({ op_id, reason: "conflict", current_version: current.version });
            continue;
          }

          const allowed = ["name","species","breed","sex","birthdate","weight_kg","notes"];
          const next = { ...current };
          for (const k of allowed) {
            if (patch && Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
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
            `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version, client_ts, device_id, op_id)
             VALUES ($1,$2,'pet.upsert',$3,$4,$5,$6,$7)`,
            [owner_user_id, pet_id, upd.rows[0], upd.rows[0].version, client_ts || null, device_id, op_id]
          );

          await client.query("COMMIT");
          accepted.push(op_id);
        } else {
          // create
          const record = {
            pet_id,
            owner_user_id,
            name: patch?.name || "Unnamed",
            species: patch?.species || "unknown",
            breed: patch?.breed ?? null,
            sex: patch?.sex ?? null,
            birthdate: patch?.birthdate ?? null,
            weight_kg: patch?.weight_kg ?? null,
            notes: patch?.notes ?? null,
          };

          const ins = await client.query(
            `INSERT INTO pets (pet_id, owner_user_id, name, species, breed, sex, birthdate, weight_kg, notes, version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
             RETURNING *`,
            [record.pet_id, owner_user_id, record.name, record.species, record.breed, record.sex, record.birthdate, record.weight_kg, record.notes]
          );

          await client.query(
            `INSERT INTO pet_changes (owner_user_id, pet_id, change_type, record, version, client_ts, device_id, op_id)
             VALUES ($1,$2,'pet.upsert',$3,$4,$5,$6,$7)`,
            [owner_user_id, pet_id, ins.rows[0], ins.rows[0].version, client_ts || null, device_id, op_id]
          );

          await client.query("COMMIT");
          accepted.push(op_id);
        }
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("sync push op error", e);
        rejected.push({ op_id: op_id || null, reason: "server_error" });
      } finally {
        client.release();
      }
    }

    res.json({ accepted, rejected });
  });

  return router;
}

module.exports = { petsSyncRouter };
