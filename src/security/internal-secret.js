import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export function loadOrCreateInternalSecret(
  path = process.env.ALARM_PEPPER_FILE ?? '/data/alarm.pepper',
) {
  if (process.env.ALARM_PEPPER) return process.env.ALARM_PEPPER;
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(path), { recursive: true });
  const generated = randomBytes(32).toString('base64url');
  try {
    writeFileSync(path, generated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return generated;
  } catch (error) {
    // The main and companion containers may start simultaneously. The loser
    // of the exclusive create reads the winner's value.
    if (error.code !== 'EEXIST') throw error;
    return readFileSync(path, 'utf8').trim();
  }
}

export function saveInternalSecret(
  secret,
  path = process.env.ALARM_PEPPER_FILE ?? '/data/alarm.pepper',
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(secret))) throw new Error('Invalid internal secret');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { encoding: 'utf8', mode: 0o600 });
}
