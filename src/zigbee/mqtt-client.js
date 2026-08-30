import mqtt from 'mqtt';
import { EventEmitter } from 'node:events';
import { mqttUrl } from '../config.js';
import { discoverCompatibleDevices } from './discovery.js';

export class ZigbeeMqttClient extends EventEmitter {
  constructor({ config, database, clientFactory = mqtt.connect }) {
    super();
    this.config = config;
    this.database = database;
    this.clientFactory = clientFactory;
    this.client = null;
    this.devicesByName = new Map();
    this.lastSequence = new Map();
  }

  connect() {
    this.client = this.clientFactory(mqttUrl(this.config), {
      username: this.config.mqtt_username || undefined,
      password: this.config.mqtt_password || undefined,
      reconnectPeriod: 1000,
      connectTimeout: 15000,
      clean: true,
      clientId: `gladys-alarm-${Math.random().toString(16).slice(2, 10)}`,
    });
    this.client.on('connect', () => {
      this.client.subscribe(
        [
          `${this.config.mqtt_prefix}/bridge/devices`,
          `${this.config.mqtt_prefix}/bridge/state`,
          `${this.config.mqtt_prefix}/+`,
          `${this.config.mqtt_prefix}/+/availability`,
        ],
        (error) => {
          if (error) return this.emit('clientError', new Error('MQTT subscription failed'));
          this.requestDiscovery().catch((caught) => this.emit('clientError', caught));
          this.publish(`${this.config.mqtt_prefix}/bridge/request/health_check`, '{}').catch(
            (caught) => this.emit('clientError', caught),
          );
        },
      );
      this.emit('availability', true);
    });
    this.client.on('offline', () => this.emit('availability', false));
    this.client.on('close', () => this.emit('availability', false));
    this.client.on('error', (error) =>
      this.emit('clientError', new Error(`MQTT connection failed: ${error.code ?? error.message}`)),
    );
    this.client.on('message', (topic, payload) => this.handleMessage(topic, payload));
    return this;
  }

  handleMessage(topic, buffer) {
    let payload;
    try {
      payload = JSON.parse(buffer.toString());
    } catch {
      return;
    }
    const base = `${this.config.mqtt_prefix}/`;
    if (topic === `${base}bridge/devices`) {
      const devices = discoverCompatibleDevices(payload);
      for (const device of devices) {
        this.database.upsertDevice(device);
        this.devicesByName.set(device.friendlyName, device);
      }
      this.emit('devices', devices);
      return;
    }
    if (topic === `${base}bridge/state`) {
      this.emit('availability', payload?.state === 'online' || payload === 'online');
      return;
    }
    const friendlyName = topic.slice(base.length);
    if (friendlyName.endsWith('/availability')) {
      const deviceName = friendlyName.slice(0, -'/availability'.length);
      const availability =
        typeof payload === 'string' ? payload : (payload.state ?? payload.availability);
      this.emit(
        'deviceMessage',
        this.devicesByName.get(deviceName),
        { availability },
        `${base}${deviceName}`,
      );
      return;
    }
    if (!friendlyName || friendlyName.includes('/')) return;
    const sequence = payload.action_transaction ?? payload.last_seen;
    if (sequence !== undefined) {
      const previous = this.lastSequence.get(friendlyName);
      const order = (value) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : String(value);
      };
      if (previous !== undefined && order(sequence) <= order(previous)) return;
      this.lastSequence.set(friendlyName, sequence);
    }
    this.emit('deviceMessage', this.devicesByName.get(friendlyName), payload, topic);
  }

  publish(topic, payload) {
    return new Promise((resolve, reject) =>
      this.client.publish(topic, payload, { qos: 1 }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  requestDiscovery() {
    return this.publish(`${this.config.mqtt_prefix}/bridge/request/devices`, '{}');
  }
  close() {
    return new Promise((resolve) => this.client?.end(false, {}, resolve) ?? resolve());
  }
}
