import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSirenCommand } from '../src/zigbee/sirens.js';

test('siren warning command is adapted to exposed capabilities', () => {
  assert.deepEqual(
    buildSirenCommand(
      { duration: 120, volume: 'high', strobe: true, alertBehaviors: {} },
      ['warning', 'level'],
      { active: true, alertType: 'intrusion' },
    ),
    { warning: { mode: 'burglar', duration: 120, level: 'high' } },
  );
  assert.deepEqual(
    buildSirenCommand(
      { duration: 120, volume: 'high', strobe: true, alertBehaviors: {} },
      ['alarm'],
      { active: false },
    ),
    { alarm: 'OFF' },
  );
});

test('per-alert behavior can silence or override a siren', () => {
  const settings = {
    duration: 180,
    volume: 'high',
    strobe: true,
    alertBehaviors: {
      panic: { enabled: false },
      tamper: { duration: 30, volume: 'medium', strobe: false },
    },
  };
  assert.equal(
    buildSirenCommand(settings, ['warning', 'level', 'strobe'], {
      active: true,
      alertType: 'panic',
    }),
    null,
  );
  assert.deepEqual(
    buildSirenCommand(settings, ['warning', 'level', 'strobe'], {
      active: true,
      alertType: 'tamper',
    }),
    { warning: { mode: 'burglar', duration: 30, level: 'medium', strobe: false } },
  );
});
