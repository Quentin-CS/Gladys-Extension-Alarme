import test from 'node:test';
import assert from 'node:assert/strict';
import { AlarmEngine } from '../src/domain/engine.js';
import { memoryDatabase } from './helpers.js';

test('simultaneous delayed sensors retain the first deadline while an immediate zone triggers', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database, settings: { exitDelays: { away: 0 } } });
  const delayed = { profile: 'entry', trigger_mode: 'delayed', entry_delay: 20 };
  const immediate = { profile: 'interior', trigger_mode: 'immediate' };
  engine.arm('away');
  engine.sensorTriggered('entry', { policy: delayed });
  const firstDeadline = engine.state.deadline;
  engine.sensorTriggered('entry-2', { policy: delayed });
  assert.equal(engine.state.deadline, firstDeadline);
  engine.sensorTriggered('motion', { policy: immediate });
  assert.equal(engine.state.actualState, 'triggered');
  engine.disarm();
  database.close();
});
