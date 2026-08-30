import { EventEmitter } from 'node:events';
import { MODES, STATES, stateForMode } from './constants.js';

export class AlarmEngine extends EventEmitter {
  constructor({ database, clock = () => Date.now(), settings = {}, tickMs = 1000 }) {
    super();
    this.database = database;
    this.clock = clock;
    this.settings = {
      exitDelays: { away: 30, day: 0, night: 0 },
      entryDelay: 30,
      sirenDuration: 180,
      ...settings,
    };
    this.tickMs = tickMs;
    this.timer = null;
    this.sirenTimer = null;
    this.countdownTimer = null;
    this.restore();
  }

  get state() {
    return this.database.getState();
  }

  settingNumber(key, fallback, minimum = 0, maximum = 86400) {
    const value = Number(this.database.getSetting(key));
    return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
  }

  restore() {
    let state = this.state;
    if (
      !Object.values(STATES).includes(state.actualState) ||
      !MODES.includes(state.requestedMode)
    ) {
      state = this.database.transition(
        { actualState: STATES.DEGRADED, mqttAvailable: false, deadline: null, timerKind: null },
        { type: 'configuration_corrupt', severity: 'critical' },
      );
      this.emit('notification', { type: 'configuration_corrupt' });
    }
    if (state.deadline) this.scheduleDeadline(state.deadline, state.timerKind);
    state = this.state;
    this.emitState(state);
    return state;
  }

  arm(mode, { actor = 'gladys', openDevices } = {}) {
    if (!MODES.includes(mode) || mode === 'disarmed') throw new Error(`Unsupported mode: ${mode}`);
    if (this.state.alarmLatched) throw new Error('Disarm before arming again');
    const currentlyOpen = openDevices ?? this.database.getOpenDevicesForMode(mode);
    const blocking = currentlyOpen.filter(
      (device) => device.openBehavior !== 'bypass' || !device.bypassAllowed,
    );
    if (blocking.length) {
      this.database.appendEvent({
        type: 'arming_rejected',
        severity: 'warning',
        actor,
        details: { devices: blocking.map((d) => d.id) },
      });
      throw new Error('not_ready');
    }
    for (const device of currentlyOpen) {
      this.database.db
        .prepare('INSERT OR REPLACE INTO bypasses VALUES (?,?,?)')
        .run(device.id, 'active_at_arming', new Date(this.clock()).toISOString());
      this.database.appendEvent({
        type: 'device_bypassed',
        severity: 'warning',
        actor,
        device: device.id,
      });
    }
    const zoneExitDelay = this.database.db
      .prepare('SELECT max(exit_delay) delay FROM zone_modes WHERE mode=? AND active=1')
      .get(mode).delay;
    const defaultExit = this.settingNumber(
      `exit_delay_${mode}`,
      Number(this.settings.exitDelays[mode] ?? 0),
    );
    const delay = Math.max(defaultExit, Number(zoneExitDelay ?? 0));
    const deadline = delay > 0 ? new Date(this.clock() + delay * 1000).toISOString() : null;
    const next = this.database.transition(
      {
        requestedMode: mode,
        actualState: delay ? STATES.EXIT_DELAY : stateForMode(mode),
        deadline,
        timerKind: delay ? 'exit' : null,
      },
      { type: 'arming', actor, details: { mode, delay } },
    );
    if (deadline) this.scheduleDeadline(deadline, 'exit');
    return this.emitState(next);
  }

  disarm({ actor = 'gladys', duress = false } = {}) {
    clearTimeout(this.timer);
    clearTimeout(this.sirenTimer);
    clearInterval(this.countdownTimer);
    this.database.db.prepare('DELETE FROM bypasses').run();
    const next = this.database.transition(
      {
        requestedMode: 'disarmed',
        actualState: STATES.DISARMED,
        alarmLatched: false,
        originDevice: null,
        deadline: null,
        timerKind: null,
        sirensActive: false,
      },
      {
        type: duress ? 'duress' : 'disarmed',
        severity: duress ? 'critical' : 'info',
        actor,
        adminOnly: duress,
      },
    );
    this.emit('sirens', { active: false });
    if (duress) this.emit('notification', { type: 'duress', silent: true });
    return this.emitState(next);
  }

  sensorTriggered(device, options = {}) {
    const state = this.state;
    const mode = state.requestedMode;
    const policy = options.policy ?? this.database.getDevicePolicy(device, mode);
    if (!policy) return state;
    if (policy.profile === '24h') return this.trigger('intrusion', device);
    if (
      ![
        STATES.ARMED_AWAY,
        STATES.ARMED_DAY,
        STATES.ARMED_NIGHT,
        STATES.ENTRY_DELAY,
        STATES.TRIGGERED,
      ].includes(state.actualState)
    )
      return state;
    if (state.actualState === STATES.TRIGGERED) return this.startSirens(device, true, 'intrusion');
    if (state.actualState === STATES.ENTRY_DELAY) {
      // Never move an already-running deadline forward. A second immediate
      // zone makes the alarm fire now; another delayed zone keeps the first
      // entry deadline intact.
      if (policy.trigger_mode === 'immediate') return this.trigger('intrusion', device);
      return state;
    }
    const entryDelay =
      options.entryDelay ??
      (policy.trigger_mode === 'delayed'
        ? Number(
            policy.entry_delay ??
              this.settingNumber('entry_delay', Number(this.settings.entryDelay)),
          )
        : 0);
    if (entryDelay > 0 && state.actualState !== STATES.ENTRY_DELAY) {
      const deadline = new Date(this.clock() + entryDelay * 1000).toISOString();
      const next = this.database.transition(
        { actualState: STATES.ENTRY_DELAY, originDevice: device, deadline, timerKind: 'entry' },
        { type: 'entry_delay', severity: 'warning', device, details: { seconds: entryDelay } },
      );
      this.scheduleDeadline(deadline, 'entry');
      return this.emitState(next);
    }
    return this.trigger('intrusion', device);
  }

  trigger(type, device, { silent = false } = {}) {
    clearTimeout(this.timer);
    clearInterval(this.countdownTimer);
    const actualState =
      type === 'tamper' ? STATES.TAMPER : type === 'panic' ? STATES.PANIC : STATES.TRIGGERED;
    const next = this.database.transition(
      {
        actualState,
        alarmLatched: true,
        originDevice: device,
        deadline: null,
        timerKind: null,
        sirensActive: !silent,
      },
      { type, severity: 'critical', device },
    );
    if (!silent) this.startSirens(device, false, type);
    this.emit('notification', { type, device, silent });
    return this.emitState(next);
  }

  startSirens(device, retrigger, alertType = 'intrusion') {
    clearTimeout(this.sirenTimer);
    const next = this.database.transition(
      { sirensActive: true },
      retrigger ? { type: 'sirens_retriggered', severity: 'critical', device } : null,
    );
    this.emit('sirens', {
      active: true,
      duration: this.settings.sirenDuration,
      device,
      alertType,
    });
    this.sirenTimer = setTimeout(() => {
      const stopped = this.database.transition({ sirensActive: false });
      this.emit('sirens', { active: false, alertType });
      this.emitState(stopped);
    }, this.settings.sirenDuration * 1000);
    this.sirenTimer.unref?.();
    return this.emitState(next);
  }

  setMqttAvailable(available) {
    const previous = this.state.mqttAvailable;
    const next = this.database.transition(
      { mqttAvailable: available },
      previous === available
        ? null
        : {
            type: available ? 'mqtt_restored' : 'mqtt_lost',
            severity: available ? 'info' : 'warning',
          },
    );
    if (previous !== available)
      this.emit('notification', { type: available ? 'mqtt_restored' : 'mqtt_lost' });
    return this.emitState(next);
  }

  scheduleDeadline(deadline, kind) {
    clearTimeout(this.timer);
    clearInterval(this.countdownTimer);
    const remaining = new Date(deadline).getTime() - this.clock();
    if (remaining <= 0) return this.handleDeadline(kind);
    this.timer = setTimeout(() => this.handleDeadline(kind), remaining);
    this.timer.unref?.();
    this.countdownTimer = setInterval(() => this.emit('tick', this.state), this.tickMs);
    this.countdownTimer.unref?.();
  }

  handleDeadline(kind) {
    clearInterval(this.countdownTimer);
    const state = this.state;
    if (kind === 'exit') {
      return this.emitState(
        this.database.transition(
          { actualState: stateForMode(state.requestedMode), deadline: null, timerKind: null },
          { type: 'armed', details: { mode: state.requestedMode } },
        ),
      );
    }
    if (kind === 'entry') return this.trigger('intrusion', state.originDevice);
  }

  emitState(state) {
    this.emit('state', state);
    return state;
  }
}
