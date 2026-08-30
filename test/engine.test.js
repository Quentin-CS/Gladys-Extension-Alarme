import test from 'node:test';
import assert from 'node:assert/strict';
import { AlarmEngine } from '../src/domain/engine.js';
import { memoryDatabase } from './helpers.js';

test('arming keeps requested mode separate until exit delay expires', () => {
  const database = memoryDatabase();
  let now = Date.parse('2026-01-01T00:00:00Z');
  const engine = new AlarmEngine({
    database,
    clock: () => now,
    settings: { exitDelays: { away: 10 } },
  });
  engine.arm('away');
  assert.equal(engine.state.requestedMode, 'away');
  assert.equal(engine.state.actualState, 'exit_delay');
  now += 11_000;
  engine.handleDeadline('exit');
  assert.equal(engine.state.actualState, 'armed_away');
  database.close();
});

test('global delays are read from persisted settings', () => {
  const database = memoryDatabase();
  database.setSetting('exit_delay_away', 4);
  database.setSetting('entry_delay', 7);
  let now = Date.parse('2026-01-01T00:00:00Z');
  const engine = new AlarmEngine({
    database,
    clock: () => now,
    settings: { exitDelays: { away: 0 } },
  });
  engine.arm('away');
  assert.equal(engine.state.deadline, new Date(now + 4000).toISOString());
  now += 4000;
  engine.handleDeadline('exit');
  engine.sensorTriggered('door', { policy: { profile: 'entry', trigger_mode: 'delayed' } });
  assert.equal(engine.state.deadline, new Date(now + 7000).toISOString());
  database.close();
});

test('open devices reject or are bypassed according to configuration', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database, settings: { exitDelays: { away: 0 } } });
  assert.throws(
    () => engine.arm('away', { openDevices: [{ id: 'door', openBehavior: 'reject' }] }),
    /not_ready/,
  );
  engine.arm('away', {
    openDevices: [{ id: 'window', openBehavior: 'bypass', bypassAllowed: true }],
  });
  assert.equal(database.db.prepare('SELECT count(*) count FROM bypasses').get().count, 1);
  database.close();
});

test('trigger is latched and another sensor restarts sirens', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({
    database,
    settings: { exitDelays: { away: 0 }, sirenDuration: 1 },
  });
  const sirenEvents = [];
  engine.on('sirens', (event) => sirenEvents.push(event));
  engine.arm('away');
  engine.sensorTriggered('motion', {
    entryDelay: 0,
    policy: { profile: 'interior', trigger_mode: 'immediate' },
  });
  assert.equal(engine.state.alarmLatched, true);
  engine.database.transition({ sirensActive: false });
  engine.sensorTriggered('door', {
    entryDelay: 0,
    policy: { profile: 'perimeter', trigger_mode: 'immediate' },
  });
  assert.equal(engine.state.actualState, 'triggered');
  assert.equal(engine.state.sirensActive, true);
  assert.ok(sirenEvents.filter((event) => event.active).length >= 2);
  engine.disarm();
  database.close();
});

test('retrigger grants a complete new siren duration', async () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({
    database,
    settings: { exitDelays: { away: 0 }, sirenDuration: 0.06 },
  });
  const policy = { profile: 'interior', trigger_mode: 'immediate' };
  engine.arm('away');
  engine.sensorTriggered('first', { policy });
  await new Promise((resolve) => setTimeout(resolve, 40));
  engine.sensorTriggered('second', { policy });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(engine.state.sirensActive, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(engine.state.sirensActive, false);
  engine.disarm();
  database.close();
});

test('active deadlines emit countdown ticks without database transitions', async () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({
    database,
    tickMs: 10,
    settings: { exitDelays: { away: 0.05 } },
  });
  let ticks = 0;
  engine.on('tick', () => {
    ticks += 1;
  });
  engine.arm('away');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(ticks >= 1);
  assert.equal(database.listEvents({ type: 'arming' }).total, 1);
  engine.disarm();
  database.close();
});

test('MQTT loss never disarms the system', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database, settings: { exitDelays: { night: 0 } } });
  engine.setMqttAvailable(true);
  engine.arm('night');
  engine.setMqttAvailable(false);
  assert.equal(engine.state.actualState, 'armed_night');
  assert.equal(engine.state.mqttAvailable, false);
  database.close();
});

test('tamper triggers while disarmed and duress disarms silently', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database });
  engine.trigger('tamper', 'keypad');
  assert.equal(engine.state.actualState, 'tamper');
  const notifications = [];
  engine.on('notification', (event) => notifications.push(event));
  engine.disarm({ duress: true, actor: 'Alice' });
  assert.equal(engine.state.actualState, 'disarmed');
  assert.deepEqual(notifications.at(-1), { type: 'duress', silent: true });
  assert.equal(database.listEvents({ includeAdmin: true, type: 'duress' }).total, 1);
  database.close();
});

test('overdue persisted deadline transitions immediately on restoration', () => {
  const database = memoryDatabase();
  const past = new Date(Date.now() - 1000).toISOString();
  database.transition({
    requestedMode: 'day',
    actualState: 'exit_delay',
    deadline: past,
    timerKind: 'exit',
  });
  const engine = new AlarmEngine({ database });
  assert.equal(engine.state.actualState, 'armed_day');
  database.close();
});

test('corrupt persisted state enters explicit degraded mode without disarming silently', () => {
  const database = memoryDatabase();
  database.db
    .prepare("UPDATE system_state SET requested_mode='unknown',actual_state='unknown'")
    .run();
  const engine = new AlarmEngine({ database });
  assert.equal(engine.state.actualState, 'degraded');
  assert.equal(engine.state.requestedMode, 'unknown');
  database.close();
});
