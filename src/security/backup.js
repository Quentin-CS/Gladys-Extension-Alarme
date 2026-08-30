import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const FORMAT = 'gladys-zigbee-alarme-backup';

async function derive(passphrase, salt) {
  if (String(passphrase).length < 12)
    throw new Error('Passphrase must contain at least 12 characters');
  return scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function encryptBackup(payload, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return {
    format: FORMAT,
    version: 1,
    kdf: 'scrypt-32768',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

export async function decryptBackup(backup, passphrase) {
  if (backup?.format !== FORMAT || backup.version !== 1)
    throw new Error('Unsupported backup format');
  const key = await derive(passphrase, Buffer.from(backup.salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(backup.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(backup.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(backup.data, 'base64')),
      decipher.final(),
    ]).toString(),
  );
}

export function exportData(database, { includeEvents = false, internalSecret } = {}) {
  const tables = ['devices', 'zones', 'zone_devices', 'zone_modes', 'users', 'siren_settings'];
  if (includeEvents) tables.push('events');
  const settings = database.db
    .prepare(
      "SELECT key,value,updated_at FROM settings WHERE key='panic_mode' OR key LIKE 'offline_timeout_%' OR key IN ('entry_delay','exit_delay_away','exit_delay_day','exit_delay_night','pin_attempt_threshold','pin_attempt_window','pin_attempt_lock')",
    )
    .all();
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    internalSecret,
    tables: {
      ...Object.fromEntries(
        tables.map((table) => [table, database.db.prepare(`SELECT * FROM ${table}`).all()]),
      ),
      functional_settings: settings,
    },
  };
}

export function restoreData(database, payload) {
  if (payload?.schemaVersion !== 1 || !payload.tables)
    throw new Error('Incompatible backup schema');
  const allowed = new Set([
    'zones',
    'devices',
    'zone_devices',
    'zone_modes',
    'users',
    'siren_settings',
    'events',
    'functional_settings',
  ]);
  database.db.transaction(() => {
    for (const [table, rows] of Object.entries(payload.tables)) {
      if (!allowed.has(table) || !Array.isArray(rows)) throw new Error('Invalid backup table');
      if (table === 'functional_settings') {
        for (const row of rows) {
          if (
            row.key !== 'panic_mode' &&
            !/^offline_timeout_[a-z-]+$/.test(row.key) &&
            !/^(entry_delay|exit_delay_(away|day|night)|pin_attempt_(threshold|window|lock))$/.test(
              row.key,
            )
          )
            throw new Error('Invalid functional setting');
          database.setSetting(row.key, row.value);
        }
        continue;
      }
      database.db.prepare(`DELETE FROM ${table}`).run();
      for (const row of rows) {
        const keys = Object.keys(row);
        const columns = keys.map((key) => `"${key}"`).join(',');
        database.db
          .prepare(`INSERT INTO ${table} (${columns}) VALUES (${keys.map(() => '?').join(',')})`)
          .run(...keys.map((key) => row[key]));
      }
    }
    database.appendEvent({ type: 'backup_restored', actor: 'admin' });
  })();
  return { internalSecret: payload.internalSecret };
}
