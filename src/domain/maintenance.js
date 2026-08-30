import { EventEmitter } from 'node:events';

export class MaintenanceMonitor extends EventEmitter {
  constructor({ database, defaultTimeout = 3600, clock = () => Date.now(), intervalMs = 60_000 }) {
    super();
    this.database = database;
    this.defaultTimeout = defaultTimeout;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.interval = null;
  }

  start() {
    this.stop();
    this.interval = setInterval(() => this.check(), this.intervalMs);
    this.interval.unref?.();
    this.check();
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  check() {
    const devices = this.database.db
      .prepare('SELECT ieee_address,kind,last_seen,available,offline_alerted FROM devices')
      .all();
    for (const device of devices) {
      const timeout = Number(
        this.database.getSetting(`offline_timeout_${device.kind}`) ?? this.defaultTimeout,
      );
      const isOffline =
        !device.last_seen || new Date(device.last_seen).getTime() + timeout * 1000 <= this.clock();
      if (!isOffline) continue;
      this.database.db
        .prepare(
          'UPDATE devices SET available=0,offline_alerted=1,updated_at=? WHERE ieee_address=?',
        )
        .run(new Date(this.clock()).toISOString(), device.ieee_address);
      if (!device.offline_alerted) {
        this.database.appendEvent({
          type: 'device_offline',
          severity: 'warning',
          device: device.ieee_address,
          details: { kind: device.kind, timeout },
        });
        this.emit('notification', { type: 'device_offline', device: device.ieee_address });
      }
    }
  }

  recordMessage(device, payload) {
    const previous = this.database.db
      .prepare('SELECT available,battery_low,offline_alerted FROM devices WHERE ieee_address=?')
      .get(device.ieeeAddress);
    this.database.updateDeviceTelemetry(
      device.ieeeAddress,
      { ...payload, availability: payload.availability ?? 'online' },
      new Date(this.clock()),
    );
    if (payload.availability === 'offline') {
      this.database.db
        .prepare('UPDATE devices SET offline_alerted=1 WHERE ieee_address=?')
        .run(device.ieeeAddress);
      if (!previous?.offline_alerted) {
        this.database.appendEvent({
          type: 'device_offline',
          severity: 'warning',
          device: device.ieeeAddress,
          details: { source: 'zigbee2mqtt' },
        });
        this.emit('notification', { type: 'device_offline', device: device.ieeeAddress });
      }
      return;
    }
    if (previous && (!previous.available || previous.offline_alerted)) {
      this.database.appendEvent({
        type: 'device_restored',
        device: device.ieeeAddress,
      });
      this.emit('notification', { type: 'device_restored', device: device.ieeeAddress });
    }
    if (payload.battery_low === true && !previous?.battery_low) {
      this.database.appendEvent({
        type: 'battery_low',
        severity: 'warning',
        device: device.ieeeAddress,
      });
      this.emit('notification', { type: 'battery_low', device: device.ieeeAddress });
    }
  }
}
