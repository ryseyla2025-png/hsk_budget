/**
 * Data layer — replaces SpreadsheetApp table_/insert_/update_/patchRow_ and LockService.
 *
 *  - Reads: one batchGet of all core sheets, cached in memory for SNAPSHOT_TTL_MS and shared by
 *    every request on this server instance. Hand edits in the sheet show up after the TTL.
 *  - Writes: always inside withLock_(). The lock is a ticket queue on the hidden _Locks sheet
 *    (Google serialises appends, so row order = arrival order). Inside the lock the data is
 *    re-read fresh, the action runs synchronously against it (like the original Apps Script),
 *    and all writes are buffered and flushed at the end: cell updates first, then row appends.
 *  - Columns are located by header name, so manually re-ordered / extra columns are tolerated.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { CORE_SHEETS, LOCK_SHEET, NUMERIC_COLS } from './config';
import { append, batchGet, batchUpdate, colLetter, getValues, q } from './google';
import { userErr } from './util';

export type Rec = Record<string, any> & { _row: number };

export class Table {
  rows: Rec[] = [];
  constructor(public name: string, public headers: string[], public lastRow: number) {}

  static fromValues(name: string, values: any[][], firstRow = 1): Table {
    const headers = (values[0] || []).map((h) => String(h ?? '').trim());
    const t = new Table(name, headers, firstRow - 1 + values.length);
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      if (!r.some((v) => v !== '' && v !== null && v !== undefined)) continue; // skip blank rows
      t.rows.push(rowToRec(headers, r, firstRow + i));
    }
    return t;
  }

  col(key: string): number {
    const i = this.headers.indexOf(key);
    if (i < 0) throw new Error(`Sheet ${this.name} is missing column "${key}" — run npm run setup-sheet`);
    return i;
  }
}

function norm(key: string, v: any): any {
  if (v === undefined || v === null) return '';
  if (NUMERIC_COLS[key]) {
    if (typeof v === 'number' || v === '') return v;
    const n = Number(String(v).replace(/,/g, ''));
    return String(v).trim() !== '' && isFinite(n) ? n : v;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function rowToRec(headers: string[], r: any[], rowNo: number): Rec {
  const o: Rec = { _row: rowNo };
  headers.forEach((h, j) => { if (h) o[h] = norm(h, r[j]); });
  return o;
}

function cellOut(v: any): any {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  return String(v);
}

export class Db {
  tables: Record<string, Table> = {};
  version = '';
  /** last AuditLog hash (only set for write contexts) */
  auditTail: { hash: string; row: number } | null = null;
  private updates = new Map<string, any>(); // A1 cell → value
  private appends: { table: Table; rec: Rec }[] = [];
  private pending = new Set<Rec>();

  table(name: string): Table {
    const t = this.tables[name];
    if (!t) throw new Error(`Sheet ${name} not loaded`);
    return t;
  }

  insert(name: string, obj: Record<string, any>): Rec {
    const t = this.table(name);
    Object.keys(obj).forEach((k) => t.col(k)); // fail early if a column is missing
    t.lastRow += 1;
    const rec: Rec = { _row: t.lastRow };
    t.headers.forEach((h) => { if (h) rec[h] = obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
    t.rows.push(rec);
    this.appends.push({ table: t, rec });
    this.pending.add(rec);
    return rec;
  }

  patch(name: string, rec: Rec, patch: Record<string, any>): void {
    const t = this.table(name);
    Object.keys(patch).forEach((k) => {
      const c = t.col(k);
      rec[k] = patch[k];
      if (!this.pending.has(rec)) this.updates.set(`${q(name)}!${colLetter(c + 1)}${rec._row}`, cellOut(patch[k]));
    });
  }

  hasWrites(): boolean {
    return this.updates.size > 0 || this.appends.length > 0;
  }

  async flush(): Promise<void> {
    // 1) cell updates (counters such as receipt_seq go first so a failure later can only create gaps, never duplicates)
    await batchUpdate([...this.updates.entries()].map(([range, v]) => ({ range, values: [[v]] })));
    this.updates.clear();
    // 2) appends, grouped per sheet in first-use order
    const order: Table[] = [];
    const bySheet = new Map<Table, Rec[]>();
    for (const a of this.appends) {
      if (!bySheet.has(a.table)) { bySheet.set(a.table, []); order.push(a.table); }
      bySheet.get(a.table)!.push(a.rec);
    }
    for (const t of order) {
      const recs = bySheet.get(t)!;
      const values = recs.map((r) => t.headers.map((h) => (h ? cellOut(r[h]) : '')));
      await append(`${q(t.name)}!A${recs[0]._row}`, values, 'OVERWRITE');
    }
    this.appends = [];
    this.pending.clear();
  }
}

/* ---------------- Shared read snapshot ---------------- */

const SNAPSHOT_TTL_MS = 4000;
let snap: { db: Db; at: number } | null = null;
let snapLoading: Promise<Db> | null = null;

async function fetchCore(extraRanges: string[] = []): Promise<{ db: Db; extra: any[][][] }> {
  const vals = await batchGet([...CORE_SHEETS.map((s) => q(s)), ...extraRanges]);
  const db = new Db();
  const h = createHash('sha1');
  CORE_SHEETS.forEach((s, i) => {
    db.tables[s] = Table.fromValues(s, vals[i]);
    h.update(s).update(JSON.stringify(vals[i]));
  });
  db.version = h.digest('hex').slice(0, 16);
  return { db, extra: vals.slice(CORE_SHEETS.length) };
}

/** Read-only snapshot (shared, do not mutate). */
export async function getSnapshot(): Promise<Db> {
  if (snap && Date.now() - snap.at < SNAPSHOT_TTL_MS) return snap.db;
  if (!snapLoading) {
    snapLoading = fetchCore()
      .then(({ db }) => { snap = { db, at: Date.now() }; return db; })
      .finally(() => { snapLoading = null; });
  }
  return snapLoading;
}

export function invalidateSnapshot(): void {
  snap = null;
}

/** Full AuditLog (for the audit view / verification). */
export async function loadAuditLog(db: Db): Promise<void> {
  db.tables.AuditLog = Table.fromValues('AuditLog', await getValues(q('AuditLog')));
}

/** Fresh copy for a write: core sheets + AuditLog header + the tail of AuditLog (from the audit_tail_row hint). */
async function loadFresh(): Promise<Db> {
  const { db, extra } = await fetchCore([`${q('AuditLog')}!1:1`]);
  const auditHeaders = (extra[0][0] || []).map((x: any) => String(x ?? '').trim());
  const hintRec = db.table('Settings').rows.find((r) => r.Key === 'audit_tail_row');
  let hint = Math.max(2, parseInt(String(hintRec?.Value || '2'), 10) || 2);
  const lastCol = colLetter(Math.max(auditHeaders.length, 8));
  let tail = await getValues(`${q('AuditLog')}!A${hint}:${lastCol}`);
  if (!tail.some((r) => r && r.some((v: any) => v !== '' && v != null)) && hint > 2) {
    hint = 2; // stale hint (rows removed by hand) → read the whole log
    tail = await getValues(`${q('AuditLog')}!A2:${lastCol}`);
  }
  const t = new Table('AuditLog', auditHeaders, hint - 1 + tail.length);
  tail.forEach((r, i) => { if (r && r.some((v: any) => v !== '' && v != null)) t.rows.push(rowToRec(auditHeaders, r, hint + i)); });
  db.tables.AuditLog = t;
  const last = t.rows[t.rows.length - 1];
  db.auditTail = last ? { hash: String(last.Hash), row: last._row } : { hash: 'GENESIS', row: 1 };
  // keep the hint close to the end so future reads stay small
  if (last && last._row - hint > 50) {
    if (hintRec) db.patch('Settings', hintRec, { Value: String(last._row) });
    else db.insert('Settings', { Key: 'audit_tail_row', Value: String(last._row) });
  }
  return db;
}

/* ---------------- Request context ---------------- */

interface Ctx { db: Db; locked: boolean }
const als = new AsyncLocalStorage<Ctx>();

export function runWithDb<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return als.run({ db, locked: false }, fn);
}

export function ctxDb(): Db {
  const c = als.getStore();
  if (!c) throw new Error('No request context');
  return c.db;
}

/* ---------------- Ticket lock on the _Locks sheet ---------------- */

const LOCK_TTL_MS = 30000;
const LOCK_WAIT_MS = 25000;
const LOCK_WINDOW = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(): Promise<number> {
  const row = await append(`${q(LOCK_SHEET)}!A1`, [[randomUUID(), Date.now(), 'WAIT']], 'INSERT_ROWS');
  if (!row) throw new Error('Lock append failed');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const start = Math.max(2, row - LOCK_WINDOW);
    let blocked = false;
    if (row > start) {
      const vals = await getValues(`${q(LOCK_SHEET)}!A${start}:C${row - 1}`);
      const now = Date.now();
      blocked = vals.some((r) => r && r[2] === 'WAIT' && now - Number(r[1]) < LOCK_TTL_MS);
    }
    if (!blocked) return row;
    if (Date.now() > deadline) {
      await releaseLock(row).catch(() => {});
      throw userErr('ប្រព័ន្ធកំពុងរវល់ សូមព្យាយាមម្ដងទៀត');
    }
    await sleep(400 + Math.random() * 500);
  }
}

async function releaseLock(row: number): Promise<void> {
  await batchUpdate([{ range: `${q(LOCK_SHEET)}!C${row}`, values: [['DONE']] }]);
}

/**
 * Serialised write section (replaces withLock_ + LockService).
 * fn runs synchronously against freshly-read data; its buffered writes are flushed before the lock is released.
 */
export async function withLock_<T>(fn: () => T): Promise<T> {
  const c = als.getStore();
  if (!c) throw new Error('No request context');
  if (c.locked) return fn();
  const ticket = await acquireLock();
  const prevDb = c.db;
  try {
    const db = await loadFresh();
    c.db = db;
    c.locked = true;
    const out = fn();
    if (db.hasWrites()) await db.flush();
    return out;
  } finally {
    c.locked = false;
    c.db = prevDb;
    invalidateSnapshot();
    await releaseLock(ticket).catch((e) => console.error('lock release failed', e));
  }
}
