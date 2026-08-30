import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, validateConfig } from './src/config.js';
import { AlarmDatabase } from './src/storage/database.js';
import { AlarmEngine } from './src/domain/engine.js';
import { MaintenanceMonitor } from './src/domain/maintenance.js';
import { CommandProcessor } from './src/domain/command-processor.js';
import { PinService } from './src/security/pins.js';
import { opaqueToken, hashSecret } from './src/security/secrets.js';
import { AttemptLimiter } from './src/security/attempt-limiter.js';
import { loadOrCreateInternalSecret } from './src/security/internal-secret.js';
import { ZigbeeMqttClient } from './src/zigbee/mqtt-client.js';
import { Keyzb110Adapter } from './src/zigbee/adapters/keyzb110.js';
import { buildSirenCommand } from './src/zigbee/sirens.js';
import { buildAlarmDevice, stateValues } from './src/gladys/device.js';

const gladys = new GladysIntegration();
const database = new AlarmDatabase();
const engine = new AlarmEngine({ database });
const internalSecret = loadOrCreateInternalSecret();
const pins = new PinService({ database, pepper: internalSecret });
const pinAttempts = new AttemptLimiter({ database, settings: (key) => database.getSetting(key) });
const commandProcessor = new CommandProcessor({ database, engine });
let config = normalizeConfig();
let zigbee;
let keypadAdapter;
let suppressKeypadSync = false;
let maintenance = new MaintenanceMonitor({ database, defaultTimeout: config.offline_timeout });

async function publishState(state, notification) {
  try {
    await gladys.publishStates(stateValues(gladys, state, notification));
  } catch (error) {
    logger.warn(`Unable to publish alarm state: ${error.message}`);
  }
}

async function startMqtt() {
  await zigbee?.close();
  const configErrors = validateConfig(config);
  if (configErrors.length) {
    engine.setMqttAvailable(false);
    database.appendEvent({
      type: 'configuration_invalid',
      severity: 'warning',
      details: { errors: configErrors },
    });
    await gladys
      .setConnectionStatus(false, {
        en: 'Invalid or incomplete MQTT configuration.',
        fr: 'Configuration MQTT invalide ou incomplète.',
      })
      .catch(() => {});
    return;
  }
  maintenance.stop();
  maintenance = new MaintenanceMonitor({ database, defaultTimeout: config.offline_timeout });
  maintenance.on('notification', (event) => engine.emit('notification', event));
  maintenance.start();
  zigbee = new ZigbeeMqttClient({ config, database });
  keypadAdapter = new Keyzb110Adapter({ publish: (...args) => zigbee.publish(...args) });
  zigbee.on('availability', (available) => {
    engine.setMqttAvailable(available);
    gladys
      .setConnectionStatus(available, {
        en: available ? 'Connected to Zigbee2MQTT.' : 'Zigbee2MQTT unavailable.',
        fr: available ? 'Connecté à Zigbee2MQTT.' : 'Zigbee2MQTT indisponible.',
      })
      .catch(() => {});
  });
  zigbee.on('clientError', (error) => logger.warn(error.message));
  zigbee.on('deviceMessage', async (device, payload, topic) => {
    if (device) maintenance.recordMessage(device, payload);
    if (payload.tamper === true) return engine.trigger('tamper', device?.ieeeAddress ?? topic);
    if (device && Keyzb110Adapter.matches(device)) {
      const command = keypadAdapter.parse(payload);
      if (
        !command ||
        command.transaction === undefined ||
        command.transaction === null ||
        !database.claimTransaction(device.ieeeAddress, command.transaction)
      )
        return;
      if (command.type === 'panic')
        return engine.trigger('panic', device.ieeeAddress, {
          silent: database.getSetting('panic_mode') === 'silent',
        });
      const operation = command.requested === 'disarmed' ? 'disarm' : 'arm';
      if (!pinAttempts.status(device.ieeeAddress).allowed) {
        return keypadAdapter.respond(topic, command.transaction, 'invalid_code');
      }
      const validation = await pins.validate(command.pin, operation, command.requested);
      if (!validation.valid) {
        const attempt = pinAttempts.failure(device.ieeeAddress);
        database.appendEvent({
          type: 'invalid_code',
          severity: 'warning',
          device: device.ieeeAddress,
          details: { reason: validation.reason, remaining: attempt.remaining },
        });
        if (!attempt.allowed)
          engine.emit('notification', { type: 'invalid_codes', device: device.ieeeAddress });
        return keypadAdapter.respond(topic, command.transaction, 'invalid_code');
      }
      pinAttempts.reset(device.ieeeAddress);
      try {
        if (operation === 'disarm' && engine.state.actualState === 'disarmed') {
          await keypadAdapter.respond(topic, command.transaction, 'already_disarmed');
          await syncKeypads(engine.state);
          return;
        }
        suppressKeypadSync = true;
        if (operation === 'disarm')
          engine.disarm({ actor: validation.name, duress: validation.duress });
        else engine.arm(command.requested, { actor: validation.name });
        suppressKeypadSync = false;
        const notification = {
          disarmed: 'disarm',
          away: 'arm_all_zones',
          day: 'arm_day_zones',
          night: 'arm_night_zones',
        }[command.requested];
        await keypadAdapter.respond(topic, command.transaction, notification);
        await syncKeypads(engine.state);
      } catch (error) {
        suppressKeypadSync = false;
        await keypadAdapter.respond(
          topic,
          command.transaction,
          error.message === 'not_ready' ? 'not_ready' : 'invalid_code',
        );
      }
    } else if (payload.contact === false || payload.occupancy === true)
      engine.sensorTriggered(device?.ieeeAddress ?? topic);
  });
  zigbee.connect();
}

engine.on('state', (state) => publishState(state));
engine.on('tick', (state) => publishState(state));
async function syncKeypads(state) {
  if (!zigbee || !keypadAdapter) return;
  const remaining = state.deadline
    ? Math.max(0, Math.ceil((new Date(state.deadline).getTime() - Date.now()) / 1000))
    : 0;
  const keypads = database.db
    .prepare("SELECT friendly_name FROM devices WHERE kind='keypad'")
    .all();
  await Promise.allSettled(
    keypads.map((keypad) =>
      keypadAdapter.reflectState(
        `${config.mqtt_prefix}/${keypad.friendly_name}`,
        state.actualState,
        remaining,
      ),
    ),
  );
}
engine.on('state', (state) => {
  if (!suppressKeypadSync) return syncKeypads(state);
});
engine.on('notification', (event) => {
  const eventId = database.appendEvent({ type: 'notification', details: event });
  publishState(engine.state, { ...event, eventId });
});
engine.on('sirens', ({ active, duration, alertType }) => {
  if (!zigbee) return;
  const sirens = database.db
    .prepare(
      `SELECT d.ieee_address,d.friendly_name,d.capabilities,s.duration,s.volume,s.strobe,
        s.alert_behaviors
       FROM devices d JOIN siren_settings s ON s.ieee_address=d.ieee_address
       WHERE d.kind='siren' AND s.enabled=1`,
    )
    .all();
  for (const siren of sirens) {
    const capabilities = JSON.parse(siren.capabilities);
    const command = buildSirenCommand(
      {
        ...siren,
        strobe: Boolean(siren.strobe),
        alertBehaviors: JSON.parse(siren.alert_behaviors),
      },
      capabilities,
      { active, alertType, fallbackDuration: duration },
    );
    if (!command) continue;
    zigbee
      .publish(`${config.mqtt_prefix}/${siren.friendly_name}/set`, JSON.stringify(command))
      .catch((error) => {
        logger.warn(`Siren command failed for ${siren.ieee_address}: ${error.message}`);
        database.appendEvent({
          type: 'siren_unavailable',
          severity: 'warning',
          device: siren.ieee_address,
          details: { alertType },
        });
      });
  }
});

gladys.onScanRequest(() => gladys.publishDiscoveredDevices([buildAlarmDevice(gladys)]));
gladys.onSetValue((_device, feature, value) => {
  if (!feature.external_id.endsWith(':requested-mode')) throw new Error('Read-only feature');
  const mode = String(value);
  if (!['disarmed', 'away', 'day', 'night'].includes(mode)) {
    throw new Error('Invalid alarm mode');
  }
  return mode === 'disarmed' ? engine.disarm() : engine.arm(mode);
});
gladys.onConfigUpdated(async (newConfig) => {
  config = normalizeConfig(newConfig);
  await startMqtt();
});
gladys.onAction('test_mqtt', async () => {
  if (!zigbee) await startMqtt();
  if (!zigbee)
    return {
      en: 'Complete and save a valid MQTT configuration first.',
      fr: "Renseignez et enregistrez d'abord une configuration MQTT valide.",
    };
  await zigbee.requestDiscovery();
  return {
    en: 'Discovery request sent to Zigbee2MQTT.',
    fr: 'Demande de découverte envoyée à Zigbee2MQTT.',
  };
});
gladys.onAction('reset_admin_password', async () => {
  const password = opaqueToken().slice(0, 16);
  database.setSetting('admin_password_hash', await hashSecret(password, internalSecret));
  database.setSetting(
    'session_generation',
    Number(database.getSetting('session_generation') ?? 0) + 1,
  );
  database.db.prepare('DELETE FROM sessions').run();
  return {
    en: `Temporary admin password: ${password}`,
    fr: `Mot de passe administrateur temporaire : ${password}`,
  };
});

await gladys.connect();
config = normalizeConfig(await gladys.getConfig());
await gladys.publishDiscoveredDevices([buildAlarmDevice(gladys)]);
await publishState(engine.state);
commandProcessor.start();
await startMqtt();
gladys.handleShutdown(async () => {
  commandProcessor.stop();
  maintenance.stop();
  await zigbee?.close();
  database.close();
});
