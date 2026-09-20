import { describe, expect, it } from 'vitest';
import { getHealthReport, loadConfig } from '../src/index';

describe('notifier configuration', () => {
  it('prefers NOTIFIER_DATABASE_URL and falls back to DATABASE_URL', () => {
    expect(loadConfig({
      NOTIFIER_DATABASE_URL: 'postgresql://notifier',
      DATABASE_URL: 'postgresql://shared',
    }).databaseUrl).toBe('postgresql://notifier');
    expect(loadConfig({ DATABASE_URL: 'postgresql://shared' }).databaseUrl)
      .toBe('postgresql://shared');
  });

  it('requires an external database URL', () => {
    expect(() => loadConfig({})).toThrow(
      'NOTIFIER_DATABASE_URL or DATABASE_URL is required',
    );
  });
});

describe('notifier health', () => {
  it('reports cached tick and successful ping state', () => {
    const report = getHealthReport(10_000, 1_000, 9_500, 3, 9_750, true, null);

    expect(report.healthy).toBe(true);
    expect(report.body).toMatchObject({
      status: 'ok',
      lastTickAt: 9_500,
      tickCount: 3,
      lastDbPingAt: 9_750,
      dbPingOk: true,
    });
  });

  it('reports the last database failure without performing a query', () => {
    const report = getHealthReport(10_000, 1_000, 9_500, 3, 9_750, false, 'down');

    expect(report.healthy).toBe(false);
    expect(report.body).toMatchObject({
      status: 'db_error',
      dbPingOk: false,
      dbPingError: 'down',
    });
  });

  it('reports stale ticks', () => {
    const report = getHealthReport(10_000, 1_000, 6_000, 3, 9_750, true, null);

    expect(report.healthy).toBe(false);
    expect(report.body.status).toBe('stale');
  });
});
