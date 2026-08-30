export class AttemptLimiter {
  constructor({
    database,
    threshold = 5,
    windowSeconds = 300,
    lockSeconds = 900,
    clock = () => Date.now(),
    settings = null,
  }) {
    this.database = database;
    this.threshold = threshold;
    this.windowSeconds = windowSeconds;
    this.lockSeconds = lockSeconds;
    this.clock = clock;
    this.settings = settings;
  }

  value(name, fallback) {
    const candidate = this.settings?.(name);
    return Number.isInteger(Number(candidate)) && Number(candidate) > 0
      ? Number(candidate)
      : fallback;
  }

  status(subject) {
    const record = this.database.db
      .prepare('SELECT * FROM attempt_limits WHERE subject=?')
      .get(subject);
    const threshold = this.value('pin_attempt_threshold', this.threshold);
    const windowSeconds = this.value('pin_attempt_window', this.windowSeconds);
    if (!record) return { allowed: true, remaining: threshold };
    const now = this.clock();
    if (record.locked_until && new Date(record.locked_until).getTime() > now)
      return { allowed: false, lockedUntil: record.locked_until, remaining: 0 };
    if (new Date(record.window_started).getTime() + windowSeconds * 1000 <= now) {
      this.reset(subject);
      return { allowed: true, remaining: threshold };
    }
    return { allowed: true, remaining: Math.max(0, threshold - record.failures) };
  }

  failure(subject) {
    const now = this.clock();
    const status = this.status(subject);
    if (!status.allowed) return status;
    const record = this.database.db
      .prepare('SELECT * FROM attempt_limits WHERE subject=?')
      .get(subject);
    const failures = (record?.failures ?? 0) + 1;
    const windowStarted = record?.window_started ?? new Date(now).toISOString();
    const threshold = this.value('pin_attempt_threshold', this.threshold);
    const lockSeconds = this.value('pin_attempt_lock', this.lockSeconds);
    const lockedUntil =
      failures >= threshold ? new Date(now + lockSeconds * 1000).toISOString() : null;
    this.database.db
      .prepare(
        `INSERT INTO attempt_limits(subject,failures,window_started,locked_until)
      VALUES (?,?,?,?) ON CONFLICT(subject) DO UPDATE SET failures=excluded.failures,
      window_started=excluded.window_started,locked_until=excluded.locked_until`,
      )
      .run(subject, failures, windowStarted, lockedUntil);
    return {
      allowed: !lockedUntil,
      remaining: Math.max(0, threshold - failures),
      lockedUntil,
    };
  }

  reset(subject) {
    this.database.db.prepare('DELETE FROM attempt_limits WHERE subject=?').run(subject);
  }
}
