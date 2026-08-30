const ACTION_TO_MODE = Object.freeze({
  arm_all_zones: 'away',
  arm_day_zones: 'day',
  arm_night_zones: 'night',
  disarm: 'disarmed',
  emergency: 'panic',
  panic: 'panic',
});

export class Keyzb110Adapter {
  static matches(device) {
    return /KEYZB-110/i.test(device.modelId ?? device.model_id ?? '');
  }

  constructor({ publish }) {
    this.publish = publish;
  }

  parse(message) {
    const requested = ACTION_TO_MODE[message.action];
    if (!requested) return null;
    return {
      type: requested === 'panic' ? 'panic' : 'command',
      requested,
      pin: message.action_code === undefined ? null : String(message.action_code),
      transaction: message.action_transaction,
      zone: message.action_zone,
    };
  }

  // IAS ACE ArmRsp: Zigbee2MQTT selects this path when transaction is set.
  async respond(topic, transaction, notification) {
    await this.publish(
      `${topic}/set`,
      JSON.stringify({ arm_mode: { mode: notification, transaction: Number(transaction) } }),
    );
  }

  // Panel status is a separate command without a transaction. KEYZB-110's
  // Develco converter injects audible notification 1 by default; it is explicit
  // here to document and stabilize firmware 2.0.6 behavior.
  async reflectState(topic, state, seconds = 0) {
    const mode = {
      disarmed: 'disarm',
      exit_delay: 'exit_delay',
      entry_delay: 'entry_delay',
      armed_away: 'arm_all_zones',
      armed_day: 'arm_day_zones',
      armed_night: 'arm_night_zones',
      triggered: 'in_alarm',
      panic: 'in_alarm',
      tamper: 'in_alarm',
    }[state];
    if (!mode) return;
    const armMode = { mode, audiblenotif: 1 };
    if (mode === 'exit_delay' || mode === 'entry_delay') {
      armMode.delay = Math.min(Math.max(Math.round(seconds), 0), 255);
    }
    await this.publish(`${topic}/set`, JSON.stringify({ arm_mode: armMode }));
  }
}
