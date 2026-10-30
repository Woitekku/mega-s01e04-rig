// Plan morning-digest § 1. The contract the reader (#2) implements and every part of § 2
// codes against. Types only; no implementation here.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl. A line that is not JSON, or is JSON but not this shape,
// is a bad line: counted in `badLines`, never thrown.
export type RunLine = {
  at: string; // ISO 8601 with the log's offset, e.g. 2026-10-29T01:30:00+01:00
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. "Line" below means a parsed line of that job; bad lines never count.
// The log is append-only, so file order is time order: "first"/"last" mean file order.
export type DigestRow = {
  job: string;
  owner: string | null; // owner of the job's last line; null renders as `—`
  runs: number; // all lines of the job, any status (retries included)
  retries: number; // lines with status 'retry'
  lastStatus: RunStatus; // status of the job's last line
  // Error of the job's latest line that carries one, even if a later line is ok;
  // null if no line of the job has an error.
  lastError: string | null;
  firstAt: string; // `at` of the job's first line, verbatim (offset kept, never UTC)
  lastAt: string; // `at` of the job's last line, verbatim
};

// Lines per status across the whole night (§ 2c). ok + retry + fail = sum of rows' runs.
export type StatusCounts = { ok: number; retry: number; fail: number };

// What a read of one night returns when runs/<night>.jsonl exists.
// An empty file (or one with only blank lines) is { rows: [], badLines: 0, counts all 0 }:
// "nothing ran". Blank lines are skipped, not counted as bad.
export type Night = {
  night: string; // YYYY-MM-DD, as asked
  rows: DigestRow[]; // sorted by job (plain string compare); page and JSON use this order
  badLines: number; // non-blank lines that did not parse into a RunLine
  counts: StatusCounts;
};

// Reads runsDir/<night>.jsonl. `night` is YYYY-MM-DD.
// Returns null when there is no such file (§ 2a: 404), including when `night` is not
// YYYY-MM-DD. Any other I/O error throws.
export type ReadNight = (runsDir: string, night: string) => Night | null;
