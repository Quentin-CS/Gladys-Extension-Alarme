export class CommandProcessor {
  constructor({ database, engine, intervalMs = 500 }) {
    this.database = database;
    this.engine = engine;
    this.intervalMs = intervalMs;
    this.interval = null;
    this.processing = false;
  }

  start() {
    this.stop();
    this.interval = setInterval(() => this.process(), this.intervalMs);
    this.interval.unref?.();
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  enqueue(command, payload = {}) {
    const result = this.database.db
      .prepare('INSERT INTO admin_commands(command,payload,created_at) VALUES (?,?,?)')
      .run(command, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  process() {
    if (this.processing) return;
    this.processing = true;
    try {
      const commands = this.database.db
        .prepare('SELECT * FROM admin_commands WHERE processed_at IS NULL ORDER BY id LIMIT 20')
        .all();
      for (const command of commands) {
        let error = null;
        if (Date.now() - new Date(command.created_at).getTime() > 30_000) {
          this.database.db
            .prepare('UPDATE admin_commands SET processed_at=?,error=? WHERE id=?')
            .run(new Date().toISOString(), 'command_expired', command.id);
          continue;
        }
        try {
          const payload = JSON.parse(command.payload);
          if (command.command === 'disarm') this.engine.disarm({ actor: 'admin-web' });
          else if (command.command === 'arm') this.engine.arm(payload.mode, { actor: 'admin-web' });
          else if (command.command === 'notify') {
            const allowed = new Set(['invalid_codes', 'configuration_changed']);
            if (!allowed.has(payload.type)) throw new Error('unsupported_notification');
            this.engine.emit('notification', { type: payload.type, source: 'admin-web' });
          } else throw new Error('unsupported_command');
        } catch (caught) {
          error = caught.message;
        }
        this.database.db
          .prepare('UPDATE admin_commands SET processed_at=?,error=? WHERE id=?')
          .run(new Date().toISOString(), error, command.id);
      }
    } finally {
      this.processing = false;
    }
  }
}
