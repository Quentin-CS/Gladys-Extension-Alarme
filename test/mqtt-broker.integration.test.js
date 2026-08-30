import test from 'node:test';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import { readFile } from 'node:fs/promises';
import { ZigbeeMqttClient } from '../src/zigbee/mqtt-client.js';
import { memoryDatabase } from './helpers.js';

const port = Number(process.env.TEST_MQTT_PORT ?? 18883);
const fixture = await readFile(new URL('./fixtures/bridge-devices.json', import.meta.url));

function waitFor(emitter, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (...values) => {
      clearTimeout(timer);
      resolve(values);
    });
  });
}

test(
  'real Mosquitto transports discovery, commands and availability',
  { skip: process.env.RUN_MQTT_INTEGRATION !== '1' },
  async () => {
    const database = memoryDatabase();
    const integration = new ZigbeeMqttClient({
      config: {
        mqtt_host: '127.0.0.1',
        mqtt_port: port,
        mqtt_prefix: 'zigbee2mqtt',
        mqtt_username: '',
        mqtt_password: '',
        mqtt_tls: false,
      },
      database,
    }).connect();
    const publisher = mqtt.connect(`mqtt://127.0.0.1:${port}`);
    try {
      await Promise.all([waitFor(integration, 'availability'), waitFor(publisher, 'connect')]);
      const devicesPromise = waitFor(integration, 'devices');
      publisher.publish('zigbee2mqtt/bridge/devices', fixture, { qos: 1 });
      const [devices] = await devicesPromise;
      assert.equal(devices.length, 3);
      assert.equal(database.db.prepare('SELECT count(*) count FROM devices').get().count, 3);

      const messagePromise = waitFor(integration, 'deviceMessage');
      publisher.publish(
        'zigbee2mqtt/front_door',
        JSON.stringify({ contact: false, last_seen: '2026-08-29T12:00:00Z' }),
        { qos: 1 },
      );
      const [device, payload] = await messagePromise;
      assert.equal(device.friendlyName, 'front_door');
      assert.equal(payload.contact, false);

      await new Promise((resolve, reject) =>
        publisher.subscribe('zigbee2mqtt/entrance_keypad/set', (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      const commandPromise = waitFor(publisher, 'message');
      await integration.publish(
        'zigbee2mqtt/entrance_keypad/set',
        JSON.stringify({ arm_mode: { mode: 'arm_all_zones', transaction: 42 } }),
      );
      const [topic, commandBody] = await commandPromise;
      const command = JSON.parse(commandBody);
      assert.equal(topic, 'zigbee2mqtt/entrance_keypad/set');
      assert.equal(command.arm_mode.transaction, 42);
    } finally {
      await integration.close();
      publisher.end(true);
      database.close();
    }
  },
);
