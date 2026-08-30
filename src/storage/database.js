import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './migrations.js';
import { STATES } from '../domain/constants.js';

export class AlarmDatabase {
  constructor(path = process.env.ALARM_DATABASE ?? '/data/alarm.db') {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    for (const migration of migrations) {
      this.db
        .transaction(() => {
          const alreadyApplied = this.db
            .prepare('SELECT 1 FROM schema_migrations WHERE version=?')
            .get(migration.version);
          if (alreadyApplied) return;
          this.db.exec(migration.sql);
          this.db
            .prepare('INSERT INTO schema_migrations VALUES (?, ?)')
            .run(migration.version, new Date().toISOString());
        })
        .immediate();
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO system_state
      (id, requested_mode, actual_state, updated_at) VALUES (1, 'disarmed', ?, ?)`,
      )
      .run(STATES.DISARMED, new Date().toISOString());
  }

  getState() {
    const row = this.db.prepare('SELECT * FROM system_state WHERE id = 1').get();
    return {
      requestedMode: row.requested_mode,
      actualState: row.actual_state,
      alarmLatched: Boolean(row.alarm_latched),
      originDevice: row.origin_device,
      deadline: row.deadline,
      timerKind: row.timer_kind,
      mqttAvailable: Boolean(row.mqtt_available),
      sirensActive: Boolean(row.sirens_active),
      updatedAt: row.updated_at,
    };
  }

  transition(patch, event) {
    return this.db.transaction(() => {
      const current = this.getState();
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      this.db
        .prepare(
          `UPDATE system_state SET requested_mode=?, actual_state=?, alarm_latched=?,
        origin_device=?, deadline=?, timer_kind=?, mqtt_available=?, sirens_active=?, updated_at=? WHERE id=1`,
        )
        .run(
          next.requestedMode,
          next.actualState,
          Number(next.alarmLatched),
          next.originDevice,
          next.deadline,
          next.timerKind,
          Number(next.mqttAvailable),
          Number(next.sirensActive),
          next.updatedAt,
        );
      if (event) this.appendEvent(event);
      return next;
    })();
  }

  appendEvent({
    type,
    severity = 'info',
    actor = null,
    device = null,
    details = {},
    adminOnly = false,
  }) {
    const result = this.db
      .prepare(
        `INSERT INTO events
      (occurred_at,type,severity,actor,device,details,admin_only) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        new Date().toISOString(),
        type,
        severity,
        actor,
        device,
        JSON.stringify(details),
        Number(adminOnly),
      );
    return Number(result.lastInsertRowid);
  }

  listEvents({ page = 1, limit = 50, type, search, includeAdmin = false } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const clauses = includeAdmin ? [] : ['admin_only = 0'];
    const params = {};
    if (type) {
      clauses.push('type = @type');
      params.type = type;
    }
    if (search) {
      clauses.push('(actor LIKE @search OR device LIKE @search OR details LIKE @search)');
      params.search = `%${search}%`;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT count(*) count FROM events ${where}`).get(params).count;
    params.limit = safeLimit;
    params.offset = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;
    const items = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all(params)
      .map((row) => ({
        ...row,
        details: JSON.parse(row.details),
        admin_only: Boolean(row.admin_only),
      }));
    return { items, total, page: Math.max(Number(page) || 1, 1), limit: safeLimit };
  }

  claimTransaction(device, transactionId) {
    if (transactionId === undefined || transactionId === null) return true;
    const result = this.db
      .prepare('INSERT OR IGNORE INTO processed_transactions VALUES (?,?,?)')
      .run(device, String(transactionId), new Date().toISOString());
    return result.changes === 1;
  }

  upsertDevice(device) {
    this.db
      .prepare(
        `INSERT INTO devices
      (ieee_address,friendly_name,model_id,kind,capabilities,available,last_seen,updated_at)
      VALUES (@ieeeAddress,@friendlyName,@modelId,@kind,@capabilities,1,@lastSeen,@updatedAt)
      ON CONFLICT(ieee_address) DO UPDATE SET friendly_name=excluded.friendly_name,
      model_id=excluded.model_id, kind=excluded.kind, capabilities=excluded.capabilities,
      last_seen=excluded.last_seen, updated_at=excluded.updated_at`,
      )
      .run({
        ...device,
        capabilities: JSON.stringify(device.capabilities ?? []),
        lastSeen: device.lastSeen ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
  }

  updateDeviceTelemetry(ieeeAddress, payload, occurredAt = new Date()) {
    const fields = {
      available:
        payload.availability === undefined ? null : payload.availability === 'offline' ? 0 : 1,
      battery: payload.battery === undefined ? null : Number(payload.battery),
      batteryLow: payload.battery_low === undefined ? null : Number(payload.battery_low === true),
      tamper: payload.tamper === undefined ? null : Number(payload.tamper === true),
      active:
        payload.contact !== undefined
          ? Number(payload.contact === false)
          : payload.occupancy !== undefined
            ? Number(payload.occupancy === true)
            : null,
      lastSeen: occurredAt.toISOString(),
      updatedAt: new Date().toISOString(),
      ieeeAddress,
    };
    this.db
      .prepare(
        `UPDATE devices SET
          available=CASE WHEN @available IS NULL THEN available ELSE @available END,
          battery=CASE WHEN @battery IS NULL THEN battery ELSE @battery END,
          battery_low=CASE WHEN @batteryLow IS NULL THEN battery_low ELSE @batteryLow END,
          tamper=CASE WHEN @tamper IS NULL THEN tamper ELSE @tamper END,
          active=CASE WHEN @active IS NULL THEN active ELSE @active END,
          last_seen=@lastSeen,updated_at=@updatedAt,
          offline_alerted=CASE WHEN @available=1 THEN 0 ELSE offline_alerted END
          WHERE ieee_address=@ieeeAddress`,
      )
      .run(fields);
  }

  getDevicePolicy(ieeeAddress, mode) {
    const policies = this.db
      .prepare(
        `SELECT z.id zone_id,z.name zone_name,z.profile,zm.active,zm.entry_delay,
          zm.exit_delay,zm.trigger_mode,zm.open_behavior,zm.bypass_allowed
        FROM zone_devices zd JOIN zones z ON z.id=zd.zone_id
        LEFT JOIN zone_modes zm ON zm.zone_id=z.id AND zm.mode=?
        WHERE zd.ieee_address=? ORDER BY z.id`,
      )
      .all(mode, ieeeAddress);
    const permanent = policies.find((policy) => policy.profile === '24h');
    if (permanent)
      return {
        ...permanent,
        active: 1,
        entry_delay: 0,
        exit_delay: 0,
        trigger_mode: 'immediate',
      };
    const active = policies.filter((policy) => Boolean(policy.active));
    if (!active.length) return null;
    const immediate = active.find((policy) => policy.trigger_mode === 'immediate');
    if (immediate) return immediate;
    return active.reduce((selected, policy) =>
      Number(policy.entry_delay) > Number(selected.entry_delay) ? policy : selected,
    );
  }

  getOpenDevicesForMode(mode) {
    return this.db
      .prepare(
        `SELECT d.ieee_address id,
          CASE WHEN sum(CASE WHEN zm.open_behavior!='bypass' OR zm.bypass_allowed=0
            THEN 1 ELSE 0 END)>0 THEN 'reject' ELSE 'bypass' END openBehavior,
          min(zm.bypass_allowed) bypassAllowed,max(zm.exit_delay) exitDelay
        FROM devices d JOIN zone_devices zd ON zd.ieee_address=d.ieee_address
        JOIN zones z ON z.id=zd.zone_id
        JOIN zone_modes zm ON zm.zone_id=z.id AND zm.mode=?
        WHERE d.active=1 AND zm.active=1 AND z.profile!='24h'
        GROUP BY d.ieee_address`,
      )
      .all(mode);
  }

  assignDeviceToZone(zoneId, ieeeAddress) {
    this.db
      .prepare('INSERT OR IGNORE INTO zone_devices(zone_id,ieee_address) VALUES (?,?)')
      .run(zoneId, ieeeAddress);
  }

  getSetting(key) {
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  }
  setSetting(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,updated_at=excluded.updated_at`,
      )
      .run(key, String(value), new Date().toISOString());
  }
  close() {
    this.db.close();
  }
}
