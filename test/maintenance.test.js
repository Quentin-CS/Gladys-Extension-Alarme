import test from 'node:test';
import assert from 'node:assert/strict';
import { MaintenanceMonitor } from '../src/domain/maintenance.js';
import { memoryDatabase } from './helpers.js';

function addDevice(database, lastSeen) {
  database.upsertDevice({
    ieeeAddress: 'sensor',
    friendlyName: 'Sensor',
    modelId: 'fixture',
    kind: 'contact',
    capabilities: ['contact', 'battery_low'],
    lastSeen,
  });
}

test('offline device creates one maintenance notification and no siren state', () => {
  const database = memoryDatabase();
  const now = Date.parse('2026-01-01T01:00:00Z');
  addDevice(database, new Date(now - 120_000).toISOString());
  const monitor = new MaintenanceMonitor({ database, defaultTimeout: 60, clock: () => now });
  const notifications = [];
  monitor.on('notification', (event) => notifications.push(event));
  monitor.check();
  monitor.check();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'device_offline');
  assert.equal(database.getState().sirensActive, false);
  database.close();
});

test('per-kind timeout and restoration are honored', () => {
  const database = memoryDatabase();
  const now = Date.parse('2026-01-01T01:00:00Z');
  addDevice(database, new Date(now - 90_000).toISOString());
  database.setSetting('offline_timeout_contact', 120);
  const monitor = new MaintenanceMonitor({ database, defaultTimeout: 60, clock: () => now });
  monitor.check();
  assert.equal(database.db.prepare('SELECT available FROM devices').get().available, 1);
  database.setSetting('offline_timeout_contact', 30);
  monitor.check();
  const notifications = [];
  monitor.on('notification', (event) => notifications.push(event));
  monitor.recordMessage({ ieeeAddress: 'sensor' }, { contact: true });
  assert.equal(notifications[0].type, 'device_restored');
  assert.equal(database.db.prepare('SELECT available FROM devices').get().available, 1);
  database.close();
});

test('battery low is deduplicated until the device reports recovery', () => {
  const database = memoryDatabase();
  addDevice(database, new Date().toISOString());
  const monitor = new MaintenanceMonitor({ database });
  const notifications = [];
  monitor.on('notification', (event) => notifications.push(event));
  const device = { ieeeAddress: 'sensor' };
  monitor.recordMessage(device, { battery_low: true });
  monitor.recordMessage(device, { battery_low: true });
  monitor.recordMessage(device, { battery_low: false });
  monitor.recordMessage(device, { battery_low: true });
  assert.equal(notifications.filter((event) => event.type === 'battery_low').length, 2);
  database.close();
});

test('explicit Zigbee2MQTT offline availability alerts immediately', () => {
  const database = memoryDatabase();
  addDevice(database, new Date().toISOString());
  const monitor = new MaintenanceMonitor({ database });
  const notifications = [];
  monitor.on('notification', (event) => notifications.push(event));
  monitor.recordMessage({ ieeeAddress: 'sensor' }, { availability: 'offline' });
  monitor.recordMessage({ ieeeAddress: 'sensor' }, { availability: 'offline' });
  assert.equal(notifications.filter((event) => event.type === 'device_offline').length, 1);
  monitor.recordMessage({ ieeeAddress: 'sensor' }, { availability: 'online' });
  assert.equal(notifications.at(-1).type, 'device_restored');
  database.close();
});
