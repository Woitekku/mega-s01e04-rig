import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The edge: anything that is not exactly a RunLine is a bad line.
export function isRunLine(v: unknown): v is RunLine {
  if (!isRecord(v)) return false;
  return (
    typeof v.at === 'string' &&
    typeof v.job === 'string' &&
    typeof v.status === 'string' &&
    (STATUSES as readonly string[]).includes(v.status) &&
    (typeof v.owner === 'string' || v.owner === null) &&
    (v.error === undefined || typeof v.error === 'string')
  );
}

function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  return isRunLine(v) ? v : null;
}

function readFileOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if (isRecord(e) && e.code === 'ENOENT') return null;
    throw e;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readFileOrNull(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const byJob = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const error = line.error ?? null;
    const row = byJob.get(line.job);
    if (row === undefined) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: error,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs++;
    if (line.status === 'retry') row.retries++;
    row.lastStatus = line.status;
    if (error !== null) row.lastError = error;
    row.lastAt = line.at;
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const result: Night = { night, rows, badLines, counts };
  return result;
};
