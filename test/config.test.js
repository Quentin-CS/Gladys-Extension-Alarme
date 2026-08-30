import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, mqttUrl, validateConfig } from '../src/config.js';

test('configuration normalizes form values without logging credentials', () => {
  const config = normalizeConfig({
    mqtt_host: ' broker.local ',
    mqtt_port: '8883',
    mqtt_prefix: '/z2m/',
    mqtt_tls: 'true',
  });
  assert.equal(config.mqtt_host, 'broker.local');
  assert.equal(config.mqtt_port, 8883);
  assert.equal(config.mqtt_prefix, 'z2m');
  assert.equal(mqttUrl(config), 'mqtts://broker.local:8883');
});

test('invalid or corrupted configuration is rejected explicitly', () => {
  assert.deepEqual(validateConfig(normalizeConfig()), ['mqtt_host_required']);
  assert.deepEqual(
    validateConfig(
      normalizeConfig({
        mqtt_host: 'mqtt://broker',
        mqtt_port: 'invalid',
        mqtt_prefix: 'zigbee2mqtt/#',
        offline_timeout: 10,
      }),
    ),
    ['mqtt_host_invalid', 'mqtt_port_invalid', 'mqtt_prefix_invalid', 'offline_timeout_invalid'],
  );
  assert.deepEqual(validateConfig(normalizeConfig({ mqtt_host: '192.168.1.10' })), []);
});
