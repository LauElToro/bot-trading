import { describe, expect, it } from 'vitest';
import { traderSearchPattern } from '../src/server/trader-search';

describe('trader search', () => {
  it('treats LauToro#LAS as one identifier and keeps near-misses apart', () => {
    expect(traderSearchPattern('LauToro#LAS')).toEqual({
      exact: 'lautoro#las',
      like: 'lautoro#las%',
    });
    expect(traderSearchPattern('LauToro#La')?.like).toBe('lautoro#la%');
    expect(traderSearchPattern('LauToroo#LAS')?.exact).toBe('lautoroo#las');
    expect(traderSearchPattern('LauToro#LAS')?.exact).not.toBe(traderSearchPattern('LauToro#La')?.exact);
    expect(traderSearchPattern('LauToro#LAS')?.exact).not.toBe(traderSearchPattern('LauToroo#LAS')?.exact);
  });

  it('searches by name prefix and by tag', () => {
    expect(traderSearchPattern('LauToro')?.like).toBe('lautoro%');
    expect(traderSearchPattern('#LAS')?.like).toBe('%#las%');
    expect(traderSearchPattern('LauToro#')?.like).toBe('lautoro#%');
  });

  it('rejects a query that is too short or has spaces inside the tag', () => {
    expect(traderSearchPattern('a')).toBeNull();
    expect(traderSearchPattern('Lau Toro#LAS')?.exact).toBe('lau toro#las');
    expect(traderSearchPattern('LauToro#La s')).toBeNull();
  });
});
