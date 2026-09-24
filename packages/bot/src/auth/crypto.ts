// AES-256-GCM helpers for encrypting per-user GRVT credentials.
//
// CREDENTIAL_MASTER_KEY contains exactly 32 random bytes encoded as base64.
// Losing it makes every user's GRVT credentials unrecoverable. Keep it in
// the deployment secret manager and an offline password manager.
//
// Each encrypt() call generates a fresh random 12-byte IV. Output
// fields (ciphertext, iv, authTag) are base64-encoded so they can be
// stored as TEXT in PostgreSQL. decrypt() validates the GCM auth tag,
// so any tampering with the stored ciphertext throws on decrypt
// instead of returning garbled plaintext.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto';

const ALGO: CipherGCMTypes = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const encoded = process.env.CREDENTIAL_MASTER_KEY?.trim();
  if (!encoded) {
    throw new Error(
      'CREDENTIAL_MASTER_KEY is required. Generate one with: ' +
      'openssl rand -base64 32'
    );
  }

  const buf = Buffer.from(encoded, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `CREDENTIAL_MASTER_KEY must decode to exactly ${KEY_LEN} bytes, got ${buf.length}.`
    );
  }
  cachedKey = buf;
  return buf;
}

export interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptWithKey(key: Buffer, plaintext: string): EncryptedField {
  if (key.length !== KEY_LEN) {
    throw new Error(`encryption key must be ${KEY_LEN} bytes`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function encrypt(plaintext: string): EncryptedField {
  return encryptWithKey(getMasterKey(), plaintext);
}

export function decryptWithKey(key: Buffer, enc: EncryptedField): string {
  if (key.length !== KEY_LEN) {
    throw new Error(`encryption key must be ${KEY_LEN} bytes`);
  }
  const iv = Buffer.from(enc.iv, 'base64');
  const ct = Buffer.from(enc.ciphertext, 'base64');
  const tag = Buffer.from(enc.authTag, 'base64');

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function decrypt(enc: EncryptedField): string {
  return decryptWithKey(getMasterKey(), enc);
}

export function masterKeyFromBase64(encoded: string | undefined, label: string): Buffer {
  const value = encoded?.trim() ?? '';
  if (!value) throw new Error(`${label} is required`);
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(`${label} must decode to exactly ${KEY_LEN} bytes`);
  }
  return buf;
}

// Convenience: encrypt N fields and return a flat object suitable
// for the grvt_credentials INSERT — one ciphertext + iv + tag per
// field. Caller maps these into the column names.
export function encryptCredentialFields(plain: {
  apiKey: string;
  apiSecret: string;
  tradingAddress: string;
  accountId: string;
  subAccountId: string;
}): {
  encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
  encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
  encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
  encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
  encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
} {
  const ak = encrypt(plain.apiKey);
  const as = encrypt(plain.apiSecret);
  const ta = encrypt(plain.tradingAddress);
  const ai = encrypt(plain.accountId);
  const sa = encrypt(plain.subAccountId);
  return {
    encrypted_api_key: ak.ciphertext, api_key_iv: ak.iv, api_key_tag: ak.authTag,
    encrypted_api_secret: as.ciphertext, api_secret_iv: as.iv, api_secret_tag: as.authTag,
    encrypted_trading_address: ta.ciphertext, trading_address_iv: ta.iv, trading_address_tag: ta.authTag,
    encrypted_account_id: ai.ciphertext, account_id_iv: ai.iv, account_id_tag: ai.authTag,
    encrypted_sub_account_id: sa.ciphertext, sub_account_id_iv: sa.iv, sub_account_id_tag: sa.authTag,
  };
}

export function decryptCredentialFields(row: {
  encrypted_api_key: string;        api_key_iv: string;        api_key_tag: string;
  encrypted_api_secret: string;     api_secret_iv: string;     api_secret_tag: string;
  encrypted_trading_address: string;trading_address_iv: string;trading_address_tag: string;
  encrypted_account_id: string;     account_id_iv: string;     account_id_tag: string;
  encrypted_sub_account_id: string; sub_account_id_iv: string; sub_account_id_tag: string;
}): {
  apiKey: string;
  apiSecret: string;
  tradingAddress: string;
  accountId: string;
  subAccountId: string;
} {
  return {
    apiKey: decrypt({
      ciphertext: row.encrypted_api_key,
      iv: row.api_key_iv,
      authTag: row.api_key_tag,
    }),
    apiSecret: decrypt({
      ciphertext: row.encrypted_api_secret,
      iv: row.api_secret_iv,
      authTag: row.api_secret_tag,
    }),
    tradingAddress: decrypt({
      ciphertext: row.encrypted_trading_address,
      iv: row.trading_address_iv,
      authTag: row.trading_address_tag,
    }),
    accountId: decrypt({
      ciphertext: row.encrypted_account_id,
      iv: row.account_id_iv,
      authTag: row.account_id_tag,
    }),
    subAccountId: decrypt({
      ciphertext: row.encrypted_sub_account_id,
      iv: row.sub_account_id_iv,
      authTag: row.sub_account_id_tag,
    }),
  };
}
