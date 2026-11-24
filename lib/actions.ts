/**
 * API actions — a line-by-line port of Code.gs v2.0.0 (ACTIONS_ and everything below it).
 * Business rules, validation messages (Khmer) and report maths are unchanged.
 *
 * Changes in v3.0:
 *  - Auth is Google Sign-In: login/logout/changePassword/resetPassword and PBKDF2 are gone.
 *    A user is identified by the Email column on the Users sheet.
 *  - recordPayment_ reads receipt_seq inside the lock (the original read it before the lock).
 *  - backup_ calls the small Apps Script web app (apps-script/Backup.gs) to copy the spreadsheet in Drive.
 *  - new `version` action used by the browser's 5-second live-update poll.
 */
import { createHash } from 'node:crypto';
import { APP, type Role } from './config';
import { ctxDb, withLock_, type Rec } from './db';
import { clampMonth_, cleanText_, fmtTs, mk_, now_, num_, sumRows_, today_, userErr } from './util';

/* ---------------- data helpers (same names as Code.gs) ---------------- */

const table_ = (name: string): Rec[] => ctxDb().table(name).rows;
const insert_ = (name: string, obj: Record<string, any>) => ctxDb().insert(name, obj);
const patchRow_ = (name: string, rec: Rec, patch: Record<string, any>) => ctxDb().patch(name, rec, patch);

export interface Settings {
  raw: Record<string, string>;
  schoolName: string; ministry: string; provinceOffice: string; location: string; schoolYear: string;
  months: string[]; generalFee: number; poorFee: number; teacherCanRecord: boolean;
}

export function settings_(): Settings {
  const raw: Record<string, string> = {};
  table_('Settings').forEach((r) => { raw[r.Key] = String(r.Value); });
  let months: string[] = [];
  try { months = JSON.parse(raw.months_json || '[]'); } catch { months = []; }
  if (!Array.isArray(months) || !months.length) months = APP.DEFAULT_MONTHS.slice();
  return {
    raw, schoolName: raw.school_name || '', ministry: raw.ministry || '', provinceOffice: raw.province_office || '',
    location: raw.location || '', schoolYear: raw.school_year || '', months,
    generalFee: num_(raw.general_fee), poorFee: num_(raw.poor_fee), teacherCanRecord: raw.teacher_can_record === 'YES',
  };
}

function setSetting_(k: string, v: string) {
  const r = table_('Settings').filter((x) => x.Key === k)[0];
  if (r) patchRow_('Settings', r, { Value: String(v) });
  else insert_('Settings', { Key: k, Value: String(v) });
}

export function findUser_(username: string): Rec | null {
  username = String(username || '').toLowerCase();
  return table_('Users').filter((u) => String(u.Username).toLowerCase() === username)[0] || null;
}

export function findUserByEmail_(email: string): Rec | null {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  return table_('Users').filter((u) => String(u.Email || '').trim().toLowerCase() === email)[0] || null;
}

function findStudent_(code: any): Rec {
  const s = table_('Students').filter((x) => x.Code === String(code || ''))[0];
  if (!s) throw userErr('រកមិនឃើញសិស្ស');
  return s;
}

function findClass_(id: string): Rec | null {
  return table_('Classes').filter((c) => c.ClassId === id)[0] || null;
}

function nextStudentCode_(classId: string): string {
  let max = 0;
  const re = new RegExp('^' + classId.replace(/[^A-Za-z0-9]/g, '') + '-(\\d+)$');
  table_('Students').forEach((s) => {
    const m = re.exec(String(s.Code));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return classId + '-' + (max + 1);
}

function byCode_(a: Rec, b: Rec) {
  const na = parseInt(String(a.Code).split('-').pop()!, 10) || 0;
  const nb = parseInt(String(b.Code).split('-').pop()!, 10) || 0;
  return na - nb;
}

function userClasses_(user: Rec): string[] {
  if (user.Role !== 'TEACHER') return ['*'];
  return String(user.AllowedClasses || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function visibleClasses_(user: Rec): Rec[] {
  const cls = table_('Classes').slice().sort((a, b) => num_(a.SortOrder) - num_(b.SortOrder));
  if (user.Role !== 'TEACHER') return cls;
  const allowed: Record<string, boolean> = {};
  userClasses_(user).forEach((c) => { allowed[c] = true; });
  return cls.filter((c) => allowed[c.ClassId]);
}

function assertClass_(user: Rec, classId: string) {
  if (!findClass_(classId)) throw userErr('ថ្នាក់មិនត្រឹមត្រូវ');
  if (user.Role === 'TEACHER' && userClasses_(user).indexOf(classId) < 0) throw userErr('អ្នកគ្មានសិទ្ធិលើថ្នាក់នេះទេ', 'FORBIDDEN');
}

function monthParam_(m: any, months: string[]): string {
  m = mk_(m);
  if (months.indexOf(m) >= 0) return m;
  return clampMonth_(today_().slice(0, 7), months);
}

/* ---------------- audit hash chain ---------------- */

const sha256hex_ = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function auditHash_(prev: string, r: Record<string, any>): string {
  return sha256hex_([prev, r.Timestamp, r.Actor, r.Action, r.Entity, r.EntityId, r.Summary].map(String).join('|'));
}

export function audit_(actor: string, action: string, entity: string, id: string, summary: string) {
  const db = ctxDb();
  if (!db.auditTail) throw new Error('audit_ called outside withLock_');
  const prev = db.auditTail.hash;
  const rec: Record<string, any> = {
    Timestamp: now_(), Actor: String(actor || ''), Action: action, Entity: entity, EntityId: String(id || ''),
    Summary: cleanText_(summary, 500), PrevHash: prev,
  };
  rec.Hash = auditHash_(prev, rec);
  const r = insert_('AuditLog', rec);
  db.auditTail = { hash: rec.Hash, row: r._row };
}

/* ---------------- Auth / bootstrap ---------------- */

/** Called from the Auth.js signIn callback (inside a request context). Records LastLoginAt + LOGIN audit. */
export async function recordLogin_(user: Rec) {
  return withLock_(() => {
    const u = findUser_(user.Username);
    if (!u) return;
    patchRow_('Users', u, { LastLoginAt: now_() });
    audit_(u.Username, 'LOGIN', 'Session', '', 'Google sign-in ' + String(u.Email || ''));
  });
}

function bootstrap_(_p: any, user: Rec) {
  const st = settings_();
  return {
    user: { username: user.Username, displayName: user.DisplayName, email: user.Email, role: user.Role, classes: userClasses_(user) },
    settings: {
      schoolName: st.schoolName, ministry: st.ministry, provinceOffice: st.provinceOffice, location: st.location,
      schoolYear: st.schoolYear, months: st.months, generalFee: st.generalFee, poorFee: st.poorFee,
      teacherCanRecord: st.teacherCanRecord, categories: APP.CATEGORIES, methods: APP.METHODS,
      expenseTypes: APP.EXPENSE_TYPES, expenseCategories: APP.EXPENSE_CATEGORIES, version: APP.VERSION,
    },
    classes: visibleClasses_(user).map((c) => c.ClassId),
    allClasses: table_('Classes').map((c) => ({ classId: c.ClassId, active: c.Active === 'YES' })),
    today: today_(),
    currentMonth: today_().slice(0, 7),
  };
}

/* ---------------- Ledger (computed from transactions) ---------------- */

interface Line { m: string; cm: string; a: number; r: string }
interface Ledger { st: Settings; months: string[]; lines: Record<string, Line[]>; students: Rec[] }

function ledger_(): Ledger {
  const st = settings_();
  const months = st.months;
  const receipts: Record<string, Rec> = {};
  table_('Receipts').forEach((r) => { receipts[r.ReceiptNo] = r; });
  const lines: Record<string, Line[]> = {};
  table_('PaymentLines').forEach((l) => {
    if (l.Status !== 'ACTIVE') return;
    const r = receipts[l.ReceiptNo];
    if (!r || r.Status !== 'ACTIVE') return;
    const code = String(l.StudentCode);
    (lines[code] = lines[code] || []).push({ m: mk_(l.MonthKey), cm: clampMonth_(mk_(r.PaidDate), months), a: num_(l.Amount), r: l.ReceiptNo });
  });
  const students = table_('Students');
  return { st, months, lines, students };
}

const fee_ = (s: Rec, st: Settings) => (s.Category === 'POOR' ? st.poorFee : st.generalFee);

function enrolled_(s: Rec, months: string[]): string[] {
  const a = mk_(s.StartMonth) || months[0];
  const b = mk_(s.EndMonth) || months[months.length - 1];
  return months.filter((m) => m >= a && m <= b);
}

interface GridCell { m: string; due: number; paid: number; bal: number; enrolled: boolean }

function studentGrid_(s: Rec, L: Ledger): GridCell[] {
  const fee = fee_(s, L.st);
  const en: Record<string, boolean> = {};
  enrolled_(s, L.months).forEach((m) => { en[m] = true; });
  const paid: Record<string, number> = {};
  (L.lines[s.Code] || []).forEach((x) => { paid[x.m] = (paid[x.m] || 0) + x.a; });
  return L.months.map((m) => {
    const due = en[m] ? fee : 0;
    const p = paid[m] || 0;
    return { m, due, paid: p, bal: Math.max(0, due - p), enrolled: !!en[m] };
  });
}

function monthStatus_(g: GridCell) {
  if (!g.enrolled) return 'NA';
  if (g.paid >= g.due) return 'PAID';
  if (g.paid > 0) return 'PARTIAL';
  return 'UNPAID';
}

/* ---------------- Reports ---------------- */

function monthlyReport_(p: any, user: Rec) {
  const L = ledger_();
  const M = monthParam_(p.month, L.months);
  const classes = visibleClasses_(user);
  const byClass: Record<string, any> = {};
  classes.forEach((c) => {
    byClass[c.ClassId] = { classId: c.ClassId, students: 0, gen: 0, poor: 0, due: 0, paidForMonth: 0, cashCurrent: 0, cashPrev: 0, cashAdvance: 0, cashTotal: 0, outstanding: 0, unpaidStudents: 0 };
  });
  L.students.forEach((s) => {
    const row = byClass[s.ClassId];
    if (!row) return;
    const fee = fee_(s, L.st);
    const en = enrolled_(s, L.months);
    const enSet: Record<string, boolean> = {};
    en.forEach((m) => { enSet[m] = true; });
    if (enSet[M]) {
      row.students++;
      if (s.Category === 'POOR') row.poor++; else row.gen++;
      row.due += fee;
    }
    const dueToM = en.filter((m) => m <= M).length * fee;
    let paidToM = 0, paidForM = 0;
    (L.lines[s.Code] || []).forEach((x) => {
      if (x.cm === M) {
        row.cashTotal += x.a;
        if (x.m === M) row.cashCurrent += x.a; else if (x.m < M) row.cashPrev += x.a; else row.cashAdvance += x.a;
      }
      if (x.cm <= M && x.m <= M) paidToM += x.a;
      if (x.cm <= M && x.m === M) paidForM += x.a;
    });
    row.paidForMonth += paidForM;
    const out = Math.max(0, dueToM - paidToM);
    row.outstanding += out;
    if (enSet[M] && paidForM < fee) row.unpaidStudents++;
  });
  const rows = classes.map((c) => {
    const r = byClass[c.ClassId];
    r.rate = r.due ? r.paidForMonth / r.due : 0;
    return r;
  });
  const total: any = sumRows_(rows, ['students', 'gen', 'poor', 'due', 'paidForMonth', 'cashCurrent', 'cashPrev', 'cashAdvance', 'cashTotal', 'outstanding', 'unpaidStudents']);
  total.rate = total.due ? total.paidForMonth / total.due : 0;
  return { month: M, rows, total, generatedAt: now_() };
}

function annualReport_(_p: any, user: Rec) {
  const L = ledger_();
  const classes = visibleClasses_(user);
  const byClass: Record<string, any> = {};
  classes.forEach((c) => { byClass[c.ClassId] = { classId: c.ClassId, students: 0, gen: 0, poor: 0, withdrawn: 0, due: 0, paid: 0, outstanding: 0 }; });
  L.students.forEach((s) => {
    const row = byClass[s.ClassId];
    if (!row) return;
    const grid = studentGrid_(s, L);
    let due = 0, paid = 0;
    grid.forEach((g) => { due += g.due; paid += Math.min(g.paid, g.due); });
    if (!due && !paid) return;
    row.students++;
    if (s.Active !== 'YES') row.withdrawn++;
    if (s.Category === 'POOR') row.poor++; else row.gen++;
    row.due += due; row.paid += paid; row.outstanding += Math.max(0, due - paid);
  });
  const rows = classes.map((c) => { const r = byClass[c.ClassId]; r.rate = r.due ? r.paid / r.due : 0; return r; });
  const total: any = sumRows_(rows, ['students', 'gen', 'poor', 'withdrawn', 'due', 'paid', 'outstanding']);
  total.rate = total.due ? total.paid / total.due : 0;
  return { rows, total, generatedAt: now_() };
}

function financeReport_() {
  const L = ledger_();
  const income: Record<string, number> = {}, teacher: Record<string, number> = {}, other: Record<string, number> = {};
  L.months.forEach((m) => { income[m] = 0; teacher[m] = 0; other[m] = 0; });
  Object.keys(L.lines).forEach((code) => {
    L.lines[code].forEach((x) => { if (income[x.cm] !== undefined) income[x.cm] += x.a; });
  });
  table_('Expenses').forEach((e) => {
    if (e.Status !== 'ACTIVE') return;
    const m = clampMonth_(mk_(e.MonthKey), L.months);
    if (e.Type === 'TEACHER') teacher[m] += num_(e.Amount); else other[m] += num_(e.Amount);
  });
  let bal = 0;
  const rows = L.months.map((m) => {
    const net = income[m] - teacher[m] - other[m];
    bal += net;
    return { month: m, income: income[m], teacher: teacher[m], other: other[m], net, balance: bal };
  });
  const total: any = sumRows_(rows, ['income', 'teacher', 'other', 'net']);
  total.balance = bal;
  return { rows, total, generatedAt: now_() };
}

/* ---------------- Students ---------------- */

function classRoster_(p: any, user: Rec) {
  const classId = String(p.classId || '');
  assertClass_(user, classId);
  const L = ledger_();
  const M = monthParam_(p.month, L.months);
  const students = L.students.filter((s) => s.ClassId === classId).sort(byCode_);
  const rows = students.map((s) => {
    const grid = studentGrid_(s, L);
    const gM = grid.filter((g) => g.m === M)[0];
    const upto = grid.filter((g) => g.m <= M);
    const owed = upto.filter((g) => g.enrolled && g.bal > 0);
    let cashPrev = 0;
    (L.lines[s.Code] || []).forEach((x) => { if (x.cm === M && x.m < M) cashPrev += x.a; });
    return {
      code: s.Code, name: s.Name, sex: s.Sex, category: s.Category, fee: fee_(s, L.st),
      startMonth: mk_(s.StartMonth), endMonth: mk_(s.EndMonth), active: s.Active === 'YES', note: s.Note,
      monthDue: gM.due, monthPaid: gM.paid, monthStatus: monthStatus_(gM), cashPrev,
      owedMonths: owed.map((g) => g.m),
      outstanding: owed.reduce((a, g) => a + g.bal, 0),
      yearOutstanding: grid.reduce((a, g) => a + g.bal, 0),
      grid: grid.map((g) => monthStatus_(g)),
    };
  });
  const tot = { students: 0, due: 0, paid: 0, cashPrev: 0, outstanding: 0, paidCount: 0 };
  rows.forEach((r) => {
    if (r.monthStatus !== 'NA') { tot.students++; tot.due += r.monthDue; }
    tot.paid += r.monthPaid; tot.cashPrev += r.cashPrev; tot.outstanding += r.outstanding;
    if (r.monthStatus === 'PAID') tot.paidCount++;
  });
  return { classId, month: M, rows, total: tot };
}

function studentDetail_(p: any, user: Rec) {
  const s = findStudent_(p.code);
  assertClass_(user, s.ClassId);
  const L = ledger_();
  const grid = studentGrid_(s, L);
  const receipts = table_('Receipts').filter((r) => r.StudentCode === s.Code).map(receiptSummary_)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    student: {
      code: s.Code, name: s.Name, sex: s.Sex, classId: s.ClassId, category: s.Category, fee: fee_(s, L.st),
      startMonth: mk_(s.StartMonth), endMonth: mk_(s.EndMonth), active: s.Active === 'YES', note: s.Note,
    },
    grid, receipts,
  };
}

function saveStudent_(p: any, user: Rec) {
  const st = settings_();
  const name = cleanText_(p.name, 100);
  if (!name) throw userErr('សូមបញ្ចូលឈ្មោះសិស្ស');
  const sex = p.sex === 'ស' ? 'ស' : (p.sex === 'ប' ? 'ប' : null);
  if (!sex) throw userErr('សូមជ្រើសរើសភេទ');
  if (!APP.CATEGORIES[p.category]) throw userErr('ប្រភេទសិស្សមិនត្រឹមត្រូវ');
  const classId = String(p.classId || '');
  const cls = findClass_(classId);
  if (!cls || cls.Active !== 'YES') throw userErr('ថ្នាក់មិនត្រឹមត្រូវ');
  const start = mk_(p.startMonth) || st.months[0];
  const end = mk_(p.endMonth) || '';
  if (st.months.indexOf(start) < 0) throw userErr('ខែចាប់ផ្ដើមមិនស្ថិតក្នុងឆ្នាំសិក្សា');
  if (end && (st.months.indexOf(end) < 0 || end < start)) throw userErr('ខែបញ្ចប់មិនត្រឹមត្រូវ');
  const note = cleanText_(p.note, 200);

  return withLock_(() => {
    const st2 = settings_();
    if (p.code) {
      const s = findStudent_(p.code);
      if (s.ClassId !== classId && user.Role !== 'ADMIN') throw userErr('មានតែ Admin ទេដែលអាចផ្លាស់ប្ដូរថ្នាក់សិស្ស');
      const L = ledger_();
      const newFee = p.category === 'POOR' ? st2.poorFee : st2.generalFee;
      const paid: Record<string, number> = {};
      (L.lines[s.Code] || []).forEach((x) => { paid[x.m] = (paid[x.m] || 0) + x.a; });
      Object.keys(paid).forEach((m) => {
        if (m < start || (end && m > end)) throw userErr('មានការបង់ប្រាក់សម្រាប់ ' + m + ' ដែលនៅក្រៅខែសិក្សាថ្មី។ សូម VOID បង្កាន់ដៃនោះជាមុន។');
        if (paid[m] > newFee) throw userErr('ខែ ' + m + ' បានបង់ ' + paid[m] + ' ៛ លើសថ្លៃថ្មី។ មិនអាចប្ដូរប្រភេទបានទេ។');
      });
      const patch: Record<string, any> = { Name: name, Sex: sex, ClassId: classId, Category: p.category, StartMonth: start, EndMonth: end, Note: note, UpdatedAt: now_() };
      const diff = Object.keys(patch).filter((k) => k !== 'UpdatedAt' && String(s[k]) !== String(patch[k]))
        .map((k) => k + ': ' + s[k] + ' → ' + patch[k]).join('; ');
      patchRow_('Students', s, patch);
      audit_(user.Username, 'UPDATE', 'Student', s.Code, diff || 'no change');
      return { code: s.Code };
    }
    const code = nextStudentCode_(classId);
    insert_('Students', {
      Code: code, Name: name, Sex: sex, ClassId: classId, Category: p.category, StartMonth: start, EndMonth: end,
      Active: 'YES', Note: note, CreatedAt: now_(), UpdatedAt: now_(), CreatedBy: user.Username,
    });
    audit_(user.Username, 'CREATE', 'Student', code, name + ' | ' + classId + ' | ' + p.category + ' | from ' + start);
    return { code };
  });
}

function withdrawStudent_(p: any, user: Rec) {
  return withLock_(() => {
    const st = settings_();
    const s = findStudent_(p.code);
    if (p.reinstate) {
      patchRow_('Students', s, { Active: 'YES', EndMonth: '', UpdatedAt: now_() });
      audit_(user.Username, 'REINSTATE', 'Student', s.Code, 'Reinstated');
      return true;
    }
    const end = mk_(p.endMonth);
    const start = mk_(s.StartMonth) || st.months[0];
    if (st.months.indexOf(end) < 0 || end < start) throw userErr('សូមជ្រើសខែចុងក្រោយដែលសិស្សត្រូវបង់');
    const L = ledger_();
    (L.lines[s.Code] || []).forEach((x) => {
      if (x.m > end) throw userErr('សិស្សនេះបានបង់សម្រាប់ ' + x.m + ' រួចហើយ (បង្កាន់ដៃ ' + x.r + ')។ សូម VOID ជាមុន។');
    });
    const reason = cleanText_(p.reason, 200);
    patchRow_('Students', s, { Active: 'NO', EndMonth: end, Note: reason || s.Note, UpdatedAt: now_() });
    audit_(user.Username, 'WITHDRAW', 'Student', s.Code, 'Last billed month ' + end + (reason ? ' | ' + reason : ''));
    return true;
  });
}

function bulkAddStudents_(p: any, user: Rec) {
  const st = settings_();
  const classId = String(p.classId || '');
  const cls = findClass_(classId);
  if (!cls || cls.Active !== 'YES') throw userErr('ថ្នាក់មិនត្រឹមត្រូវ');
  const start = mk_(p.startMonth) || st.months[0];
  if (st.months.indexOf(start) < 0) throw userErr('ខែចាប់ផ្ដើមមិនត្រឹមត្រូវ');
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw userErr('គ្មានទិន្នន័យសិស្ស');
  if (rows.length > 80) throw userErr('បញ្ចូលបានច្រើនបំផុត ៨០ នាក់ក្នុងមួយលើក');
  const clean = rows.map((r: any, i: number) => {
    const name = cleanText_(r.name, 100);
    const sex = r.sex === 'ស' ? 'ស' : (r.sex === 'ប' ? 'ប' : null);
    const cat = APP.CATEGORIES[r.category] ? r.category : null;
    if (!name || !sex || !cat) throw userErr('ជួរទី ' + (i + 1) + ' មិនត្រឹមត្រូវ (ឈ្មោះ / ភេទ ប ឬ ស / ប្រភេទ)');
    return { name, sex, cat };
  });
  return withLock_(() => {
    const codes: string[] = [];
    clean.forEach((r: any) => {
      const code = nextStudentCode_(classId);
      insert_('Students', {
        Code: code, Name: r.name, Sex: r.sex, ClassId: classId, Category: r.cat, StartMonth: start, EndMonth: '',
        Active: 'YES', Note: '', CreatedAt: now_(), UpdatedAt: now_(), CreatedBy: user.Username,
      });
      codes.push(code);
    });
    audit_(user.Username, 'BULK_CREATE', 'Student', classId, codes.length + ' students: ' + codes[0] + '…' + codes[codes.length - 1]);
    return { count: codes.length };
  });
}

/* ---------------- Payments ---------------- */

function recordPayment_(p: any, user: Rec) {
  const st = settings_();
  if (user.Role === 'TEACHER' && !st.teacherCanRecord) throw userErr('គ្រូបន្ទុកថ្នាក់មិនមានសិទ្ធិកត់ត្រាការបង់ប្រាក់ទេ');
  const requestId = String(p.requestId || '').slice(0, 60);
  if (!/^[A-Za-z0-9-]{8,60}$/.test(requestId)) throw userErr('សំណើមិនត្រឹមត្រូវ (requestId)');
  const paidDate = String(p.paidDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || isNaN(Date.parse(paidDate))) throw userErr('កាលបរិច្ឆេទបង់មិនត្រឹមត្រូវ');
  if (paidDate > today_()) throw userErr('មិនអាចកត់ត្រាការបង់ប្រាក់សម្រាប់ថ្ងៃអនាគតបានទេ');
  if (APP.METHODS.indexOf(p.method) < 0) throw userErr('វិធីបង់ប្រាក់មិនត្រឹមត្រូវ');
  const note = cleanText_(p.note, 200);
  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (!lines.length) throw userErr('សូមជ្រើសខែយ៉ាងហោចណាស់មួយ');

  return withLock_(() => {
    const dup = table_('Receipts').filter((r) => r.RequestId === requestId)[0];
    if (dup) return receiptView_(dup.ReceiptNo);

    const s = findStudent_(p.studentCode);
    assertClass_(user, s.ClassId);
    const L = ledger_();
    const grid: Record<string, GridCell> = {};
    studentGrid_(s, L).forEach((g) => { grid[g.m] = g; });
    const seen: Record<string, boolean> = {};
    let total = 0;
    const clean = lines.map((ln: any) => {
      const m = mk_(ln.monthKey);
      const amt = Number(ln.amount);
      const g = grid[m];
      if (!g || !g.enrolled) throw userErr('ខែ ' + m + ' មិនមែនជាខែដែលសិស្សត្រូវបង់ទេ');
      if (seen[m]) throw userErr('ខែ ' + m + ' ស្ទួនគ្នា');
      seen[m] = true;
      if (!isFinite(amt) || amt <= 0 || Math.round(amt) !== amt) throw userErr('ចំនួនទឹកប្រាក់ខែ ' + m + ' មិនត្រឹមត្រូវ');
      if (amt % 100 !== 0) throw userErr('ទឹកប្រាក់ត្រូវជាពហុគុណនៃ ១០០ ៛');
      if (amt > g.bal) throw userErr('ខែ ' + m + ' នៅសល់ត្រូវបង់តែ ' + g.bal + ' ៛ ប៉ុណ្ណោះ (បង់លើស)');
      total += amt;
      return { m, a: amt };
    });

    const raw = settings_().raw; // fresh, inside the lock
    const seq = num_(raw.receipt_seq) + 1;
    const receiptNo = (raw.receipt_prefix || '') + ('000000' + seq).slice(-6);
    if (table_('Receipts').some((r) => r.ReceiptNo === receiptNo)) throw new Error('receipt_seq is behind existing receipts: ' + receiptNo);
    setSetting_('receipt_seq', String(seq));
    insert_('Receipts', {
      ReceiptNo: receiptNo, PaidDate: paidDate, StudentCode: s.Code, StudentName: s.Name, ClassId: s.ClassId,
      Total: total, Method: p.method, Note: note, RecordedBy: user.Username, Status: 'ACTIVE', CreatedAt: now_(),
      RequestId: requestId, VoidReason: '', VoidedAt: '', VoidedBy: '',
    });
    clean.forEach((x: any) => {
      insert_('PaymentLines', { ReceiptNo: receiptNo, StudentCode: s.Code, ClassId: s.ClassId, MonthKey: x.m, Amount: x.a, Status: 'ACTIVE' });
    });
    audit_(user.Username, 'CREATE', 'Receipt', receiptNo, s.Code + ' ' + s.Name + ' | ' + clean.map((x: any) => x.m + '=' + x.a).join(', ') + ' | total ' + total + ' | paid ' + paidDate);
    return receiptView_(receiptNo);
  });
}

function receiptSummary_(r: Rec) {
  return {
    receiptNo: r.ReceiptNo, paidDate: String(r.PaidDate).slice(0, 10), studentCode: r.StudentCode, studentName: r.StudentName,
    classId: r.ClassId, total: num_(r.Total), method: r.Method, status: r.Status, recordedBy: r.RecordedBy, createdAt: r.CreatedAt,
    voidReason: r.VoidReason, voidedBy: r.VoidedBy, voidedAt: r.VoidedAt, note: r.Note,
  };
}

function receiptView_(receiptNo: string) {
  const r = table_('Receipts').filter((x) => x.ReceiptNo === receiptNo)[0];
  if (!r) throw userErr('រកមិនឃើញបង្កាន់ដៃ');
  const lines = table_('PaymentLines').filter((l) => l.ReceiptNo === receiptNo)
    .map((l) => ({ month: mk_(l.MonthKey), amount: num_(l.Amount) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  return { ...receiptSummary_(r), lines };
}

function listReceipts_(p: any, user: Rec) {
  const st = settings_();
  const month = p.month ? mk_(p.month) : '';
  const classId = p.classId ? String(p.classId) : '';
  if (classId) assertClass_(user, classId);
  const allowed: Record<string, boolean> = {};
  visibleClasses_(user).forEach((c) => { allowed[c.ClassId] = true; });
  const q = String(p.q || '').trim().toLowerCase();
  const rows = table_('Receipts').filter((r) => {
    if (!allowed[r.ClassId]) return false;
    if (classId && r.ClassId !== classId) return false;
    if (month && clampMonth_(mk_(r.PaidDate), st.months) !== month) return false;
    if (q && (String(r.ReceiptNo) + ' ' + r.StudentCode + ' ' + r.StudentName).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).map(receiptSummary_).sort((a, b) => (a.receiptNo < b.receiptNo ? 1 : -1));
  const total = rows.reduce((a, r) => a + (r.status === 'ACTIVE' ? r.total : 0), 0);
  return { rows: rows.slice(0, 500), count: rows.length, total };
}

function getReceipt_(p: any, user: Rec) {
  const v = receiptView_(String(p.receiptNo || ''));
  assertClass_(user, v.classId);
  return v;
}

function voidReceipt_(p: any, user: Rec) {
  const reason = cleanText_(p.reason, 200);
  if (reason.length < 5) throw userErr('សូមសរសេរមូលហេតុនៃការ VOID (យ៉ាងតិច ៥ តួ)');
  return withLock_(() => {
    const r = table_('Receipts').filter((x) => x.ReceiptNo === String(p.receiptNo))[0];
    if (!r) throw userErr('រកមិនឃើញបង្កាន់ដៃ');
    if (r.Status !== 'ACTIVE') throw userErr('បង្កាន់ដៃនេះត្រូវបាន VOID រួចហើយ');
    patchRow_('Receipts', r, { Status: 'VOID', VoidReason: reason, VoidedAt: now_(), VoidedBy: user.Username });
    table_('PaymentLines').forEach((l) => { if (l.ReceiptNo === r.ReceiptNo) patchRow_('PaymentLines', l, { Status: 'VOID' }); });
    audit_(user.Username, 'VOID', 'Receipt', r.ReceiptNo, 'total ' + r.Total + ' | ' + reason);
    return true;
  });
}

/* ---------------- Expenses ---------------- */

function recordExpense_(p: any, user: Rec) {
  const st = settings_();
  const requestId = String(p.requestId || '').slice(0, 60);
  if (!/^[A-Za-z0-9-]{8,60}$/.test(requestId)) throw userErr('សំណើមិនត្រឹមត្រូវ (requestId)');
  const type = p.type === 'TEACHER' ? 'TEACHER' : (p.type === 'OTHER' ? 'OTHER' : null);
  if (!type) throw userErr('ប្រភេទចំណាយមិនត្រឹមត្រូវ');
  const date = String(p.expenseDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw userErr('កាលបរិច្ឆេទមិនត្រឹមត្រូវ');
  if (date > today_()) throw userErr('មិនអាចកត់ត្រាចំណាយសម្រាប់ថ្ងៃអនាគតបានទេ');
  const m = mk_(p.monthKey);
  if (st.months.indexOf(m) < 0) throw userErr('ខែមិនស្ថិតក្នុងឆ្នាំសិក្សា');
  const payee = cleanText_(p.payee, 100);
  if (!payee) throw userErr(type === 'TEACHER' ? 'សូមបញ្ចូលឈ្មោះគ្រូ' : 'សូមបញ្ចូលការបរិយាយចំណាយ');
  let hours: number | '' = '', rate: number | '' = '', amount: number, category: string;
  if (type === 'TEACHER') {
    hours = Number(p.hours); rate = Number(p.rate);
    if (!(hours > 0 && hours <= 300)) throw userErr('ចំនួនម៉ោងមិនត្រឹមត្រូវ');
    if (!(rate > 0 && Math.round(rate) === rate)) throw userErr('អត្រាប្រាក់ក្នុង១ម៉ោងមិនត្រឹមត្រូវ');
    amount = Math.round(hours * rate);
    category = cleanText_(p.category, 100) || 'ប្រាក់ម៉ោងបង្រៀន';
  } else {
    amount = Number(p.amount);
    if (!(amount > 0 && Math.round(amount) === amount)) throw userErr('ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ');
    category = APP.EXPENSE_CATEGORIES.indexOf(p.category) >= 0 ? p.category : 'ផ្សេងៗ';
  }
  const refNo = cleanText_(p.refNo, 50);
  const note = cleanText_(p.note, 200);
  return withLock_(() => {
    const dup = table_('Expenses').filter((e) => e.RequestId === requestId)[0];
    if (dup) return { expenseId: dup.ExpenseId };
    const seq = num_(settings_().raw.expense_seq) + 1;
    const id = 'EX-' + ('00000' + seq).slice(-5);
    setSetting_('expense_seq', String(seq));
    insert_('Expenses', {
      ExpenseId: id, ExpenseDate: date, MonthKey: m, Type: type, Payee: payee, Category: category, Hours: hours, Rate: rate,
      Amount: amount, RefNo: refNo, Note: note, RecordedBy: user.Username, Status: 'ACTIVE', CreatedAt: now_(), RequestId: requestId,
      VoidReason: '', VoidedAt: '', VoidedBy: '',
    });
    audit_(user.Username, 'CREATE', 'Expense', id, type + ' | ' + payee + ' | ' + m + ' | ' + amount);
    return { expenseId: id };
  });
}

function listExpenses_(p: any) {
  const month = p.month ? mk_(p.month) : '';
  const rows = table_('Expenses').filter((e) => !month || mk_(e.MonthKey) === month).map((e) => ({
    id: e.ExpenseId, date: String(e.ExpenseDate).slice(0, 10), month: mk_(e.MonthKey), type: e.Type, payee: e.Payee, category: e.Category,
    hours: e.Hours === '' ? '' : num_(e.Hours), rate: e.Rate === '' ? '' : num_(e.Rate), amount: num_(e.Amount), refNo: e.RefNo, note: e.Note,
    recordedBy: e.RecordedBy, status: e.Status, voidReason: e.VoidReason,
  })).sort((a, b) => (a.id < b.id ? 1 : -1));
  const tot: Record<string, number> = { TEACHER: 0, OTHER: 0 };
  rows.forEach((r) => { if (r.status === 'ACTIVE' && tot[r.type] !== undefined) tot[r.type] += r.amount; });
  return { rows, totalTeacher: tot.TEACHER, totalOther: tot.OTHER };
}

function voidExpense_(p: any, user: Rec) {
  const reason = cleanText_(p.reason, 200);
  if (reason.length < 5) throw userErr('សូមសរសេរមូលហេតុនៃការ VOID (យ៉ាងតិច ៥ តួ)');
  return withLock_(() => {
    const e = table_('Expenses').filter((x) => x.ExpenseId === String(p.id))[0];
    if (!e) throw userErr('រកមិនឃើញចំណាយ');
    if (e.Status !== 'ACTIVE') throw userErr('ចំណាយនេះត្រូវបាន VOID រួចហើយ');
    patchRow_('Expenses', e, { Status: 'VOID', VoidReason: reason, VoidedAt: now_(), VoidedBy: user.Username });
    audit_(user.Username, 'VOID', 'Expense', e.ExpenseId, 'amount ' + e.Amount + ' | ' + reason);
    return true;
  });
}

/* ---------------- Users (Google Sign-In) ---------------- */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function listUsers_() {
  return table_('Users').map((u) => ({
    username: u.Username, displayName: u.DisplayName, email: u.Email || '', role: u.Role, classes: u.AllowedClasses,
    active: u.Active === 'YES', lastLoginAt: u.LastLoginAt,
  }));
}

function saveUser_(p: any, user: Rec) {
  const username = String(p.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw userErr('ឈ្មោះអ្នកប្រើត្រូវមាន ៣-៣០ តួ (a-z, 0-9, . _ -)');
  const displayName = cleanText_(p.displayName, 80);
  if (!displayName) throw userErr('សូមបញ្ចូលឈ្មោះពេញ');
  const email = String(p.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) throw userErr('សូមបញ្ចូលអ៊ីមែល Google ឱ្យបានត្រឹមត្រូវ');
  if ((APP.ROLES as readonly string[]).indexOf(p.role) < 0) throw userErr('តួនាទីមិនត្រឹមត្រូវ');
  const role = p.role as Role;
  let classes = '*';
  if (role === 'TEACHER') {
    const valid: Record<string, boolean> = {};
    table_('Classes').forEach((c) => { valid[c.ClassId] = true; });
    const list = String(p.classes || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (!list.length) throw userErr('សូមកំណត់ថ្នាក់សម្រាប់គ្រូបន្ទុកថ្នាក់');
    list.forEach((c) => { if (!valid[c]) throw userErr('ថ្នាក់ ' + c + ' មិនមាន'); });
    classes = list.join(',');
  }
  const active = p.active === false ? 'NO' : 'YES';
  return withLock_(() => {
    const u = findUser_(username);
    if (u && !p.isEdit) throw userErr('ឈ្មោះអ្នកប្រើនេះមានរួចហើយ');
    const other = findUserByEmail_(email);
    if (other && (!u || other._row !== u._row)) throw userErr('អ៊ីមែលនេះត្រូវបានប្រើដោយ ' + other.Username + ' រួចហើយ');
    if (u) {
      if (u.Username === user.Username && (active !== 'YES' || role !== 'ADMIN')) throw userErr('អ្នកមិនអាចបិទ ឬដកសិទ្ធិ Admin ពីខ្លួនឯងបានទេ');
      if (u.Role === 'ADMIN' && (role !== 'ADMIN' || active !== 'YES')) {
        const admins = table_('Users').filter((x) => x.Role === 'ADMIN' && x.Active === 'YES');
        if (admins.length <= 1) throw userErr('ត្រូវមាន Admin យ៉ាងហោចណាស់ម្នាក់');
      }
      patchRow_('Users', u, { DisplayName: displayName, Email: email, Role: role, AllowedClasses: classes, Active: active, UpdatedAt: now_() });
      audit_(user.Username, 'UPDATE', 'User', username, role + ' | ' + classes + ' | ' + email + ' | active ' + active);
      return { username };
    }
    insert_('Users', {
      Username: username, DisplayName: displayName, Email: email, Role: role, AllowedClasses: classes, Active: active,
      CreatedAt: now_(), UpdatedAt: now_(), LastLoginAt: '',
    });
    audit_(user.Username, 'CREATE', 'User', username, role + ' | ' + classes + ' | ' + email);
    return { username };
  });
}

/* ---------------- Settings / classes / audit / backup ---------------- */

function saveSettings_(p: any, user: Rec) {
  const gen = Number(p.generalFee), poor = Number(p.poorFee);
  if (!(gen > 0 && Math.round(gen) === gen) || !(poor >= 0 && Math.round(poor) === poor) || poor > gen) throw userErr('ថ្លៃសិក្សាមិនត្រឹមត្រូវ');
  const fields: Record<string, string> = {
    school_name: cleanText_(p.schoolName, 120), ministry: cleanText_(p.ministry, 120), province_office: cleanText_(p.provinceOffice, 120),
    location: cleanText_(p.location, 60), general_fee: String(gen), poor_fee: String(poor), teacher_can_record: p.teacherCanRecord ? 'YES' : 'NO',
  };
  if (!fields.school_name) throw userErr('សូមបញ្ចូលឈ្មោះសាលា');
  return withLock_(() => {
    const st = settings_();
    const hasPayments = table_('Receipts').some((r) => r.Status === 'ACTIVE');
    if (p.schoolYear !== undefined || p.months !== undefined) {
      const months: string[] = Array.isArray(p.months) ? p.months.map(mk_) : st.months;
      const ok = months.length >= 1 && months.length <= 12 && months.every((m, i) => /^\d{4}-\d{2}$/.test(m) && (i === 0 || m > months[i - 1]));
      if (!ok) throw userErr('បញ្ជីខែមិនត្រឹមត្រូវ');
      if (JSON.stringify(months) !== JSON.stringify(st.months) && hasPayments) throw userErr('មិនអាចប្ដូរខែសិក្សាបានទេ ព្រោះមានការបង់ប្រាក់រួចហើយ។ សូមបង្កើតប្រព័ន្ធថ្មីសម្រាប់ឆ្នាំសិក្សាថ្មី។');
      fields.months_json = JSON.stringify(months);
      fields.school_year = cleanText_(p.schoolYear, 30) || st.schoolYear;
    }
    if ((gen !== st.generalFee || poor !== st.poorFee) && hasPayments) {
      const L = ledger_();
      L.students.forEach((s) => {
        const fee = s.Category === 'POOR' ? poor : gen;
        const paid: Record<string, number> = {};
        (L.lines[s.Code] || []).forEach((x) => { paid[x.m] = (paid[x.m] || 0) + x.a; });
        Object.keys(paid).forEach((m) => { if (paid[m] > fee) throw userErr('សិស្ស ' + s.Code + ' បានបង់ ' + paid[m] + ' ៛ សម្រាប់ ' + m + ' លើសថ្លៃថ្មី'); });
      });
    }
    const changes: string[] = [];
    Object.keys(fields).forEach((k) => {
      if (String(st.raw[k]) !== String(fields[k])) { changes.push(k + ': ' + st.raw[k] + ' → ' + fields[k]); setSetting_(k, fields[k]); }
    });
    audit_(user.Username, 'UPDATE', 'Settings', '', changes.join('; ') || 'no change');
    return true;
  });
}

function saveClass_(p: any, user: Rec) {
  const id = String(p.classId || '').trim().toUpperCase();
  if (!/^(7|8|9|10|11|12)[A-Z]$/.test(id)) throw userErr('ឈ្មោះថ្នាក់ត្រូវមានទម្រង់ ដូចជា 10A');
  return withLock_(() => {
    const c = findClass_(id);
    if (c) {
      const active = p.active === false ? 'NO' : 'YES';
      if (active === 'NO' && table_('Students').some((s) => s.ClassId === id && s.Active === 'YES')) throw userErr('ថ្នាក់នេះនៅមានសិស្សសកម្ម');
      patchRow_('Classes', c, { Active: active });
      audit_(user.Username, 'UPDATE', 'Class', id, 'active ' + active);
    } else {
      const n = table_('Classes').length + 1;
      insert_('Classes', { ClassId: id, Grade: parseInt(id, 10), SortOrder: n, Active: 'YES' });
      audit_(user.Username, 'CREATE', 'Class', id, 'Class created');
    }
    return true;
  });
}

function auditLog_(p: any) {
  const t = table_('AuditLog');
  const q = String(p.q || '').toLowerCase();
  const rows = t.filter((r) => !q || [r.Actor, r.Action, r.Entity, r.EntityId, r.Summary].join(' ').toLowerCase().indexOf(q) >= 0);
  return rows.slice(-300).reverse().map((r) => ({ ts: r.Timestamp, actor: r.Actor, action: r.Action, entity: r.Entity, id: r.EntityId, summary: r.Summary }));
}

function verifyAudit_() {
  const t = table_('AuditLog');
  let prev = 'GENESIS';
  for (let i = 0; i < t.length; i++) {
    const r = t[i];
    const h = auditHash_(prev, r);
    if (String(r.PrevHash) !== prev || String(r.Hash) !== h) {
      return { ok: false, rows: t.length, brokenAtRow: r._row, ts: r.Timestamp };
    }
    prev = h;
  }
  return { ok: true, rows: t.length };
}

/** Copies the spreadsheet via the Apps Script web app (apps-script/Backup.gs), then records it. */
export async function backup_(actor: string) {
  const st = settings_();
  const last = st.raw.last_backup_at || '';
  if (!(actor === 'TRIGGER' || !last || fmtTs(new Date(Date.now() - 3600000)) > last)) {
    throw userErr('បានបម្រុងទុកក្នុងរយៈពេល ១ ម៉ោងចុងក្រោយរួចហើយ');
  }
  const url = process.env.BACKUP_WEBAPP_URL;
  const secret = process.env.BACKUP_SECRET;
  if (!url || !secret) throw userErr('មិនទាន់កំណត់ការបម្រុងទុក (BACKUP_WEBAPP_URL / BACKUP_SECRET)');
  const name = 'Backup ' + now_();
  const res = await fetch(url, {
    method: 'POST', redirect: 'follow', cache: 'no-store',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ secret, name, folder: APP.BACKUP_FOLDER, keep: 60 }),
  });
  let out: any = null;
  try { out = JSON.parse(await res.text()); } catch { out = null; }
  if (!out || !out.ok) throw new Error('Backup web app failed: ' + (out?.error || res.status));
  return withLock_(() => {
    setSetting_('last_backup_at', now_());
    audit_(actor, 'BACKUP', 'System', '', name);
    return { ok: true, name };
  });
}

/* ---------------- Action map ---------------- */

const R_ALL: Role[] = ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'DIRECTOR'];
const R_FIN: Role[] = ['ADMIN', 'ACCOUNTANT', 'DIRECTOR'];
const R_WRITE: Role[] = ['ADMIN', 'ACCOUNTANT'];

export interface ActionDef {
  roles?: Role[];
  /** load the full AuditLog before running */
  auditLog?: boolean;
  fn: (p: any, user: Rec) => any;
}

export const ACTIONS: Record<string, ActionDef> = {
  bootstrap: { fn: bootstrap_ },
  version: { fn: () => ctxDb().version },

  monthlyReport: { roles: R_ALL, fn: monthlyReport_ },
  annualReport: { roles: R_ALL, fn: annualReport_ },
  financeReport: { roles: R_FIN, fn: financeReport_ },

  classRoster: { roles: R_ALL, fn: classRoster_ },
  studentDetail: { roles: R_ALL, fn: studentDetail_ },
  saveStudent: { roles: R_WRITE, fn: saveStudent_ },
  withdrawStudent: { roles: R_WRITE, fn: withdrawStudent_ },
  bulkAddStudents: { roles: R_WRITE, fn: bulkAddStudents_ },

  recordPayment: { roles: ['ADMIN', 'ACCOUNTANT', 'TEACHER'], fn: recordPayment_ },
  listReceipts: { roles: R_ALL, fn: listReceipts_ },
  getReceipt: { roles: R_ALL, fn: getReceipt_ },
  voidReceipt: { roles: ['ADMIN'], fn: voidReceipt_ },

  recordExpense: { roles: R_WRITE, fn: recordExpense_ },
  listExpenses: { roles: R_FIN, fn: listExpenses_ },
  voidExpense: { roles: ['ADMIN'], fn: voidExpense_ },

  listUsers: { roles: ['ADMIN'], fn: listUsers_ },
  saveUser: { roles: ['ADMIN'], fn: saveUser_ },

  saveSettings: { roles: ['ADMIN'], fn: saveSettings_ },
  saveClass: { roles: ['ADMIN'], fn: saveClass_ },
  auditLog: { roles: ['ADMIN', 'DIRECTOR'], auditLog: true, fn: auditLog_ },
  verifyAudit: { roles: ['ADMIN', 'DIRECTOR'], auditLog: true, fn: verifyAudit_ },
  backupNow: { roles: ['ADMIN'], fn: (_p, u) => backup_(u.Username) },
};
