// Servidor del Reporte 30K Paraíso: guarda en Postgres lo que se sube para que todos lo vean.
// Variables de entorno (Render → Environment):
//   DATABASE_URL     cadena de conexión de Postgres (Internal Database URL)
//   UPLOAD_PASSWORD  contraseña para subir / quitar archivos
//   ALLOWED_ORIGINS  orígenes permitidos (coma), por defecto el sitio estático
const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || "";
const PASSWORD = process.env.UPLOAD_PASSWORD || "";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://reporte-30k-paraiso.onrender.com").split(",").map(s => s.trim()).filter(Boolean);

const pool = DB_URL ? new Pool({
  connectionString: DB_URL,
  // la URL externa de Render exige SSL; la interna no
  ssl: /render\.com/.test(DB_URL) ? { rejectUnauthorized: false } : false,
  max: 4,
}) : null;

let dbReady = false, dbError = null;
async function initDb() {
  if (!pool) { dbError = "DATABASE_URL no configurada"; return; }
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS r30k_files (
      id text PRIMARY KEY, name text NOT NULL, uploaded_at timestamptz, meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      stores jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS r30k_config (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    dbReady = true; dbError = null;
    console.log("Base de datos lista");
  } catch (e) { dbError = e.message; console.error("Error de base de datos:", e.message); setTimeout(initDb, 15000); }
}

// CORS para el sitio estático
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Upload-Key");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "60mb" }));

function sameKey(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function requireKey(req, res, next) {
  if (!PASSWORD) return res.status(503).json({ error: "UPLOAD_PASSWORD no configurada en el servidor" });
  if (!sameKey(req.get("X-Upload-Key"), PASSWORD)) return setTimeout(() => res.status(401).json({ error: "Contraseña incorrecta" }), 800);
  next();
}
function requireDb(req, res, next) {
  if (!dbReady) return res.status(503).json({ error: "Base de datos no disponible: " + (dbError || "iniciando") });
  next();
}
const validId = id => /^[A-Za-z0-9_\-.]{1,150}$/.test(id);

app.get("/api/health", (req, res) => res.json({ ok: true, db: dbReady, dbError, passwordSet: !!PASSWORD }));

app.get("/api/data", requireDb, async (req, res) => {
  try {
    const f = await pool.query("SELECT id, name, uploaded_at, meta, stores FROM r30k_files ORDER BY name");
    const c = await pool.query("SELECT value FROM r30k_config WHERE key = 'estructura'");
    res.json({
      files: f.rows.map(r => ({ id: r.id, name: r.name, uploadedAt: r.uploaded_at, v: r.meta.v || 1, modo: r.meta.modo || "todas", stores: r.stores })),
      estructura: c.rows[0] ? c.rows[0].value : null,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post("/api/login", (req, res) => {
  if (!PASSWORD) return res.status(503).json({ error: "UPLOAD_PASSWORD no configurada en el servidor" });
  if (!sameKey(req.body && req.body.key, PASSWORD)) return setTimeout(() => res.status(401).json({ error: "Contraseña incorrecta" }), 800);
  res.json({ ok: true });
});

app.put("/api/files/:id", requireKey, requireDb, async (req, res) => {
  const id = req.params.id, b = req.body || {};
  if (!validId(id) || !b.name || typeof b.stores !== "object") return res.status(400).json({ error: "Datos inválidos" });
  try {
    await pool.query(
      `INSERT INTO r30k_files (id, name, uploaded_at, meta, stores, updated_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, uploaded_at=EXCLUDED.uploaded_at, meta=EXCLUDED.meta, stores=EXCLUDED.stores, updated_at=now()`,
      [id, String(b.name).slice(0, 200), b.uploadedAt || new Date().toISOString(), JSON.stringify({ v: b.v || 1, modo: b.modo || "todas" }), JSON.stringify(b.stores)]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete("/api/files/:id", requireKey, requireDb, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Id inválido" });
  try { await pool.query("DELETE FROM r30k_files WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.put("/api/estructura", requireKey, requireDb, async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.rows)) return res.status(400).json({ error: "Estructura inválida" });
  try {
    await pool.query(`INSERT INTO r30k_config (key, value, updated_at) VALUES ('estructura', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ source: b.source || "subida", rows: b.rows })]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete("/api/estructura", requireKey, requireDb, async (req, res) => {
  try { await pool.query("DELETE FROM r30k_config WHERE key = 'estructura'"); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// la misma página también se sirve desde el servidor
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => { console.log("Reporte 30K escuchando en", PORT); initDb(); });
