export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS system_state(
        id INTEGER PRIMARY KEY CHECK(id = 1), requested_mode TEXT NOT NULL,
        actual_state TEXT NOT NULL, alarm_latched INTEGER NOT NULL DEFAULT 0,
        origin_device TEXT, deadline TEXT, timer_kind TEXT, mqtt_available INTEGER NOT NULL DEFAULT 0,
        sirens_active INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices(
        ieee_address TEXT PRIMARY KEY, friendly_name TEXT NOT NULL, model_id TEXT,
        kind TEXT NOT NULL, capabilities TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1,
        battery REAL, battery_low INTEGER NOT NULL DEFAULT 0, tamper INTEGER NOT NULL DEFAULT 0,
        last_seen TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zones(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, profile TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zone_devices(
        zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        ieee_address TEXT NOT NULL REFERENCES devices(ieee_address) ON DELETE CASCADE,
        PRIMARY KEY(zone_id, ieee_address)
      );
      CREATE TABLE IF NOT EXISTS zone_modes(
        zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE, mode TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, entry_delay INTEGER NOT NULL DEFAULT 0,
        exit_delay INTEGER NOT NULL DEFAULT 0, trigger_mode TEXT NOT NULL DEFAULT 'immediate',
        open_behavior TEXT NOT NULL DEFAULT 'reject', bypass_allowed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(zone_id, mode)
      );
      CREATE TABLE IF NOT EXISTS bypasses(
        ieee_address TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1, duress INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT, schedule TEXT, operations TEXT NOT NULL, modes TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, type TEXT NOT NULL,
        severity TEXT NOT NULL, actor TEXT, device TEXT, details TEXT NOT NULL DEFAULT '{}',
        admin_only INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE TABLE IF NOT EXISTS processed_transactions(
        device TEXT NOT NULL, transaction_id TEXT NOT NULL, processed_at TEXT NOT NULL,
        PRIMARY KEY(device, transaction_id)
      );
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(
        digest TEXT PRIMARY KEY, csrf_digest TEXT NOT NULL, expires_at TEXT NOT NULL,
        generation INTEGER NOT NULL, created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS attempt_limits(
        subject TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
        window_started TEXT NOT NULL, locked_until TEXT
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE devices ADD COLUMN active INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE devices ADD COLUMN offline_alerted INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS siren_settings(
        ieee_address TEXT PRIMARY KEY REFERENCES devices(ieee_address) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0, duration INTEGER NOT NULL DEFAULT 180,
        volume TEXT NOT NULL DEFAULT 'high', strobe INTEGER NOT NULL DEFAULT 1,
        alert_behaviors TEXT NOT NULL DEFAULT '{}'
      );
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS admin_commands(
        id INTEGER PRIMARY KEY AUTOINCREMENT,command TEXT NOT NULL,payload TEXT NOT NULL,
        created_at TEXT NOT NULL,processed_at TEXT,error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_admin_commands_pending ON admin_commands(processed_at,id);
    `,
  },
];
