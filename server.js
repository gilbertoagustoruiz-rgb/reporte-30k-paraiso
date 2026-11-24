// Servidor del Reporte 30K Paraíso: datos en Postgres, usuarios y perfiles con permisos.
// Variables de entorno (Render → Environment):
//   DATABASE_URL     cadena de conexión de Postgres (Internal Database URL)
//   UPLOAD_PASSWORD  clave de instalación: solo sirve para crear el primer ADMIN_SUPER
//   ALLOWED_ORIGINS  orígenes permitidos (coma), por defecto el sitio estático
const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || "";
const SETUP_KEY = process.env.UPLOAD_PASSWORD || "";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://reporte-30k-paraiso.onrender.com").split(",").map(s => s.trim()).filter(Boolean);
const SESSION_HOURS = 12;

// Permisos que puede tener un perfil
const PERMISOS = ["ver_radar", "ver_detalle", "descargar", "subir_datos", "gestionar_usuarios", "gestionar_perfiles"];
const ALL = Object.fromEntries(PERMISOS.map(p => [p, true]));
const PERFILES_BASE = {
  ADMIN_SUPER: { descripcion: "Acceso total: datos, usuarios y perfiles.", permisos: ALL },
  ANALISTA: { descripcion: "Ve los reportes, descarga y sube/quita archivos de venta.", permisos: { ver_radar: true, ver_detalle: true, descargar: true, subir_datos: true, gestionar_usuarios: false, gestionar_perfiles: false } },
  GERENCIA: { descripcion: "Ve los reportes y descarga. No modifica datos.", permisos: { ver_radar: true, ver_detalle: true, descargar: true, subir_datos: false, gestionar_usuarios: false, gestionar_perfiles: false } },
};

const pool = DB_URL ? new Pool({
  connectionString: DB_URL,
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
    await pool.query(`CREATE TABLE IF NOT EXISTS r30k_perfiles (
      nombre text PRIMARY KEY, descripcion text NOT NULL DEFAULT '', permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS r30k_users (
      id serial PRIMARY KEY, nombre text NOT NULL, dni text NOT NULL UNIQUE, pass_hash text NOT NULL,
      perfil text NOT NULL REFERENCES r30k_perfiles(nombre) ON UPDATE CASCADE, activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), last_login timestamptz)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS r30k_sessions (
      token text PRIMARY KEY, user_id integer NOT NULL REFERENCES r30k_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL)`);
    for (const [nombre, p] of Object.entries(PERFILES_BASE)) {
      await pool.query(`INSERT INTO r30k_perfiles (nombre, descripcion, permisos) VALUES ($1,$2,$3) ON CONFLICT (nombre) DO NOTHING`,
        [nombre, p.descripcion, JSON.stringify(p.permisos)]);
    }
    await pool.query(`DELETE FROM r30k_sessions WHERE expires_at < now()`);
    dbReady = true; dbError = null;
    console.log("Base de datos lista");
  } catch (e) { dbError = e.message; console.error("Error de base de datos:", e.message); setTimeout(initDb, 15000); }
}

// ---------- utilidades de seguridad ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `scrypt$${salt}$${h}`;
}
function checkPassword(pw, stored) {
  const [alg, salt, h] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !h) return false;
  const a = Buffer.from(h, "hex"), b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sameKey(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const validDni = d => /^[0-9A-Za-z]{8,12}$/.test(String(d || ""));
const validPerfil = n => /^[A-Z0-9_]{3,30}$/.test(String(n || ""));
const permsOf = (perfil, permisos) => perfil === "ADMIN_SUPER" ? { ...ALL } : Object.fromEntries(PERMISOS.map(p => [p, !!(permisos && permisos[p])]));

// límite simple de intentos fallidos de inicio de sesión (por IP)
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 15 * 60e3; }
function addFail(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

// ---------- middleware ----------
app.set("trust proxy", true);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "60mb" }));

function requireDb(req, res, next) {
  if (!dbReady) return res.status(503).json({ error: "Base de datos no disponible: " + (dbError || "iniciando") });
  next();
}
async function auth(req, res, next) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.get("Authorization") || "");
  if (!m) return res.status(401).json({ error: "Inicia sesión" });
  try {
    const r = await pool.query(`SELECT u.id, u.nombre, u.dni, u.perfil, u.activo, p.permisos
      FROM r30k_sessions s JOIN r30k_users u ON u.id = s.user_id JOIN r30k_perfiles p ON p.nombre = u.perfil
      WHERE s.token = $1 AND s.expires_at > now()`, [m[1]]);
    const u = r.rows[0];
    if (!u || !u.activo) return res.status(401).json({ error: "Sesión vencida: vuelve a iniciar sesión" });
    req.user = { id: u.id, nombre: u.nombre, dni: u.dni, perfil: u.perfil, permisos: permsOf(u.perfil, u.permisos) };
    req.token = m[1];
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
}
const can = (...perms) => (req, res, next) => perms.some(p => req.user.permisos[p]) ? next() : res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción" });

async function newSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(`INSERT INTO r30k_sessions (token, user_id, expires_at) VALUES ($1,$2, now() + interval '${SESSION_HOURS} hours')`, [token, userId]);
  await pool.query(`UPDATE r30k_users SET last_login = now() WHERE id = $1`, [userId]);
  return token;
}
async function userPayload(id) {
  const r = await pool.query(`SELECT u.id, u.nombre, u.dni, u.perfil, p.permisos FROM r30k_users u JOIN r30k_perfiles p ON p.nombre = u.perfil WHERE u.id = $1`, [id]);
  const u = r.rows[0];
  return { id: u.id, nombre: u.nombre, dni: u.dni, perfil: u.perfil, permisos: permsOf(u.perfil, u.permisos) };
}

// ---------- estado y sesión ----------
app.get("/api/health", (req, res) => res.json({ ok: true, db: dbReady, dbError, setupKeySet: !!SETUP_KEY }));

app.get("/api/auth/status", requireDb, async (req, res) => {
  const r = await pool.query("SELECT count(*)::int AS n FROM r30k_users");
  res.json({ hasUsers: r.rows[0].n > 0, setupKeySet: !!SETUP_KEY });
});

// primer administrador: solo si no hay usuarios, con la clave de instalación
app.post("/api/auth/setup", requireDb, async (req, res) => {
  const { nombre, dni, password, clave } = req.body || {};
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
  try {
    const r = await pool.query("SELECT count(*)::int AS n FROM r30k_users");
    if (r.rows[0].n > 0) return res.status(409).json({ error: "Ya existen usuarios: inicia sesión" });
    if (!SETUP_KEY) return res.status(503).json({ error: "Falta UPLOAD_PASSWORD en el servidor" });
    if (!sameKey(clave, SETUP_KEY)) { addFail(ip); return setTimeout(() => res.status(401).json({ error: "Clave de instalación incorrecta" }), 800); }
    if (!String(nombre || "").trim() || !validDni(dni) || String(password || "").length < 8) return res.status(400).json({ error: "Completa nombre, DNI (8 a 12 caracteres) y contraseña (mínimo 8)" });
    const ins = await pool.query(`INSERT INTO r30k_users (nombre, dni, pass_hash, perfil) VALUES ($1,$2,$3,'ADMIN_SUPER') RETURNING id`,
      [String(nombre).trim().slice(0, 120), String(dni).trim(), hashPassword(password)]);
    const token = await newSession(ins.rows[0].id);
    res.json({ token, user: await userPayload(ins.rows[0].id) });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/login", requireDb, async (req, res) => {
  const { dni, password } = req.body || {};
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: "Demasiados intentos fallidos. Espera 15 minutos." });
  try {
    const r = await pool.query("SELECT id, pass_hash, activo FROM r30k_users WHERE dni = $1", [String(dni || "").trim()]);
    const u = r.rows[0];
    if (!u || !checkPassword(password, u.pass_hash)) { addFail(ip); return setTimeout(() => res.status(401).json({ error: "DNI o contraseña incorrectos" }), 600); }
    if (!u.activo) return res.status(403).json({ error: "Usuario desactivado. Consulta con el administrador." });
    fails.delete(ip);
    const token = await newSession(u.id);
    res.json({ token, user: await userPayload(u.id) });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get("/api/auth/me", requireDb, auth, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", requireDb, auth, async (req, res) => {
  await pool.query("DELETE FROM r30k_sessions WHERE token = $1", [req.token]);
  res.json({ ok: true });
});
app.put("/api/auth/password", requireDb, auth, async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (String(nueva || "").length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
  const r = await pool.query("SELECT pass_hash FROM r30k_users WHERE id = $1", [req.user.id]);
  if (!checkPassword(actual, r.rows[0].pass_hash)) return res.status(401).json({ error: "La contraseña actual no es correcta" });
  await pool.query("UPDATE r30k_users SET pass_hash = $1 WHERE id = $2", [hashPassword(nueva), req.user.id]);
  await pool.query("DELETE FROM r30k_sessions WHERE user_id = $1 AND token <> $2", [req.user.id, req.token]);
  res.json({ ok: true });
});

// ---------- datos del reporte ----------
app.get("/api/data", requireDb, auth, can("ver_radar", "ver_detalle", "subir_datos"), async (req, res) => {
  try {
    const f = await pool.query("SELECT id, name, uploaded_at, meta, stores FROM r30k_files ORDER BY name");
    const c = await pool.query("SELECT value FROM r30k_config WHERE key = 'estructura'");
    res.json({
      files: f.rows.map(r => ({ id: r.id, name: r.name, uploadedAt: r.uploaded_at, v: r.meta.v || 1, modo: r.meta.modo || "todas", by: r.meta.by || null, stores: r.stores })),
      estructura: c.rows[0] ? c.rows[0].value : null,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

const validId = id => /^[A-Za-z0-9_\-.]{1,150}$/.test(id);
app.put("/api/files/:id", requireDb, auth, can("subir_datos"), async (req, res) => {
  const id = req.params.id, b = req.body || {};
  if (!validId(id) || !b.name || typeof b.stores !== "object") return res.status(400).json({ error: "Datos inválidos" });
  try {
    await pool.query(
      `INSERT INTO r30k_files (id, name, uploaded_at, meta, stores, updated_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, uploaded_at=EXCLUDED.uploaded_at, meta=EXCLUDED.meta, stores=EXCLUDED.stores, updated_at=now()`,
      [id, String(b.name).slice(0, 200), b.uploadedAt || new Date().toISOString(), JSON.stringify({ v: b.v || 1, modo: b.modo || "todas", by: req.user.nombre }), JSON.stringify(b.stores)]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/files/:id", requireDb, auth, can("subir_datos"), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Id inválido" });
  try { await pool.query("DELETE FROM r30k_files WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.put("/api/estructura", requireDb, auth, can("subir_datos"), async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.rows)) return res.status(400).json({ error: "Estructura inválida" });
  try {
    await pool.query(`INSERT INTO r30k_config (key, value, updated_at) VALUES ('estructura', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ source: b.source || "subida", rows: b.rows })]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/estructura", requireDb, auth, can("subir_datos"), async (req, res) => {
  try { await pool.query("DELETE FROM r30k_config WHERE key = 'estructura'"); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ---------- usuarios ----------
async function adminsActivos(exceptId) {
  const r = await pool.query("SELECT count(*)::int AS n FROM r30k_users WHERE perfil = 'ADMIN_SUPER' AND activo AND id <> $1", [exceptId || 0]);
  return r.rows[0].n;
}
app.get("/api/users", requireDb, auth, can("gestionar_usuarios"), async (req, res) => {
  const r = await pool.query("SELECT id, nombre, dni, perfil, activo, created_at, last_login FROM r30k_users ORDER BY nombre");
  res.json({ users: r.rows });
});
app.post("/api/users", requireDb, auth, can("gestionar_usuarios"), async (req, res) => {
  const { nombre, dni, password, perfil } = req.body || {};
  if (!String(nombre || "").trim()) return res.status(400).json({ error: "Escribe el nombre" });
  if (!validDni(dni)) return res.status(400).json({ error: "El DNI debe tener entre 8 y 12 caracteres, solo letras y números" });
  if (String(password || "").length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  try {
    const p = await pool.query("SELECT 1 FROM r30k_perfiles WHERE nombre = $1", [perfil]);
    if (!p.rowCount) return res.status(400).json({ error: "Perfil no válido" });
    const r = await pool.query(`INSERT INTO r30k_users (nombre, dni, pass_hash, perfil) VALUES ($1,$2,$3,$4) RETURNING id`,
      [String(nombre).trim().slice(0, 120), String(dni).trim(), hashPassword(password), perfil]);
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ya existe un usuario con ese DNI" });
    console.error(e); res.status(500).json({ error: e.message });
  }
});
app.put("/api/users/:id", requireDb, auth, can("gestionar_usuarios"), async (req, res) => {
  const id = parseInt(req.params.id, 10), { nombre, perfil, activo, password } = req.body || {};
  try {
    const cur = (await pool.query("SELECT perfil, activo FROM r30k_users WHERE id = $1", [id])).rows[0];
    if (!cur) return res.status(404).json({ error: "Usuario no encontrado" });
    const quitaAdmin = cur.perfil === "ADMIN_SUPER" && cur.activo && ((perfil && perfil !== "ADMIN_SUPER") || activo === false);
    if (quitaAdmin && await adminsActivos(id) === 0) return res.status(400).json({ error: "Debe quedar al menos un ADMIN_SUPER activo" });
    if (id === req.user.id && activo === false) return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
    if (perfil) { const p = await pool.query("SELECT 1 FROM r30k_perfiles WHERE nombre = $1", [perfil]); if (!p.rowCount) return res.status(400).json({ error: "Perfil no válido" }); }
    if (password != null && password !== "" && String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    await pool.query(`UPDATE r30k_users SET nombre = COALESCE($2, nombre), perfil = COALESCE($3, perfil), activo = COALESCE($4, activo) WHERE id = $1`,
      [id, nombre ? String(nombre).trim().slice(0, 120) : null, perfil || null, typeof activo === "boolean" ? activo : null]);
    if (password) {
      await pool.query("UPDATE r30k_users SET pass_hash = $2 WHERE id = $1", [id, hashPassword(password)]);
      await pool.query("DELETE FROM r30k_sessions WHERE user_id = $1", [id]);
    }
    if (activo === false) await pool.query("DELETE FROM r30k_sessions WHERE user_id = $1", [id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/users/:id", requireDb, auth, can("gestionar_usuarios"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
  try {
    const cur = (await pool.query("SELECT perfil, activo FROM r30k_users WHERE id = $1", [id])).rows[0];
    if (!cur) return res.status(404).json({ error: "Usuario no encontrado" });
    if (cur.perfil === "ADMIN_SUPER" && cur.activo && await adminsActivos(id) === 0) return res.status(400).json({ error: "Debe quedar al menos un ADMIN_SUPER activo" });
    await pool.query("DELETE FROM r30k_users WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ---------- perfiles ----------
app.get("/api/perfiles", requireDb, auth, async (req, res) => {
  const r = await pool.query(`SELECT p.nombre, p.descripcion, p.permisos, (SELECT count(*)::int FROM r30k_users u WHERE u.perfil = p.nombre) AS usuarios
    FROM r30k_perfiles p ORDER BY CASE p.nombre WHEN 'ADMIN_SUPER' THEN 0 WHEN 'ANALISTA' THEN 1 WHEN 'GERENCIA' THEN 2 ELSE 3 END, p.nombre`);
  res.json({ permisos: PERMISOS, perfiles: r.rows.map(p => ({ ...p, permisos: permsOf(p.nombre, p.permisos), bloqueado: p.nombre === "ADMIN_SUPER" })) });
});
app.post("/api/perfiles", requireDb, auth, can("gestionar_perfiles"), async (req, res) => {
  const { nombre, descripcion, permisos } = req.body || {};
  const n = String(nombre || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!validPerfil(n)) return res.status(400).json({ error: "Nombre de perfil: 3 a 30 caracteres, letras, números y guion bajo" });
  try {
    await pool.query(`INSERT INTO r30k_perfiles (nombre, descripcion, permisos) VALUES ($1,$2,$3)`, [n, String(descripcion || "").slice(0, 200), JSON.stringify(permsOf(n, permisos))]);
    res.json({ ok: true, nombre: n });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ya existe un perfil con ese nombre" });
    console.error(e); res.status(500).json({ error: e.message });
  }
});
app.put("/api/perfiles/:nombre", requireDb, auth, can("gestionar_perfiles"), async (req, res) => {
  const n = req.params.nombre, { descripcion, permisos } = req.body || {};
  if (n === "ADMIN_SUPER" && permisos) return res.status(400).json({ error: "ADMIN_SUPER siempre tiene todos los permisos" });
  try {
    const r = await pool.query(`UPDATE r30k_perfiles SET descripcion = COALESCE($2, descripcion), permisos = COALESCE($3, permisos), updated_at = now() WHERE nombre = $1`,
      [n, descripcion != null ? String(descripcion).slice(0, 200) : null, permisos ? JSON.stringify(permsOf(n, permisos)) : null]);
    if (!r.rowCount) return res.status(404).json({ error: "Perfil no encontrado" });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/perfiles/:nombre", requireDb, auth, can("gestionar_perfiles"), async (req, res) => {
  const n = req.params.nombre;
  if (PERFILES_BASE[n]) return res.status(400).json({ error: "Los perfiles ADMIN_SUPER, ANALISTA y GERENCIA no se pueden eliminar" });
  try {
    const u = await pool.query("SELECT count(*)::int AS n FROM r30k_users WHERE perfil = $1", [n]);
    if (u.rows[0].n) return res.status(400).json({ error: `Hay ${u.rows[0].n} usuario(s) con este perfil: cámbialos primero` });
    await pool.query("DELETE FROM r30k_perfiles WHERE nombre = $1", [n]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// la misma página también se sirve desde el servidor
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => { console.log("Reporte 30K escuchando en", PORT); initDb(); });
