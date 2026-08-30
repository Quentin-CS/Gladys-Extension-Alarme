import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
test('manifest is an external device integration with an admin companion', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.containers[0].ports[0].browsable, true);
  assert.equal(manifest.containers[0].ports[0].name, 'alarm_admin');
});
test('configuration defaults match the implementation', () => {
  for (const field of manifest.config_schema)
    if (field.default !== undefined) assert.equal(DEFAULT_CONFIG[field.key], field.default);
});
