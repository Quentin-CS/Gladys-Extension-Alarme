import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { buildAlarmDevice, stateValues } from '../src/gladys/device.js';

const gladys = { externalId: (suffix) => `alarm:${suffix}` };

test('virtual alarm device uses only SDK-recognized feature category/type pairs', () => {
  const device = buildAlarmDevice(gladys);
  const categories = new Set(Object.values(DEVICE_FEATURE_CATEGORIES));
  for (const feature of device.features) {
    assert.ok(categories.has(feature.category), `unknown category ${feature.category}`);
    const categoryKey = Object.entries(DEVICE_FEATURE_CATEGORIES).find(
      ([, value]) => value === feature.category,
    )[0];
    assert.ok(
      Object.values(DEVICE_FEATURE_TYPES[categoryKey] ?? {}).includes(feature.type),
      `unknown ${feature.category}/${feature.type}`,
    );
  }
  const requested = device.features.find((feature) => feature.name === 'requested-mode');
  assert.equal(requested.read_only, false);
  assert.deepEqual(
    requested.supported_options.map((option) => option.value),
    ['disarmed', 'away', 'day', 'night'],
  );
});

test('requested and actual state remain distinct in Gladys publications', () => {
  const values = stateValues(gladys, {
    requestedMode: 'away',
    actualState: 'exit_delay',
    alarmLatched: false,
    deadline: new Date(Date.now() + 10_000).toISOString(),
    originDevice: null,
    sirensActive: false,
    mqttAvailable: true,
  });
  assert.equal(
    values.find((value) => value.device_feature_external_id.endsWith(':requested-mode')).text,
    'away',
  );
  assert.equal(
    values.find((value) => value.device_feature_external_id.endsWith(':actual-state')).text,
    'exit_delay',
  );
});
