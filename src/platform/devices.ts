import { randomBytes, createHash } from 'node:crypto';
import { StoreError } from '../server/store.js';
import { digest, type PlatformStore } from './store.js';

interface DeviceRequest {
  token_hash: string;
  user_code: string;
  label: string;
  challenge: string;
  expires_at: number;
  owner_id: string | null;
  last_poll_at: number | null;
}
export const challengeFor = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

export class DeviceAuthorization {
  constructor(private store: PlatformStore) {}

  start(label: string, challenge: string, now = Date.now()) {
    this.store.database.prepare('DELETE FROM device_requests WHERE expires_at <= ?').run(now);
    const deviceCode = randomBytes(32).toString('base64url');
    const userCode = randomBytes(5).toString('hex').toUpperCase();
    this.store.database
      .prepare(
        'INSERT INTO device_requests (token_hash, user_code, label, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(digest(deviceCode), userCode, label, challenge, now + 600_000);
    return { deviceCode, userCode, expiresIn: 600, interval: 5 };
  }

  describe(userCode: string, now = Date.now()) {
    const row = this.store.database
      .prepare('SELECT * FROM device_requests WHERE user_code = ? AND expires_at > ?')
      .get(userCode.toUpperCase(), now) as unknown as DeviceRequest | undefined;
    if (!row) throw new StoreError('This connection code has expired or is invalid.', 404);
    return row;
  }

  approve(owner: string, userCode: string, now = Date.now()) {
    const row = this.describe(userCode, now);
    if (row.owner_id) throw new StoreError('This code has already been approved.', 409);
    this.store.database
      .prepare('UPDATE device_requests SET owner_id = ? WHERE token_hash = ? AND owner_id IS NULL')
      .run(owner, row.token_hash);
    return { approved: true };
  }

  poll(deviceCode: string, verifier: string, now = Date.now()) {
    return this.store.database.transaction(() => {
      const row = this.store.database
        .prepare('SELECT * FROM device_requests WHERE token_hash = ? AND expires_at > ?')
        .get(digest(deviceCode), now) as unknown as DeviceRequest | undefined;
      if (!row)
        throw new StoreError('This connection request has expired or was already used.', 410);
      if (challengeFor(verifier) !== row.challenge)
        throw new StoreError('Invalid device verifier.', 401);
      if (row.last_poll_at !== null && now - row.last_poll_at < 4500)
        throw new StoreError('Wait five seconds before checking this code again.', 429);
      this.store.database
        .prepare('UPDATE device_requests SET last_poll_at = ? WHERE token_hash = ?')
        .run(now, row.token_hash);
      if (!row.owner_id) return { status: 'pending' as const };
      const key = this.store.createKey(row.owner_id, row.label, ['write:activity']);
      this.store.database
        .prepare('DELETE FROM device_requests WHERE token_hash = ?')
        .run(row.token_hash);
      return {
        status: 'approved' as const,
        token: key.token,
        deviceId: key.id,
        handle: this.store.profile(row.owner_id).handle,
      };
    })();
  }
}
