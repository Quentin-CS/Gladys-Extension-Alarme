import { AlarmDatabase } from '../src/storage/database.js';

export function memoryDatabase() {
  return new AlarmDatabase(':memory:');
}
