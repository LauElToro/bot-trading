// Re-encrypt GRVT credentials with CREDENTIAL_MASTER_KEY_NEXT.
//
// A single VPS has no external KMS. The trading process must be able to
// decrypt, so a compromised host can still read every key. This script only
// rotates the master key. It never prints either key.
//
//   CREDENTIAL_MASTER_KEY=<current> CREDENTIAL_MASTER_KEY_NEXT=<new> \
//     npm run rotate:credentials --workspace=@grvt-grid/bot
// Then replace CREDENTIAL_MASTER_KEY with the new value and restart the bot.

import pg from 'pg';
import {
  decryptWithKey,
  encryptWithKey,
  masterKeyFromBase64,
  type EncryptedField,
} from '../src/auth/crypto.js';

const FIELDS = [
  ['encrypted_api_key', 'api_key_iv', 'api_key_tag'],
  ['encrypted_api_secret', 'api_secret_iv', 'api_secret_tag'],
  ['encrypted_trading_address', 'trading_address_iv', 'trading_address_tag'],
  ['encrypted_account_id', 'account_id_iv', 'account_id_tag'],
  ['encrypted_sub_account_id', 'sub_account_id_iv', 'sub_account_id_tag'],
] as const;

type Row = Record<string, string | number>;

function recrypt(row: Row, oldKey: Buffer, nextKey: Buffer): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [cipher, iv, tag] of FIELDS) {
    const plain = decryptWithKey(oldKey, {
      ciphertext: String(row[cipher]),
      iv: String(row[iv]),
      authTag: String(row[tag]),
    } satisfies EncryptedField);
    const enc = encryptWithKey(nextKey, plain);
    next[cipher] = enc.ciphertext;
    next[iv] = enc.iv;
    next[tag] = enc.authTag;
  }
  return next;
}

async function rotateTable(
  client: pg.PoolClient,
  table: 'grvt_credentials' | 'grvt_sub_accounts',
  idColumn: string,
  oldKey: Buffer,
  nextKey: Buffer,
): Promise<number> {
  const rows = await client.query<Row>(`SELECT * FROM ${table}`);
  for (const row of rows.rows) {
    const next = recrypt(row, oldKey, nextKey);
    const assignments = FIELDS.flat().map((column, index) => `${column} = $${index + 1}`);
    const values = FIELDS.flat().map((column) => next[column]);
    values.push(String(row[idColumn]));
    await client.query(
      `UPDATE ${table} SET ${assignments.join(', ')} WHERE ${idColumn} = $${values.length}`,
      values,
    );
  }
  return rows.rowCount ?? 0;
}

async function main(): Promise<void> {
  const oldKey = masterKeyFromBase64(process.env.CREDENTIAL_MASTER_KEY, 'CREDENTIAL_MASTER_KEY');
  const nextKey = masterKeyFromBase64(process.env.CREDENTIAL_MASTER_KEY_NEXT, 'CREDENTIAL_MASTER_KEY_NEXT');
  if (oldKey.equals(nextKey)) throw new Error('CREDENTIAL_MASTER_KEY_NEXT must differ from the current key');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const credentials = await rotateTable(client, 'grvt_credentials', 'user_id', oldKey, nextKey);
    const subAccounts = await rotateTable(client, 'grvt_sub_accounts', 'id', oldKey, nextKey);
    await client.query('COMMIT');
    console.log(`re-encrypted ${credentials} credential rows and ${subAccounts} sub-accounts`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'rotation failed');
  process.exit(1);
});
