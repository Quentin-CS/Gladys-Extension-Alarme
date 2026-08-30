const PROPERTY_KIND = new Map([
  ['contact', 'contact'],
  ['occupancy', 'motion'],
  ['tamper', 'tamper'],
  ['battery', 'battery'],
  ['battery_low', 'battery'],
  ['warning', 'siren'],
  ['alarm', 'siren'],
  ['action', 'keypad'],
  ['action_code', 'keypad'],
]);

function flattenExposes(exposes = [], result = []) {
  for (const expose of exposes) {
    if (expose.property) result.push(expose.property);
    if (expose.features) flattenExposes(expose.features, result);
  }
  return result;
}

export function normalizeDevice(raw) {
  const capabilities = [...new Set(flattenExposes(raw.definition?.exposes))];
  const kinds = [...new Set(capabilities.map((p) => PROPERTY_KIND.get(p)).filter(Boolean))];
  const modelId = raw.definition?.model ?? raw.model_id ?? '';
  if (/KEYZB-110/i.test(modelId) && !kinds.includes('keypad')) kinds.push('keypad');
  const priority = ['keypad', 'siren', 'tamper', 'motion', 'contact', 'battery'];
  return {
    ieeeAddress: raw.ieee_address,
    friendlyName: raw.friendly_name ?? raw.ieee_address,
    modelId,
    kind: priority.find((kind) => kinds.includes(kind)) ?? 'unknown',
    kinds,
    capabilities,
    lastSeen: raw.last_seen ? new Date(raw.last_seen).toISOString() : new Date().toISOString(),
  };
}

export const discoverCompatibleDevices = (devices) =>
  devices.map(normalizeDevice).filter((d) => d.kinds.length > 0);
