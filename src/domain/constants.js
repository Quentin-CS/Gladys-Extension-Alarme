export const MODES = Object.freeze(['disarmed', 'away', 'day', 'night']);
export const STATES = Object.freeze({
  DISARMED: 'disarmed',
  ARMING: 'arming',
  EXIT_DELAY: 'exit_delay',
  ARMED_AWAY: 'armed_away',
  ARMED_DAY: 'armed_day',
  ARMED_NIGHT: 'armed_night',
  ENTRY_DELAY: 'entry_delay',
  TRIGGERED: 'triggered',
  PANIC: 'panic',
  TAMPER: 'tamper',
  DEGRADED: 'degraded',
});

export const NOTIFICATIONS = Object.freeze([
  'intrusion',
  'tamper',
  'panic',
  'duress',
  'invalid_codes',
  'battery_low',
  'device_offline',
  'mqtt_lost',
  'mqtt_restored',
]);

export const stateForMode = (mode) =>
  ({
    away: STATES.ARMED_AWAY,
    day: STATES.ARMED_DAY,
    night: STATES.ARMED_NIGHT,
  })[mode];
