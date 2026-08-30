import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptLimiter } from '../src/security/attempt-limiter.js';
import { memoryDatabase } from './helpers.js';

test('invalid attempts lock a keypad and automatically expire', () => {
  const database = memoryDatabase();
  let now = Date.parse('2026-01-01T00:00:00Z');
  const limiter = new AttemptLimiter({ database, threshold: 3, lockSeconds: 60, clock: () => now });
  assert.equal(limiter.failure('keypad').allowed, true);
  assert.equal(limiter.failure('keypad').allowed, true);
  assert.equal(limiter.failure('keypad').allowed, false);
  assert.equal(limiter.status('keypad').allowed, false);
  now += 61_000;
  assert.equal(limiter.status('keypad').allowed, true);
  database.close();
});

test('attempt policy can be changed through persisted settings', () => {
  const database = memoryDatabase();
  database.setSetting('pin_attempt_threshold', 2);
  database.setSetting('pin_attempt_lock', 30);
  const limiter = new AttemptLimiter({
    database,
    settings: (key) => database.getSetting(key),
  });
  assert.equal(limiter.failure('web').allowed, true);
  assert.equal(limiter.failure('web').allowed, false);
  database.close();
});
