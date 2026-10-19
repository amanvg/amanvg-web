CREATE TABLE IF NOT EXISTS truck (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  year INTEGER,
  drive TEXT,
  odometer INTEGER,
  use TEXT NOT NULL DEFAULT 'standard'
);

CREATE TABLE IF NOT EXISTS fuel (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  miles INTEGER NOT NULL,
  gallons REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  missed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  date TEXT NOT NULL,
  miles INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  done_by TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS fuel_date ON fuel (date, miles);

-- KPI trees for /kpitree/ (added 2026-10-19); data is the page's version 2 tree JSON.
CREATE TABLE IF NOT EXISTS kpi_trees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated TEXT NOT NULL
);

-- Existing databases (added 2026-10-04):
-- ALTER TABLE fuel ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE fuel ADD COLUMN missed INTEGER NOT NULL DEFAULT 0;
