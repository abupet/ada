// backend/src/db.js v1
const { Pool } = require("pg");

/**
 * Render Postgres often requires SSL. node-postgres accepts `ssl: { rejectUnauthorized: false }`.
 * For local dev, you can omit SSL or set PGSSLMODE=disable.
 */
function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  const ssl =
    process.env.PGSSLMODE === "disable" || isLocal
      ? false
      : { rejectUnauthorized: false };

  return new Pool({
    connectionString: url,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 5),
  });
}

let _pool;
function getPool() {
  if (!_pool) _pool = makePool();
  return _pool;
}

module.exports = { getPool };
