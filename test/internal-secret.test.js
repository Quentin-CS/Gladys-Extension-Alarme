import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateInternalSecret, saveInternalSecret } from '../src/security/internal-secret.js';

test('internal secret is generated once with restricted permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alarm-secret-'));
  const path = join(directory, 'pepper');
  try {
    const first = loadOrCreateInternalSecret(path);
    const second = loadOrCreateInternalSecret(path);
    assert.equal(first, second);
    assert.ok(first.length >= 32);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restored internal secret replaces the generated value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alarm-secret-'));
  const path = join(directory, 'pepper');
  try {
    const restored = 'B'.repeat(43);
    saveInternalSecret(restored, path);
    assert.equal(readFileSync(path, 'utf8'), restored);
    assert.equal(loadOrCreateInternalSecret(path), restored);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
