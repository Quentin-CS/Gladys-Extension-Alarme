import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export async function hashSecret(secret, pepper = '') {
  const salt = randomBytes(16);
  const derived = await scrypt(`${secret}${pepper}`, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export async function verifySecret(secret, encoded, pepper = '') {
  const [algorithm, cost, salt64, hash64] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || !salt64 || !hash64) return false;
  const expected = Buffer.from(hash64, 'base64');
  const actual = await scrypt(
    `${secret}${pepper}`,
    Buffer.from(salt64, 'base64'),
    expected.length,
    {
      N: Number(cost),
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    },
  );
  return timingSafeEqual(expected, Buffer.from(actual));
}

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const tokenDigest = (token) => createHash('sha256').update(token).digest('hex');
export function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
export const maskSensitive = (value) => String(value).replace(/\b\d{4,8}\b/g, '[PIN]');
