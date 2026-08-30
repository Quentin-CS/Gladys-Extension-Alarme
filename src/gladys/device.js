const features = [
  {
    id: 'requested-mode',
    category: 'text',
    type: 'select',
    readOnly: false,
    supported_options: ['disarmed', 'away', 'day', 'night'].map((value) => ({
      value,
      label: value,
    })),
  },
  { id: 'actual-state', category: 'text', type: 'text', readOnly: true },
  { id: 'alarm-active', category: 'input', type: 'binary', readOnly: true, min: 0, max: 1 },
  { id: 'entry-delay', category: 'input', type: 'binary', readOnly: true, min: 0, max: 1 },
  { id: 'exit-delay', category: 'input', type: 'binary', readOnly: true, min: 0, max: 1 },
  {
    id: 'seconds-remaining',
    category: 'duration',
    type: 'integer',
    readOnly: true,
    min: 0,
    max: 86400,
  },
  { id: 'origin-device', category: 'text', type: 'text', readOnly: true },
  { id: 'sirens-active', category: 'siren', type: 'binary', readOnly: true, min: 0, max: 1 },
  { id: 'health', category: 'risk', type: 'integer', readOnly: true, min: 0, max: 2 },
  { id: 'mqtt-available', category: 'input', type: 'binary', readOnly: true, min: 0, max: 1 },
  { id: 'notification-event', category: 'text', type: 'text', readOnly: true },
];

export function buildAlarmDevice(gladys) {
  return {
    external_id: gladys.externalId('alarm-system'),
    name: 'Système d’alarme',
    should_poll: false,
    features: features.map(({ id, category, type, readOnly, ...options }) => ({
      external_id: gladys.externalId(`alarm-system:${id}`),
      name: id,
      category,
      type,
      read_only: readOnly,
      has_feedback: !readOnly,
      keep_history: type !== 'text' && type !== 'select',
      ...options,
    })),
  };
}

export function stateValues(gladys, state, notification = null) {
  const prefix = (id) => gladys.externalId(`alarm-system:${id}`);
  const remaining = state.deadline
    ? Math.max(0, Math.ceil((new Date(state.deadline).getTime() - Date.now()) / 1000))
    : 0;
  return [
    [prefix('requested-mode'), state.requestedMode, true],
    [prefix('actual-state'), state.actualState, true],
    [prefix('alarm-active'), Number(state.alarmLatched)],
    [prefix('entry-delay'), Number(state.actualState === 'entry_delay')],
    [prefix('exit-delay'), Number(state.actualState === 'exit_delay')],
    [prefix('seconds-remaining'), remaining],
    [prefix('origin-device'), state.originDevice ?? '', true],
    [prefix('sirens-active'), Number(state.sirensActive)],
    [prefix('health'), state.mqttAvailable ? 0 : 1],
    [prefix('mqtt-available'), Number(state.mqttAvailable)],
    [
      prefix('notification-event'),
      notification ? `${notification.type}:${notification.eventId}` : '',
      true,
    ],
  ].map(([device_feature_external_id, value, isText]) =>
    isText
      ? { device_feature_external_id, text: value }
      : { device_feature_external_id, state: value },
  );
}
