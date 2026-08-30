import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { AlarmDatabase } from '../src/storage/database.js';
import {
  constantTimeEqual,
  hashSecret,
  opaqueToken,
  tokenDigest,
  verifySecret,
} from '../src/security/secrets.js';
import { PinService } from '../src/security/pins.js';
import { CommandProcessor } from '../src/domain/command-processor.js';
import { loadOrCreateInternalSecret, saveInternalSecret } from '../src/security/internal-secret.js';
import { decryptBackup, encryptBackup, exportData, restoreData } from '../src/security/backup.js';

const database = new AlarmDatabase();
const app = express();
const port = Number(process.env.PORT ?? 3000);
const pepper = loadOrCreateInternalSecret();
const attempts = new Map();
const pins = new PinService({ database, pepper });
const commandQueue = new CommandProcessor({ database, engine: null });

app.disable('x-powered-by');
app.use(
  helmet({
    // The companion is deliberately HTTP-only on the LAN. HSTS or CSP's HTTPS
    // upgrade would make the supervisor-provided local URL unusable.
    hsts: false,
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
  }),
);
app.use(express.json({ limit: '256kb' }));
app.use(express.static(new URL('./public', import.meta.url).pathname, { index: 'index.html' }));

const cookies = (request) =>
  Object.fromEntries(
    String(request.headers.cookie ?? '')
      .split(';')
      .filter(Boolean)
      .map((item) => item.trim().split(/=(.*)/s).slice(0, 2).map(decodeURIComponent)),
  );
const setCookie = (response, name, value, maxAge) =>
  response.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
  );

function authenticate(request, response, next) {
  const token = cookies(request).alarm_session;
  const session =
    token && database.db.prepare('SELECT * FROM sessions WHERE digest=?').get(tokenDigest(token));
  const generation = Number(database.getSetting('session_generation') ?? 0);
  if (!session || session.generation !== generation || new Date(session.expires_at) <= new Date())
    return response.status(401).json({ error: 'authentication_required' });
  request.session = session;
  return next();
}

function csrf(request, response, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
  const token = request.headers['x-csrf-token'];
  if (!token || !constantTimeEqual(tokenDigest(token), request.session.csrf_digest))
    return response.status(403).json({ error: 'invalid_csrf' });
  return next();
}

app.post('/api/login', async (request, response) => {
  const key = request.ip;
  const now = Date.now();
  const record = attempts.get(key) ?? { count: 0, reset: now + 15 * 60_000 };
  if (now > record.reset) {
    record.count = 0;
    record.reset = now + 15 * 60_000;
  }
  if (record.count >= 5) return response.status(429).json({ error: 'temporarily_locked' });
  const hash = database.getSetting('admin_password_hash');
  if (!hash || !(await verifySecret(String(request.body.password ?? ''), hash, pepper))) {
    record.count += 1;
    attempts.set(key, record);
    database.appendEvent({
      type: 'admin_login_failed',
      severity: 'warning',
      details: { attempts: record.count },
    });
    if (record.count === 5) commandQueue.enqueue('notify', { type: 'invalid_codes' });
    return response.status(401).json({ error: 'invalid_credentials' });
  }
  attempts.delete(key);
  database.appendEvent({ type: 'admin_login', actor: 'admin' });
  const token = opaqueToken();
  const csrfToken = opaqueToken();
  const maxAge = 3600;
  database.db
    .prepare('INSERT INTO sessions VALUES (?,?,?,?,?)')
    .run(
      tokenDigest(token),
      tokenDigest(csrfToken),
      new Date(now + maxAge * 1000).toISOString(),
      Number(database.getSetting('session_generation') ?? 0),
      new Date().toISOString(),
    );
  setCookie(response, 'alarm_session', token, maxAge);
  return response.json({ csrfToken, expiresIn: maxAge });
});

app.use('/api', authenticate, csrf);
app.get('/api/overview', (_request, response) => {
  const counts = database.db
    .prepare('SELECT kind, count(*) count FROM devices GROUP BY kind')
    .all();
  response.json({
    state: database.getState(),
    devices: Object.fromEntries(counts.map((r) => [r.kind, r.count])),
  });
});
app.post('/api/control', (request, response) => {
  const mode = request.body.mode;
  if (!['disarmed', 'away', 'day', 'night'].includes(mode))
    return response.status(400).json({ error: 'invalid_mode' });
  const id = commandQueue.enqueue(mode === 'disarmed' ? 'disarm' : 'arm', { mode });
  database.appendEvent({ type: 'admin_command_queued', actor: 'admin', details: { id, mode } });
  response.status(202).json({ id });
});
app.get('/api/devices', (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
  const page = Math.max(Number(request.query.page) || 1, 1);
  const search = `%${request.query.search ?? ''}%`;
  const items = database.db
    .prepare(
      'SELECT * FROM devices WHERE friendly_name LIKE ? OR model_id LIKE ? ORDER BY friendly_name LIMIT ? OFFSET ?',
    )
    .all(search, search, limit, (page - 1) * limit)
    .map((row) => ({ ...row, capabilities: JSON.parse(row.capabilities) }));
  const total = database.db
    .prepare('SELECT count(*) count FROM devices WHERE friendly_name LIKE ? OR model_id LIKE ?')
    .get(search, search).count;
  response.json({ items, total, page, limit });
});
app.get('/api/events', (request, response) =>
  response.json(database.listEvents({ ...request.query, includeAdmin: true })),
);
app.get('/api/events-export', (_request, response) => {
  response.setHeader('Content-Disposition', 'attachment; filename="alarm-events.ndjson"');
  response.type('application/x-ndjson');
  for (const row of database.db.prepare('SELECT * FROM events ORDER BY id').iterate()) {
    response.write(`${JSON.stringify({ ...row, details: JSON.parse(row.details) })}\n`);
  }
  response.end();
});
app.get('/api/keypads', (_request, response) => {
  const items = database.db
    .prepare(
      "SELECT ieee_address,friendly_name,model_id,battery,battery_low,tamper,available,last_seen FROM devices WHERE kind='keypad' ORDER BY friendly_name",
    )
    .all();
  response.json({ items, total: items.length });
});
app.get('/api/health', (_request, response) => {
  const offline = database.db
    .prepare('SELECT ieee_address,friendly_name,kind,last_seen FROM devices WHERE available=0')
    .all();
  const batteryLow = database.db
    .prepare('SELECT ieee_address,friendly_name,kind,battery FROM devices WHERE battery_low=1')
    .all();
  let databaseBytes = 0;
  try {
    databaseBytes = statSync(database.db.name).size;
  } catch {
    // In-memory databases and an early startup have no stat-able file.
  }
  response.json({
    mqttAvailable: database.getState().mqttAvailable,
    offline,
    batteryLow,
    databaseBytes,
  });
});
app.put('/api/settings/offline-timeout/:kind', (request, response) => {
  if (!/^[a-z-]{2,30}$/.test(request.params.kind))
    return response.status(400).json({ error: 'invalid_device_kind' });
  const seconds = Number(request.body.seconds);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 604800)
    return response.status(400).json({ error: 'invalid_timeout' });
  database.setSetting(`offline_timeout_${request.params.kind}`, seconds);
  database.appendEvent({
    type: 'offline_timeout_updated',
    actor: 'admin',
    details: { kind: request.params.kind, seconds },
  });
  response.status(204).end();
});
app.get('/api/zones', (_request, response) => {
  const zones = database.db.prepare('SELECT * FROM zones ORDER BY name').all();
  for (const zone of zones) {
    zone.devices = database.db
      .prepare('SELECT ieee_address FROM zone_devices WHERE zone_id=?')
      .all(zone.id)
      .map((row) => row.ieee_address);
    zone.modes = database.db.prepare('SELECT * FROM zone_modes WHERE zone_id=?').all(zone.id);
  }
  response.json({ items: zones, total: zones.length });
});
app.post('/api/zones', (request, response) => {
  const profiles = ['perimeter', 'interior', 'entry', '24h', 'tamper'];
  if (!request.body.name || !profiles.includes(request.body.profile))
    return response.status(400).json({ error: 'invalid_zone' });
  const result = database.db
    .prepare('INSERT INTO zones(name,profile) VALUES (?,?)')
    .run(request.body.name, request.body.profile);
  for (const mode of ['away', 'day', 'night'])
    database.db
      .prepare(
        `INSERT INTO zone_modes
    (zone_id,mode,active,entry_delay,exit_delay,trigger_mode,open_behavior,bypass_allowed) VALUES (?,?,1,0,0,'immediate','reject',0)`,
      )
      .run(result.lastInsertRowid, mode);
  database.appendEvent({
    type: 'zone_created',
    actor: 'admin',
    details: { name: request.body.name },
  });
  response.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.delete('/api/zones/:id', (request, response) => {
  if (request.body.confirmation !== 'DELETE')
    return response.status(400).json({ error: 'strong_confirmation_required' });
  const zone = database.db.prepare('SELECT name FROM zones WHERE id=?').get(request.params.id);
  if (!zone) return response.status(404).json({ error: 'zone_not_found' });
  database.db.prepare('DELETE FROM zones WHERE id=?').run(request.params.id);
  database.appendEvent({
    type: 'zone_deleted',
    actor: 'admin',
    details: { zoneId: Number(request.params.id), name: zone.name },
  });
  response.status(204).end();
});
app.put('/api/zones/:id/modes/:mode', (request, response) => {
  if (!['away', 'day', 'night'].includes(request.params.mode))
    return response.status(400).json({ error: 'invalid_mode' });
  const input = request.body;
  database.db
    .prepare(
      `UPDATE zone_modes SET active=?,entry_delay=?,exit_delay=?,trigger_mode=?,open_behavior=?,bypass_allowed=? WHERE zone_id=? AND mode=?`,
    )
    .run(
      Number(Boolean(input.active)),
      Math.max(0, Number(input.entryDelay) || 0),
      Math.max(0, Number(input.exitDelay) || 0),
      input.triggerMode === 'delayed' ? 'delayed' : 'immediate',
      input.openBehavior === 'bypass' ? 'bypass' : 'reject',
      Number(Boolean(input.bypassAllowed)),
      request.params.id,
      request.params.mode,
    );
  database.appendEvent({
    type: 'zone_mode_updated',
    actor: 'admin',
    details: { zoneId: request.params.id, mode: request.params.mode },
  });
  response.status(204).end();
});
app.put('/api/zones/:id/devices/:ieeeAddress', (request, response) => {
  const device = database.db
    .prepare('SELECT ieee_address FROM devices WHERE ieee_address=?')
    .get(request.params.ieeeAddress);
  if (!device) return response.status(404).json({ error: 'device_not_found' });
  database.assignDeviceToZone(request.params.id, request.params.ieeeAddress);
  database.appendEvent({
    type: 'zone_device_assigned',
    actor: 'admin',
    device: request.params.ieeeAddress,
    details: { zoneId: request.params.id },
  });
  response.status(204).end();
});
app.delete('/api/zones/:id/devices/:ieeeAddress', (request, response) => {
  database.db
    .prepare('DELETE FROM zone_devices WHERE zone_id=? AND ieee_address=?')
    .run(request.params.id, request.params.ieeeAddress);
  database.appendEvent({
    type: 'zone_device_unassigned',
    actor: 'admin',
    device: request.params.ieeeAddress,
    details: { zoneId: request.params.id },
  });
  response.status(204).end();
});
app.post('/api/users', async (request, response) => {
  try {
    const input = request.body;
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 80)
      return response.status(400).json({ error: 'invalid_user_name' });
    const allowedOperations = new Set(['arm', 'disarm']);
    const allowedModes = new Set(['away', 'day', 'night']);
    if (
      !Array.isArray(input.operations) ||
      input.operations.length === 0 ||
      input.operations.some((operation) => !allowedOperations.has(operation)) ||
      !Array.isArray(input.modes) ||
      input.modes.length === 0 ||
      input.modes.some((mode) => !allowedModes.has(mode))
    )
      return response.status(400).json({ error: 'invalid_permissions' });
    const id = await pins.create({ ...input, name: input.name.trim() });
    response.status(201).json({ id });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});
app.put('/api/users/:id/status', (request, response) => {
  const result = database.db
    .prepare('UPDATE users SET active=?,updated_at=? WHERE id=?')
    .run(Number(Boolean(request.body.active)), new Date().toISOString(), request.params.id);
  if (!result.changes) return response.status(404).json({ error: 'user_not_found' });
  database.appendEvent({
    type: request.body.active ? 'user_enabled' : 'user_disabled',
    actor: 'admin',
    details: { userId: Number(request.params.id) },
  });
  response.status(204).end();
});
app.get('/api/users', (_request, response) => {
  const items = database.db
    .prepare(
      'SELECT id,name,active,duress,expires_at,schedule,operations,modes,created_at,updated_at FROM users ORDER BY name',
    )
    .all();
  response.json({ items, total: items.length });
});
app.get('/api/sirens', (_request, response) => {
  const items = database.db
    .prepare(
      `SELECT d.ieee_address,d.friendly_name,d.capabilities,d.available,
        coalesce(s.enabled,0) enabled,coalesce(s.duration,180) duration,
        coalesce(s.volume,'high') volume,coalesce(s.strobe,1) strobe,
        coalesce(s.alert_behaviors,'{}') alert_behaviors
      FROM devices d LEFT JOIN siren_settings s ON s.ieee_address=d.ieee_address
      WHERE d.kind='siren' ORDER BY d.friendly_name`,
    )
    .all()
    .map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      strobe: Boolean(row.strobe),
      capabilities: JSON.parse(row.capabilities),
      alert_behaviors: JSON.parse(row.alert_behaviors),
    }));
  response.json({
    items,
    total: items.length,
    panicMode: database.getSetting('panic_mode') ?? 'audible',
  });
});
app.put('/api/sirens/:ieeeAddress', (request, response) => {
  const input = request.body;
  const device = database.db
    .prepare("SELECT ieee_address FROM devices WHERE ieee_address=? AND kind='siren'")
    .get(request.params.ieeeAddress);
  if (!device) return response.status(404).json({ error: 'siren_not_found' });
  if (!['low', 'medium', 'high'].includes(input.volume))
    return response.status(400).json({ error: 'invalid_volume' });
  const allowedAlerts = new Set(['intrusion', 'tamper', 'panic']);
  const alertBehaviors = input.alertBehaviors ?? {};
  if (
    typeof alertBehaviors !== 'object' ||
    Array.isArray(alertBehaviors) ||
    Object.entries(alertBehaviors).some(
      ([type, behavior]) =>
        !allowedAlerts.has(type) ||
        typeof behavior !== 'object' ||
        (behavior.volume !== undefined && !['low', 'medium', 'high'].includes(behavior.volume)) ||
        (behavior.duration !== undefined &&
          (!Number.isInteger(behavior.duration) ||
            behavior.duration < 1 ||
            behavior.duration > 3600)),
    )
  )
    return response.status(400).json({ error: 'invalid_alert_behavior' });
  database.db
    .prepare(
      `INSERT INTO siren_settings(ieee_address,enabled,duration,volume,strobe,alert_behaviors)
      VALUES (?,?,?,?,?,?) ON CONFLICT(ieee_address) DO UPDATE SET enabled=excluded.enabled,
      duration=excluded.duration,volume=excluded.volume,strobe=excluded.strobe,
      alert_behaviors=excluded.alert_behaviors`,
    )
    .run(
      request.params.ieeeAddress,
      Number(Boolean(input.enabled)),
      Math.min(Math.max(Number(input.duration) || 180, 1), 3600),
      input.volume,
      Number(Boolean(input.strobe)),
      JSON.stringify(alertBehaviors),
    );
  database.appendEvent({
    type: 'siren_updated',
    actor: 'admin',
    device: request.params.ieeeAddress,
  });
  response.status(204).end();
});
app.put('/api/settings/panic', (request, response) => {
  if (!['audible', 'silent'].includes(request.body.mode))
    return response.status(400).json({ error: 'invalid_panic_mode' });
  database.setSetting('panic_mode', request.body.mode);
  database.appendEvent({
    type: 'panic_mode_updated',
    actor: 'admin',
    details: { mode: request.body.mode },
  });
  response.status(204).end();
});
app.get('/api/settings/alarm', (_request, response) => {
  response.json({
    entryDelay: Number(database.getSetting('entry_delay') ?? 30),
    exitDelays: Object.fromEntries(
      ['away', 'day', 'night'].map((mode) => [
        mode,
        Number(database.getSetting(`exit_delay_${mode}`) ?? (mode === 'away' ? 30 : 0)),
      ]),
    ),
    pinAttempts: {
      threshold: Number(database.getSetting('pin_attempt_threshold') ?? 5),
      windowSeconds: Number(database.getSetting('pin_attempt_window') ?? 300),
      lockSeconds: Number(database.getSetting('pin_attempt_lock') ?? 900),
    },
  });
});
app.put('/api/settings/alarm', (request, response) => {
  const input = request.body ?? {};
  const entryDelay = Number(input.entryDelay);
  const exitDelays = input.exitDelays ?? {};
  const threshold = Number(input.pinAttempts?.threshold);
  const windowSeconds = Number(input.pinAttempts?.windowSeconds);
  const lockSeconds = Number(input.pinAttempts?.lockSeconds);
  if (!Number.isInteger(entryDelay) || entryDelay < 0 || entryDelay > 86400)
    return response.status(400).json({ error: 'invalid_entry_delay' });
  if (
    !['away', 'day', 'night'].every(
      (mode) =>
        Number.isInteger(Number(exitDelays[mode])) &&
        Number(exitDelays[mode]) >= 0 &&
        Number(exitDelays[mode]) <= 86400,
    )
  )
    return response.status(400).json({ error: 'invalid_exit_delay' });
  if (
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 100 ||
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1 ||
    windowSeconds > 86400 ||
    !Number.isInteger(lockSeconds) ||
    lockSeconds < 1 ||
    lockSeconds > 604800
  )
    return response.status(400).json({ error: 'invalid_attempt_policy' });
  database.setSetting('entry_delay', entryDelay);
  for (const mode of ['away', 'day', 'night'])
    database.setSetting(`exit_delay_${mode}`, Number(exitDelays[mode]));
  database.setSetting('pin_attempt_threshold', threshold);
  database.setSetting('pin_attempt_window', windowSeconds);
  database.setSetting('pin_attempt_lock', lockSeconds);
  database.appendEvent({ type: 'alarm_settings_updated', actor: 'admin' });
  response.status(204).end();
});
app.post('/api/backup', async (request, response) => {
  try {
    database.appendEvent({
      type: 'backup_exported',
      actor: 'admin',
      details: { includeEvents: Boolean(request.body.includeEvents) },
    });
    response.json(
      await encryptBackup(
        exportData(database, {
          includeEvents: Boolean(request.body.includeEvents),
          internalSecret: pepper,
        }),
        request.body.passphrase,
      ),
    );
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});
app.post('/api/restore', async (request, response) => {
  try {
    const restored = restoreData(
      database,
      await decryptBackup(request.body.backup, request.body.passphrase),
    );
    if (restored.internalSecret) saveInternalSecret(restored.internalSecret);
    database.appendEvent({
      type: 'restart_required',
      severity: 'warning',
      actor: 'admin',
      details: { reason: 'internal_secret_restored' },
    });
    response.status(204).end();
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});
app.delete('/api/events', (request, response) => {
  if (request.body.confirmation !== 'DELETE')
    return response.status(400).json({ error: 'strong_confirmation_required' });
  database.db.prepare('DELETE FROM events').run();
  database.appendEvent({ type: 'journal_cleared', actor: 'admin' });
  response.status(204).end();
});
app.post('/api/password', async (request, response) => {
  if (!/^.{12,128}$/.test(String(request.body.password ?? '')))
    return response.status(400).json({ error: 'password_too_short' });
  database.setSetting('admin_password_hash', await hashSecret(request.body.password, pepper));
  database.appendEvent({ type: 'admin_password_changed', actor: 'admin' });
  database.setSetting(
    'session_generation',
    Number(database.getSetting('session_generation') ?? 0) + 1,
  );
  database.db.prepare('DELETE FROM sessions').run();
  response.status(204).end();
});
app.post('/api/logout', (request, response) => {
  database.appendEvent({ type: 'admin_logout', actor: 'admin' });
  database.db.prepare('DELETE FROM sessions WHERE digest=?').run(request.session.digest);
  response.status(204).end();
});

app.use((error, _request, response, _next) => {
  database.appendEvent({
    type: 'admin_api_error',
    severity: 'warning',
    details: { code: error.code ?? 'internal_error' },
  });
  response.status(500).json({ error: 'internal_error' });
});

if (!database.getSetting('instance_id'))
  database.setSetting('instance_id', randomBytes(16).toString('hex'));
const server = app.listen(port, '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () =>
    server.close(() => {
      database.close();
      process.exit(0);
    }),
  );
