import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

// Read-only fixtures: never write here.
const RUNS = fileURLToPath(new URL('../runs', import.meta.url));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight(RUNS, '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads 5 jobs sorted by job, and counts the truncated line as bad', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
  });

  it('keeps the row with a null owner', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('keeps the last error after a recovered retry', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('aggregates lane/sync across the night, times verbatim', () => {
    expect(row('lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('reports the failed job with its error', () => {
    expect(row('notes/backup')).toMatchObject({
      owner: 'lane-07',
      runs: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
    expect(row('rig/rotate-logs')).toMatchObject({ owner: 'lane-07', runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('counts lines by status, matching the rows', () => {
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    const runs = night?.rows.reduce((n, r) => n + r.runs, 0);
    expect(runs).toBe(15);
  });
});

describe('readNight edge cases (temp runs dir)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-read-'));
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    writeFileSync(
      join(dir, '2026-01-02.jsonl'),
      [
        '',
        '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":null}',
        '   ',
        '[1,2]',
        '{"at":"2026-01-02T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
        '{"at":"2026-01-02T03:00:00+01:00","job":"a","status":"ok"}',
        'not json',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-03')).toBeNull();
  });

  it('returns no rows for an empty file', () => {
    expect(readNight(dir, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '2026-1-1')).toBeNull();
    expect(readNight(dir, '../2026-01-01')).toBeNull();
    expect(readNight(dir, '2026-01-01.jsonl')).toBeNull();
  });

  it('skips blank lines and counts wrong-shape lines as bad', () => {
    const n = readNight(dir, '2026-01-02');
    expect(n?.badLines).toBe(4);
    expect(n?.rows).toHaveLength(1);
    expect(n?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });
});
