import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Шифрование персональных данных: AES-256-GCM, формат: iv(12) | tag(16) | ciphertext. */
export class PiiCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('PII key must be 32 bytes');
  }

  encrypt(plain: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const out = Buffer.concat([iv, cipher.getAuthTag(), data]);
    return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
  }

  decrypt(payload: Uint8Array | null | undefined): string | null {
    if (!payload) return null;
    const buf = Buffer.from(payload);
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export const PII_CIPHER = Symbol('PII_CIPHER');
