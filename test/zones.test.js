import test from 'node:test';
import assert from 'node:assert/strict';
import { AlarmEngine } from '../src/domain/engine.js';
import { memoryDatabase } from './helpers.js';

function addDevice(database, id, active = false) {
  database.upsertDevice({
    ieeeAddress: id,
    friendlyName: id,
    modelId: 'fixture',
    kind: 'contact',
    capabilities: ['contact'],
  });
  database.updateDeviceTelemetry(id, { contact: !active });
}

function addZone(database, profile, device, rules = {}) {
  const zoneId = Number(
    database.db
      .prepare('INSERT INTO zones(name,profile) VALUES (?,?)')
      .run(`${profile}-${device}`, profile).lastInsertRowid,
  );
  database.assignDeviceToZone(zoneId, device);
  for (const mode of ['away', 'day', 'night']) {
    database.db
      .prepare(
        `INSERT INTO zone_modes(zone_id,mode,active,entry_delay,exit_delay,
        trigger_mode,open_behavior,bypass_allowed) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        zoneId,
        mode,
        Number(rules[mode]?.active ?? true),
        rules[mode]?.entryDelay ?? 0,
        rules[mode]?.exitDelay ?? 0,
        rules[mode]?.triggerMode ?? 'immediate',
        rules[mode]?.openBehavior ?? 'reject',
        Number(rules[mode]?.bypassAllowed ?? false),
      );
  }
  return zoneId;
}

test('mode matrix activates only configured zones', () => {
  const database = memoryDatabase();
  addDevice(database, 'interior');
  addZone(database, 'interior', 'interior', { day: { active: false } });
  const engine = new AlarmEngine({ database, settings: { exitDelays: { day: 0, away: 0 } } });
  engine.arm('day');
  engine.sensorTriggered('interior');
  assert.equal(engine.state.actualState, 'armed_day');
  engine.disarm();
  engine.arm('away');
  engine.sensorTriggered('interior');
  assert.equal(engine.state.actualState, 'triggered');
  engine.disarm();
  database.close();
});

test('zone delays override mode defaults and persist the deadline', () => {
  const database = memoryDatabase();
  addDevice(database, 'entry');
  addZone(database, 'entry', 'entry', {
    away: { entryDelay: 45, exitDelay: 20, triggerMode: 'delayed' },
  });
  const engine = new AlarmEngine({ database, settings: { exitDelays: { away: 0 } } });
  engine.arm('away');
  assert.equal(engine.state.actualState, 'exit_delay');
  engine.handleDeadline('exit');
  engine.sensorTriggered('entry');
  assert.equal(engine.state.actualState, 'entry_delay');
  assert.ok(new Date(engine.state.deadline).getTime() > Date.now() + 40_000);
  engine.disarm();
  database.close();
});

test('a 24h zone triggers while disarmed', () => {
  const database = memoryDatabase();
  addDevice(database, 'safe');
  addZone(database, '24h', 'safe');
  const engine = new AlarmEngine({ database });
  engine.sensorTriggered('safe');
  assert.equal(engine.state.alarmLatched, true);
  assert.equal(engine.state.actualState, 'triggered');
  engine.disarm();
  database.close();
});

test('active detector is rejected or bypassed from persisted zone rules', () => {
  const database = memoryDatabase();
  addDevice(database, 'door', true);
  const zoneId = addZone(database, 'perimeter', 'door');
  const engine = new AlarmEngine({ database, settings: { exitDelays: { away: 0 } } });
  assert.throws(() => engine.arm('away'), /not_ready/);
  database.db
    .prepare(
      "UPDATE zone_modes SET open_behavior='bypass',bypass_allowed=1 WHERE zone_id=? AND mode='away'",
    )
    .run(zoneId);
  engine.arm('away');
  assert.equal(database.db.prepare('SELECT count(*) count FROM bypasses').get().count, 1);
  engine.disarm();
  database.close();
});

test('multiple assignments choose the safest active rule', () => {
  const database = memoryDatabase();
  addDevice(database, 'shared', true);
  addZone(database, 'perimeter', 'shared', {
    away: { openBehavior: 'bypass', bypassAllowed: true },
  });
  addZone(database, 'interior', 'shared', {
    away: { openBehavior: 'reject', bypassAllowed: false },
  });
  const open = database.getOpenDevicesForMode('away');
  assert.equal(open.length, 1);
  assert.equal(open[0].openBehavior, 'reject');
  assert.equal(open[0].bypassAllowed, 0);
  assert.equal(database.getDevicePolicy('shared', 'away').open_behavior, 'bypass');
  database.close();
});
