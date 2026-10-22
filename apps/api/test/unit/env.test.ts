import { loadEnv } from '../../src/config/env';
import { PiiCipher, sha256 } from '../../src/common/crypto';
import { jobId } from '../../src/jobs/jobs.service';

const base = {
  DATABASE_URL: 'postgresql://x@localhost/db',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('environment validation', () => {
  it('accepts a minimal development config with safe defaults', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' });
    expect(env.SMS_PROVIDER).toBe('console');
    expect(env.QUEUE_WORKERS_ENABLED).toBe(true);
  });

  it('production refuses console SMS, log push and missing Stripe/S3 keys', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER must be twilio/);
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
        TWILIO_VERIFY_SERVICE_SID: 'VA1',
        PUSH_PROVIDER: 'expo',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    ).toThrow(/STRIPE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA1', PUSH_PROVIDER: 'log' })).toThrow(/expo or fcm/);
  });

  it('rejects a short JWT secret and a wrong-size encryption key', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
    expect(() => loadEnv({ ...base, PII_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow();
  });
});

describe('crypto helpers', () => {
  it('encrypts personal data with a random IV and decrypts it back', () => {
    const c = new PiiCipher(Buffer.alloc(32, 9).toString('base64'));
    const a = c.encrypt('Գևորգ');
    const b = c.encrypt('Գևորգ');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(c.decrypt(a)).toBe('Գևորգ');
    expect(c.decrypt(null)).toBeNull();
    const tampered = Buffer.from(a);
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 1, last);
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it('hashes tokens and builds BullMQ-safe job ids', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(jobId('offer', 'x-y')).toBe('offer_x-y');
    expect(jobId('a', 'b')).not.toContain(':');
  });
});
