import test from 'node:test';
import assert from 'node:assert/strict';
import { PinService } from '../src/security/pins.js';
import { memoryDatabase } from './helpers.js';

test('PINs are hashed, unique and checked for permissions and expiry', async () => {
  const database = memoryDatabase();
  const pins = new PinService({ database, pepper: 'test' });
  await pins.create({ name: 'Alice', pin: '1234', operations: ['disarm'], modes: ['away'] });
  assert.equal(
    database.db.prepare('SELECT pin_hash FROM users').get().pin_hash.includes('1234'),
    false,
  );
  assert.equal((await pins.validate('1234', 'disarm', 'away')).valid, true);
  assert.equal((await pins.validate('1234', 'arm', 'away')).reason, 'operation_not_allowed');
  await assert.rejects(() => pins.create({ name: 'Bob', pin: '1234' }), /already exists/);
  database.close();
});

test('duress flag is returned without changing the apparent validation', async () => {
  const database = memoryDatabase();
  const pins = new PinService({ database });
  await pins.create({ name: 'Duress', pin: '987654', duress: true });
  const result = await pins.validate('987654', 'disarm');
  assert.equal(result.valid, true);
  assert.equal(result.duress, true);
  database.close();
});

test('temporary PIN expiry, schedule and mode permissions are enforced', async () => {
  const database = memoryDatabase();
  let now = new Date('2026-08-31T10:30:00Z'); // Monday
  const pins = new PinService({ database, clock: () => now });
  await pins.create({
    name: 'Guest',
    pin: '45678',
    expiresAt: '2026-09-01T00:00:00Z',
    schedule: [{ days: [1, 2], start: 600, end: 720 }],
    operations: ['arm'],
    modes: ['day'],
  });
  assert.equal((await pins.validate('45678', 'arm', 'day')).valid, true);
  assert.equal((await pins.validate('45678', 'arm', 'night')).reason, 'mode_not_allowed');
  assert.equal((await pins.validate('45678', 'disarm', 'day')).reason, 'operation_not_allowed');
  now = new Date('2026-08-31T13:00:00Z');
  assert.equal((await pins.validate('45678', 'arm', 'day')).reason, 'outside_schedule');
  now = new Date('2026-09-02T10:30:00Z');
  assert.equal((await pins.validate('45678', 'arm', 'day')).reason, 'expired');
  database.close();
});

test('disabled PIN remains in history but cannot authenticate', async () => {
  const database = memoryDatabase();
  const pins = new PinService({ database });
  const userId = await pins.create({ name: 'Former user', pin: '112233' });
  database.db.prepare('UPDATE users SET active=0 WHERE id=?').run(userId);
  assert.equal((await pins.validate('112233', 'disarm')).reason, 'invalid_code');
  assert.equal(
    database.db.prepare('SELECT count(*) count FROM users WHERE id=?').get(userId).count,
    1,
  );
  database.close();
});
