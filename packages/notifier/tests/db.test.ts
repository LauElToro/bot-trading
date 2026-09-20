import { describe, expect, it, vi } from 'vitest';
import { NotifierDb, type DbPool } from '../src/db';

function mockPool(rows: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe('NotifierDb', () => {
  it('uses PostgreSQL parameters for notifier reads', async () => {
    const pool = mockPool([{ price: 123.45 }]);
    const db = new NotifierDb('', pool as unknown as DbPool);

    await expect(db.getLastFillPrice(42)).resolves.toBe(123.45);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE bot_id = $1'),
      [42],
    );
  });

  it('passes cursor and limit as separate PostgreSQL parameters', async () => {
    const pool = mockPool([]);
    const db = new NotifierDb('', pool as unknown as DbPool);

    await db.getRoundtripsSince(7, 25);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $2'),
      [7, 25],
    );
  });

  it('pings and closes the injected pool without network access', async () => {
    const pool = mockPool([{ '?column?': 1 }]);
    const db = new NotifierDb('', pool as unknown as DbPool);

    await db.ping();
    await db.close();

    expect(pool.query).toHaveBeenCalledWith('SELECT 1', []);
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
