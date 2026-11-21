-- Inventory state. `value` holds JSON; `meta` holds a small JSON summary so
-- status reads never parse the full payload. `rev` backs compare-and-swap.
CREATE TABLE state (
  key TEXT PRIMARY KEY,            -- 'live' | 'draft' | 'images'
  value TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Every published payload. The primary key makes each version number
-- publishable exactly once, which is what serializes concurrent publishes.
CREATE TABLE versions (
  version INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL,
  count INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);

-- Failed admin logins, for rate limiting (per email and per IP).
CREATE TABLE login_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Admin accounts. Deleting a row revokes that person's sessions at once.
CREATE TABLE admins (
  email TEXT PRIMARY KEY,          -- lowercase
  password_hash TEXT NOT NULL,     -- pbkdf2-sha256$<iterations>$<salt>$<hash>
  created_at TEXT NOT NULL
);
