import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ZigbeeMqttClient } from '../src/zigbee/mqtt-client.js';
import { memoryDatabase } from './helpers.js';

class FakeMqttClient extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = [];
    this.publications = [];
  }
  subscribe(topics, callback) {
    this.subscriptions.push(...topics);
    callback?.();
  }
  publish(topic, payload, _options, callback) {
    this.publications.push({ topic, payload });
    callback?.();
  }
  end(_force, _options, callback) {
    callback?.();
  }
}

test('MQTT reconnect subscribes, resynchronizes and discovers compatible devices', async () => {
  const database = memoryDatabase();
  const fake = new FakeMqttClient();
  const client = new ZigbeeMqttClient({
    config: { mqtt_host: 'localhost', mqtt_port: 1883, mqtt_prefix: 'zigbee2mqtt' },
    database,
    clientFactory: () => fake,
  });
  const availability = [];
  client.on('availability', (value) => availability.push(value));
  client.connect();
  fake.emit('connect');
  assert.ok(fake.subscriptions.includes('zigbee2mqtt/bridge/devices'));
  assert.ok(fake.subscriptions.includes('zigbee2mqtt/+/availability'));
  assert.ok(
    fake.publications.some((entry) => entry.topic === 'zigbee2mqtt/bridge/request/devices'),
  );
  fake.emit(
    'message',
    'zigbee2mqtt/bridge/devices',
    Buffer.from(
      JSON.stringify([
        {
          ieee_address: '0xkeypad',
          friendly_name: 'keypad',
          definition: { model: 'KEYZB-110', exposes: [{ property: 'action' }] },
        },
      ]),
    ),
  );
  assert.equal(database.db.prepare('SELECT kind FROM devices').get().kind, 'keypad');
  fake.emit('offline');
  fake.emit('connect');
  assert.deepEqual(availability, [true, false, true]);
  await client.close();
  database.close();
});

test('per-device availability topics are normalized', () => {
  const database = memoryDatabase();
  const fake = new FakeMqttClient();
  const client = new ZigbeeMqttClient({
    config: { mqtt_host: 'localhost', mqtt_port: 1883, mqtt_prefix: 'z2m' },
    database,
    clientFactory: () => fake,
  }).connect();
  const messages = [];
  client.on('deviceMessage', (_device, payload) => messages.push(payload));
  fake.emit('message', 'z2m/door/availability', Buffer.from(JSON.stringify({ state: 'offline' })));
  assert.deepEqual(messages, [{ availability: 'offline' }]);
  database.close();
});

test('duplicate and out-of-order device transactions are discarded', () => {
  const database = memoryDatabase();
  const fake = new FakeMqttClient();
  const client = new ZigbeeMqttClient({
    config: { mqtt_host: 'localhost', mqtt_port: 1883, mqtt_prefix: 'z2m' },
    database,
    clientFactory: () => fake,
  }).connect();
  const messages = [];
  client.on('deviceMessage', (_device, payload) => messages.push(payload.action_transaction));
  for (const transaction of [10, 10, 9, 11])
    fake.emit(
      'message',
      'z2m/keypad',
      Buffer.from(JSON.stringify({ action: 'disarm', action_transaction: transaction })),
    );
  assert.deepEqual(messages, [10, 11]);
  database.close();
});
