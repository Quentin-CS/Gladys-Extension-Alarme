import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptBackup, encryptBackup, exportData, restoreData } from '../src/security/backup.js';
import { PinService } from '../src/security/pins.js';
import { memoryDatabase } from './helpers.js';

test('encrypted backup restores PIN verifiers without exposing the PIN', async () => {
  const source = memoryDatabase();
  const pins = new PinService({ database: source, pepper: 'pepper' });
  await pins.create({ name: 'Alice', pin: '2468' });
  source.setSetting('panic_mode', 'silent');
  source.setSetting('admin_password_hash', 'must-not-leave-this-instance');
  const internalSecret = 'A'.repeat(43);
  const encrypted = await encryptBackup(
    exportData(source, { includeEvents: true, internalSecret }),
    'a sufficiently long passphrase',
  );
  assert.equal(JSON.stringify(encrypted).includes('2468'), false);
  const decrypted = await decryptBackup(encrypted, 'a sufficiently long passphrase');
  assert.equal(JSON.stringify(decrypted).includes('must-not-leave-this-instance'), false);
  await assert.rejects(
    () => decryptBackup(encrypted, 'the wrong long passphrase'),
    /authenticate data/,
  );
  const target = memoryDatabase();
  const restoreResult = restoreData(
    target,
    await decryptBackup(encrypted, 'a sufficiently long passphrase'),
  );
  const restoredPins = new PinService({ database: target, pepper: 'pepper' });
  assert.equal((await restoredPins.validate('2468', 'disarm')).valid, true);
  assert.equal(target.getSetting('panic_mode'), 'silent');
  assert.equal(restoreResult.internalSecret, internalSecret);
  source.close();
  target.close();
});
