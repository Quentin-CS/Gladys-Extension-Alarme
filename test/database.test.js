import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDatabase } from './helpers.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlarmDatabase } from '../src/storage/database.js';

test('migrations are transactional and idempotent', () => {
  const database = memoryDatabase();
  database.migrate();
  assert.equal(database.db.prepare('SELECT count(*) count FROM schema_migrations').get().count, 4);
  assert.equal(database.getState().actualState, 'disarmed');
  database.close();
});

test('event log is paginated and hides admin-only events by default', () => {
  const database = memoryDatabase();
  database.appendEvent({ type: 'visible' });
  database.appendEvent({ type: 'duress', adminOnly: true });
  assert.equal(database.listEvents().total, 1);
  assert.equal(database.listEvents({ includeAdmin: true }).total, 2);
  database.close();
});

test('keypad transactions are claimed once', () => {
  const database = memoryDatabase();
  assert.equal(database.claimTransaction('keypad', 12), true);
  assert.equal(database.claimTransaction('keypad', 12), false);
  database.close();
});

test('a version-1 database upgrades transactionally through every migration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alarm-migration-'));
  const path = join(directory, 'alarm.db');
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1,'2026-01-01T00:00:00Z');
    CREATE TABLE system_state(
      id INTEGER PRIMARY KEY,requested_mode TEXT NOT NULL,actual_state TEXT NOT NULL,
      alarm_latched INTEGER NOT NULL DEFAULT 0,origin_device TEXT,deadline TEXT,timer_kind TEXT,
      mqtt_available INTEGER NOT NULL DEFAULT 0,sirens_active INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT INTO system_state(id,requested_mode,actual_state,updated_at)
      VALUES (1,'night','armed_night','2026-01-01T00:00:00Z');
    CREATE TABLE devices(
      ieee_address TEXT PRIMARY KEY,friendly_name TEXT NOT NULL,model_id TEXT,kind TEXT NOT NULL,
      capabilities TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1,battery REAL,
      battery_low INTEGER NOT NULL DEFAULT 0,tamper INTEGER NOT NULL DEFAULT 0,last_seen TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  legacy.close();
  try {
    const upgraded = new AlarmDatabase(path);
    assert.equal(upgraded.getState().actualState, 'armed_night');
    assert.equal(
      upgraded.db.prepare('SELECT count(*) count FROM schema_migrations').get().count,
      4,
    );
    const columns = upgraded.db
      .prepare('PRAGMA table_info(devices)')
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes('active'));
    assert.ok(columns.includes('offline_alerted'));
    upgraded.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
