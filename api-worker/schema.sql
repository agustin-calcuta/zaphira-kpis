CREATE TABLE IF NOT EXISTS users (
  usuario TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('direccion', 'vendedora')),
  vendedora TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  cambiar INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  ultimo_ingreso TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS objetivos (
  mes TEXT NOT NULL,
  alcance TEXT NOT NULL,
  objetivo REAL NOT NULL,
  PRIMARY KEY (mes, alcance)
);

CREATE TABLE IF NOT EXISTS dataset (
  id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiendanube_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usd_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
