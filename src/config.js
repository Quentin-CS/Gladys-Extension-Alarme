export const DEFAULT_CONFIG = Object.freeze({
  mqtt_host: '',
  mqtt_port: 1883,
  mqtt_prefix: 'zigbee2mqtt',
  mqtt_username: '',
  mqtt_password: '',
  mqtt_tls: false,
  offline_timeout: 3600,
});

export function normalizeConfig(raw = {}) {
  const prefix = String(raw.mqtt_prefix ?? DEFAULT_CONFIG.mqtt_prefix)
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    mqtt_host: String(raw.mqtt_host ?? '').trim(),
    mqtt_port: Number(raw.mqtt_port ?? DEFAULT_CONFIG.mqtt_port),
    mqtt_prefix: prefix || DEFAULT_CONFIG.mqtt_prefix,
    mqtt_username: String(raw.mqtt_username ?? ''),
    mqtt_password: String(raw.mqtt_password ?? ''),
    mqtt_tls: raw.mqtt_tls === true || raw.mqtt_tls === 'true',
    offline_timeout: Number(raw.offline_timeout ?? DEFAULT_CONFIG.offline_timeout),
  };
}

export function mqttUrl(config) {
  if (!config.mqtt_host) throw new Error('MQTT host is required');
  const host = config.mqtt_host.includes(':') ? `[${config.mqtt_host}]` : config.mqtt_host;
  return `${config.mqtt_tls ? 'mqtts' : 'mqtt'}://${host}:${config.mqtt_port}`;
}

export function validateConfig(config) {
  const errors = [];
  if (!config.mqtt_host) errors.push('mqtt_host_required');
  if (/[:/]\/\//.test(config.mqtt_host) || /[\s/]/.test(config.mqtt_host))
    errors.push('mqtt_host_invalid');
  if (!Number.isInteger(config.mqtt_port) || config.mqtt_port < 1 || config.mqtt_port > 65535)
    errors.push('mqtt_port_invalid');
  if (!config.mqtt_prefix || /[+#]/.test(config.mqtt_prefix)) errors.push('mqtt_prefix_invalid');
  if (
    !Number.isInteger(config.offline_timeout) ||
    config.offline_timeout < 60 ||
    config.offline_timeout > 604800
  )
    errors.push('offline_timeout_invalid');
  return errors;
}
