import { hashSecret, verifySecret } from './secrets.js';

export class PinService {
  constructor({ database, pepper = process.env.ALARM_PEPPER ?? '', clock = () => new Date() }) {
    this.database = database;
    this.pepper = pepper;
    this.clock = clock;
  }

  async create({
    name,
    pin,
    duress = false,
    expiresAt = null,
    schedule = null,
    operations = ['arm', 'disarm'],
    modes = ['away', 'day', 'night'],
  }) {
    if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN must contain 4 to 8 digits');
    if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime()))
      throw new Error('Invalid expiration date');
    if (
      schedule &&
      (!Array.isArray(schedule) ||
        schedule.length === 0 ||
        schedule.some(
          (slot) =>
            !Array.isArray(slot.days) ||
            slot.days.length === 0 ||
            slot.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
            !Number.isInteger(slot.start) ||
            !Number.isInteger(slot.end) ||
            slot.start < 0 ||
            slot.end > 1439 ||
            slot.start > slot.end,
        ))
    )
      throw new Error('Invalid schedule');
    const existing = this.database.db.prepare('SELECT pin_hash FROM users').all();
    for (const row of existing)
      if (await verifySecret(String(pin), row.pin_hash, this.pepper))
        throw new Error('PIN already exists');
    const now = this.clock().toISOString();
    const hash = await hashSecret(String(pin), this.pepper);
    const result = this.database.db
      .prepare(
        `INSERT INTO users
      (name,pin_hash,active,duress,expires_at,schedule,operations,modes,created_at,updated_at)
      VALUES (?,?,1,?,?,?,?,?,?,?)`,
      )
      .run(
        name,
        hash,
        Number(duress),
        expiresAt,
        schedule ? JSON.stringify(schedule) : null,
        JSON.stringify(operations),
        JSON.stringify(modes),
        now,
        now,
      );
    this.database.appendEvent({
      type: 'user_created',
      actor: 'admin',
      details: { userId: Number(result.lastInsertRowid), name },
    });
    return Number(result.lastInsertRowid);
  }

  async validate(pin, operation, mode = null) {
    const now = this.clock();
    const users = this.database.db.prepare('SELECT * FROM users WHERE active=1').all();
    for (const user of users) {
      if (!(await verifySecret(String(pin), user.pin_hash, this.pepper))) continue;
      if (user.expires_at && new Date(user.expires_at) <= now)
        return { valid: false, reason: 'expired' };
      if (!JSON.parse(user.operations).includes(operation))
        return { valid: false, reason: 'operation_not_allowed' };
      if (mode && !JSON.parse(user.modes).includes(mode))
        return { valid: false, reason: 'mode_not_allowed' };
      if (!this.inSchedule(user.schedule, now)) return { valid: false, reason: 'outside_schedule' };
      return { valid: true, userId: user.id, name: user.name, duress: Boolean(user.duress) };
    }
    return { valid: false, reason: 'invalid_code' };
  }

  inSchedule(encoded, date) {
    if (!encoded) return true;
    const schedule = JSON.parse(encoded);
    const day = date.getUTCDay();
    const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
    return schedule.some(
      (slot) => slot.days.includes(day) && minute >= slot.start && minute <= slot.end,
    );
  }
}
