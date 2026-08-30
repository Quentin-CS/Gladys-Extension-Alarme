import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDevice } from '../src/zigbee/discovery.js';
import { Keyzb110Adapter } from '../src/zigbee/adapters/keyzb110.js';

test('KEYZB-110 discovery and transactions are normalized', async () => {
  const device = normalizeDevice({
    ieee_address: '0x1',
    friendly_name: 'keypad',
    definition: {
      model: 'KEYZB-110',
      exposes: [
        { features: [{ property: 'action' }, { property: 'battery' }, { property: 'tamper' }] },
      ],
    },
  });
  assert.ok(device.kinds.includes('keypad'));
  assert.equal(device.kind, 'keypad');
  assert.deepEqual(device.capabilities.sort(), ['action', 'battery', 'tamper']);
  const published = [];
  const adapter = new Keyzb110Adapter({ publish: async (...args) => published.push(args) });
  assert.deepEqual(
    adapter.parse({ action: 'arm_all_zones', action_code: 1234, action_transaction: 42 }),
    { type: 'command', requested: 'away', pin: '1234', transaction: 42, zone: undefined },
  );
  await adapter.respond('zigbee2mqtt/keypad', 42, 'arm_all_zones');
  assert.equal(JSON.parse(published[0][1]).arm_mode.transaction, 42);
  assert.deepEqual(JSON.parse(published[0][1]), {
    arm_mode: { mode: 'arm_all_zones', transaction: 42 },
  });
  await adapter.reflectState('zigbee2mqtt/keypad', 'entry_delay', 300);
  assert.deepEqual(JSON.parse(published[1][1]), {
    arm_mode: { mode: 'entry_delay', audiblenotif: 1, delay: 255 },
  });
});
