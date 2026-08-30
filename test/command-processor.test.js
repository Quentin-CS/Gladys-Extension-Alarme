import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandProcessor } from '../src/domain/command-processor.js';
import { AlarmEngine } from '../src/domain/engine.js';
import { memoryDatabase } from './helpers.js';

test('web commands are queued while the main engine remains the state writer', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database, settings: { exitDelays: { night: 0 } } });
  const companion = new CommandProcessor({ database, engine: null });
  const main = new CommandProcessor({ database, engine });
  const id = companion.enqueue('arm', { mode: 'night' });
  assert.equal(engine.state.actualState, 'disarmed');
  main.process();
  assert.equal(engine.state.actualState, 'armed_night');
  assert.equal(
    database.db.prepare('SELECT error FROM admin_commands WHERE id=?').get(id).error,
    null,
  );
  companion.enqueue('disarm');
  main.process();
  assert.equal(engine.state.actualState, 'disarmed');
  database.close();
});

test('invalid commands are bounded and recorded without stopping the queue', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database });
  const processor = new CommandProcessor({ database, engine });
  processor.enqueue('unknown');
  processor.enqueue('arm', { mode: 'day' });
  processor.process();
  const commands = database.db.prepare('SELECT * FROM admin_commands ORDER BY id').all();
  assert.equal(commands[0].error, 'unsupported_command');
  assert.equal(commands[1].error, null);
  database.close();
});

test('companion can request only normalized security notifications', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database });
  const processor = new CommandProcessor({ database, engine });
  const notifications = [];
  engine.on('notification', (event) => notifications.push(event));
  processor.enqueue('notify', { type: 'invalid_codes' });
  processor.enqueue('notify', { type: 'arbitrary' });
  processor.process();
  assert.deepEqual(notifications, [{ type: 'invalid_codes', source: 'admin-web' }]);
  assert.equal(
    database.db.prepare('SELECT error FROM admin_commands ORDER BY id DESC LIMIT 1').get().error,
    'unsupported_notification',
  );
  database.close();
});

test('stale web commands expire instead of changing alarm state after a long outage', () => {
  const database = memoryDatabase();
  const engine = new AlarmEngine({ database });
  const processor = new CommandProcessor({ database, engine });
  processor.enqueue('arm', { mode: 'away' });
  database.db.prepare("UPDATE admin_commands SET created_at='2020-01-01T00:00:00Z'").run();
  processor.process();
  assert.equal(engine.state.actualState, 'disarmed');
  assert.equal(
    database.db.prepare('SELECT error FROM admin_commands').get().error,
    'command_expired',
  );
  database.close();
});
