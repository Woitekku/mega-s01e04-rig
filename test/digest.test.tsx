import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const NIGHT = '2026-10-28'; // three jobs, one truncated line
const EMPTY = '2026-10-27'; // empty file
const MISSING = '2026-10-26'; // no file
const JOBS = ['backup-db', 'cache-warm', 'invoice-export']; // sorted by job
const WARN_JOBS = ['cache-warm', 'invoice-export']; // 3 retries; last status fail
const OK_JOB = 'backup-db';

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  writeFileSync(
    join(runsDir, `${NIGHT}.jsonl`),
    [
      '{"at":"2026-10-28T01:00:00+01:00","job":"invoice-export","status":"fail","owner":"billing","error":"timeout"}',
      '{"at":"2026-10-28T01:10:00+01:00","job":"cache-warm","status":"retry","owner":null,"error":"upstream 503"}',
      '{"at":"2026-10-28T01:11:00+01:00","job":"cache-warm","status":"retry","owner":null,"error":"upstream 503"}',
      '{"at":"2026-10-28T01:12:00+01:00","job":"cache-warm","status":"retry","owner":null}',
      '{"at":"2026-10-28T01:13:00+01:00","job":"cache-warm","status":"ok","owner":null}',
      '{"at":"2026-10-28T02:00:00+01:00","job":"backup-db","status":"ok","owner":"ops"}',
      '{"at":"2026-10-28T02:3',
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The <tr> block that contains a given job name.
function rowFor(html: string, job: string): string {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((r) => r.includes(job));
  if (!row) throw new Error(`no row for ${job}`);
  return row;
}

describe('GET /digest/:night', () => {
  it('renders each job in the usual layout with the lane banner', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await app.request(`/digest/${NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    for (const job of JOBS) expect(html).toContain(job);
  });

  it('marks jobs with 3+ retries or a last status of fail as class="warn"', async () => {
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    for (const job of WARN_JOBS) expect(rowFor(html, job)).toContain('class="warn"');
    expect(rowFor(html, OK_JOB)).not.toContain('class="warn"');
  });

  it('answers 200 with "nothing ran" for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night shape with rows sorted by job', async () => {
    const res = await app.request(`/api/digest/${NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      night: string;
      rows: { job: string }[];
      badLines: number;
      counts: { ok: number; retry: number; fail: number };
    };
    expect(body.night).toBe(NIGHT);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
    expect(body.badLines).toBe(1);
    expect(body.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
  });

  it('lists jobs in the same order as the page', async () => {
    const html = await (await app.request(`/digest/${NIGHT}`)).text();
    const body = (await (await app.request(`/api/digest/${NIGHT}`)).json()) as {
      rows: { job: string }[];
    };
    const positions = body.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('returns empty rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });
});
