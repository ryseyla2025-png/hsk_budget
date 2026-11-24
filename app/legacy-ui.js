/* eslint-disable */
/**
 * Browser UI — ported from Index.html (Apps Script v2.0) with minimal changes:
 *  - call() uses fetch('/api/rpc') instead of google.script.run
 *  - Google Sign-In replaces the username/password screens
 *  - Users view manages the Google email of each account
 *  - live updates: polls a data version every 5 s and silently re-renders the current view
 */
let started = false;
export function start(){
if (started) return;
started = true;
'use strict';
/* ============================ Utilities ============================ */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const KH_DIGITS = '០១២៣៤៥៦៧៨៩';
const KH_MONTHS = ['មករា','កុម្ភៈ','មីនា','មេសា','ឧសភា','មិថុនា','កក្កដា','សីហា','កញ្ញា','តុលា','វិច្ឆិកា','ធ្នូ'];
const ROLE_LABEL = {ADMIN:'អ្នកគ្រប់គ្រងប្រព័ន្ធ', ACCOUNTANT:'គណនេយ្យករ', TEACHER:'គ្រូបន្ទុកថ្នាក់', DIRECTOR:'នាយក / គណៈកម្មការ'};
const STATUS_LABEL = {PAID:'បានបង់', PARTIAL:'បង់ខ្លះ', UNPAID:'មិនទាន់បង់', NA:'មិនត្រូវបង់'};
const S = { token: null, boot: null, view: 'dashboard', month: null, classId: null, reportTab: 'monthly' };

function esc(v){ return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function kh(v){ return String(v).replace(/[0-9]/g, d => KH_DIGITS[d]); }
function num(n){ return Number(n || 0).toLocaleString('en-US'); }
function money(n){ return num(n) + ' ៛'; }
function pct(x){ return (Math.round((x || 0) * 1000) / 10).toFixed(1) + '%'; }
function mLabel(m, short){ if(!m) return ''; const [y, mo] = m.split('-'); const n = KH_MONTHS[Number(mo) - 1]; return short ? n : 'ខែ' + n + ' ' + kh(y); }
function dLabel(d){ if(!d) return ''; const [y, m, dd] = String(d).slice(0,10).split('-'); return kh(dd) + '/' + kh(m) + '/' + kh(y); }
function catLabel(c){ return (S.boot && S.boot.settings.categories[c]) || c; }
function uuid(){ try { return crypto.randomUUID(); } catch(e){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); } }
function role(){ return S.boot ? S.boot.user.role : ''; }
function is(...roles){ return roles.indexOf(role()) >= 0; }
function canRecord(){ return is('ADMIN','ACCOUNTANT') || (is('TEACHER') && S.boot.settings.teacherCanRecord); }
function canEditStudents(){ return is('ADMIN','ACCOUNTANT'); }
function store(k, v){ try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch(e){} }
function load(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }

async function call(action, payload){
  let res;
  try {
    res = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action, payload: payload || {} }) });
  } catch(e){ throw new Error('មិនអាចភ្ជាប់ទៅម៉ាស៊ីនមេបានទេ។ សូមពិនិត្យអ៊ីនធឺណិត។'); }
  let r; try { r = await res.json(); } catch(e){ throw new Error('ចម្លើយពីម៉ាស៊ីនមេមិនត្រឹមត្រូវ'); }
  if (r.ok) return r.data;
  if (r.code === 'AUTH') showLogin(r.error);
  throw new Error(r.error);
}

let toastTimer;
function toast(msg, bad){
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, bad ? 6000 : 3000);
}
function fail(e){ toast(e && e.message ? e.message : String(e), true); }

/* ============================ Modal ============================ */
let modalLocked = false;
function openModal(html, opts){
  opts = opts || {};
  const card = $('#modalCard');
  card.className = 'modal-card' + (opts.wide ? ' wide' : '');
  card.innerHTML = html;
  $('#modal').hidden = false;
  modalLocked = !!opts.locked;
  $$('[data-close]', card).forEach(b => b.onclick = closeModal);
  const f = card.querySelector('input:not([type=hidden]),select,textarea');
  if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
  return card;
}
function closeModal(){ if (modalLocked) return; $('#modal').hidden = true; $('#modalCard').innerHTML = ''; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
function modalShell(title, body, foot){
  return `<div class="modal-head"><h3>${title}</h3>${modalLocked ? '' : '<button class="x" data-close aria-label="បិទ">×</button>'}</div>
          <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
}
function askReason(title, note){
  return new Promise(resolve => {
    const card = openModal(modalShell(esc(title),
      `${note ? `<div class="notice">${note}</div>` : ''}<div class="field"><label>មូលហេតុ (យ៉ាងតិច ៥ តួ)</label><textarea id="rsTxt" style="min-height:80px"></textarea></div>`,
      `<button class="btn" data-close>បោះបង់</button><button class="btn danger" id="rsOk">បញ្ជាក់</button>`));
    $('#rsOk', card).onclick = () => { const v = $('#rsTxt', card).value.trim(); if (v.length < 5) { toast('សូមសរសេរមូលហេតុឱ្យបានច្បាស់', true); return; } closeModal(); resolve(v); };
    $$('[data-close]', card).forEach(b => b.addEventListener('click', () => resolve(null)));
  });
}
function printHtml(html){
  const pa = $('#printArea'); pa.innerHTML = html;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); setTimeout(() => { document.body.classList.remove('printing'); pa.innerHTML = ''; }, 300); }, 150);
}

/* ============================ Auth (Google Sign-In) ============================ */
let leaving = false;
function showLogin(msg){
  if (leaving) return; leaving = true;
  location.href = '/login?error=AccessDenied' + (msg ? '&msg=' + encodeURIComponent(msg) : '');
}

function applyBoot(){
  const st = S.boot.settings;
  $('#tbSchool').textContent = st.schoolName;
  $('#tbYear').textContent = 'ឆ្នាំសិក្សា ' + st.schoolYear + ' · ថវិកាការបង្រៀនពេញម៉ោង';
  $('#tbUser').textContent = S.boot.user.displayName + ' (' + S.boot.user.username + ')';
  $('#tbRole').textContent = ROLE_LABEL[S.boot.user.role] + (S.boot.user.role === 'TEACHER' ? ' · ថ្នាក់ ' + S.boot.classes.join(', ') : '');
}

async function startApp(){
  S.boot = await call('bootstrap');
  $('#appShell').hidden = false;
  applyBoot();
  const months = S.boot.settings.months;
  S.month = months.indexOf(S.boot.currentMonth) >= 0 ? S.boot.currentMonth : (S.boot.currentMonth < months[0] ? months[0] : months[months.length - 1]);
  if (!S.classId || S.boot.classes.indexOf(S.classId) < 0) S.classId = S.boot.classes[0] || null;
  renderNav(); go(S.view);
}

/* ============================ Live updates (polling) ============================ */
// Every 5 s ask the server for the data version (a fingerprint of the sheets). When it changes —
// because someone saved in the app or edited the Google Sheet directly — re-render the current view
// quietly. Skipped while a dialog is open, while typing, or when the tab is hidden.
const LIVE_MS = 5000;
const LIVE_SKIP_VIEWS = { settings: 1 };   // forms with unsaved edits
let liveVer = null, liveBusy = false;
function userIsBusy(){
  if (!$('#modal').hidden) return true;
  const ae = document.activeElement;
  return !!(ae && ae !== document.body && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && $('#view').contains(ae));
}
async function liveTick(){
  if (liveBusy || !S.boot || document.hidden || userIsBusy()) return;
  liveBusy = true;
  try {
    const v = await call('version');
    if (liveVer === null) { liveVer = v; return; }
    if (v === liveVer) return;
    liveVer = v;
    if (LIVE_SKIP_VIEWS[S.view]) return;
    const y = window.scrollY;
    S.boot = await call('bootstrap');
    applyBoot(); renderNav();
    const fn = { dashboard: viewDashboard, classes: viewClasses, receipts: viewReceipts, expenses: viewExpenses,
                 reports: viewReports, users: viewUsers, settings: viewSettings, audit: viewAudit }[S.view];
    if (fn) { await fn(); window.scrollTo(0, y); }
    const ind = $('#liveDot'); if (ind) { ind.classList.add('flash'); setTimeout(() => ind.classList.remove('flash'), 1200); }
  } catch(e){ /* ignore transient errors */ }
  finally { liveBusy = false; }
}
setInterval(liveTick, LIVE_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });

/* ============================ Navigation ============================ */
const NAV = [
  { id: 'dashboard', label: 'ផ្ទាំងសង្ខេប', roles: ['ADMIN','ACCOUNTANT','TEACHER','DIRECTOR'] },
  { id: 'classes', label: 'ថ្នាក់ និងសិស្ស', roles: ['ADMIN','ACCOUNTANT','TEACHER','DIRECTOR'] },
  { id: 'receipts', label: 'បង្កាន់ដៃ', roles: ['ADMIN','ACCOUNTANT','TEACHER','DIRECTOR'] },
  { id: 'expenses', label: 'ចំណាយ និងប្រាក់ម៉ោងគ្រូ', roles: ['ADMIN','ACCOUNTANT','DIRECTOR'] },
  { id: 'reports', label: 'របាយការណ៍', roles: ['ADMIN','ACCOUNTANT','TEACHER','DIRECTOR'] },
  { id: 'users', label: 'អ្នកប្រើប្រាស់', roles: ['ADMIN'] },
  { id: 'settings', label: 'ការកំណត់', roles: ['ADMIN'] },
  { id: 'audit', label: 'កំណត់ហេតុសកម្មភាព', roles: ['ADMIN','DIRECTOR'] }
];
function renderNav(){
  $('#nav').innerHTML = NAV.filter(n => n.roles.indexOf(role()) >= 0)
    .map(n => `<button data-v="${n.id}" class="${n.id === S.view ? 'on' : ''}">${n.label}</button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.v));
}
function go(v){
  if (!NAV.some(n => n.id === v && n.roles.indexOf(role()) >= 0)) v = 'dashboard';
  S.view = v;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#view').innerHTML = '<div class="loading">កំពុងផ្ទុក…</div>';
  const fn = { dashboard: viewDashboard, classes: viewClasses, receipts: viewReceipts, expenses: viewExpenses,
               reports: viewReports, users: viewUsers, settings: viewSettings, audit: viewAudit }[v];
  Promise.resolve(fn()).catch(e => { $('#view').innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
}
function monthOptions(sel){ return S.boot.settings.months.map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${mLabel(m)}</option>`).join(''); }
function classOptions(sel, all){ return (all ? '<option value="">ថ្នាក់ទាំងអស់</option>' : '') + S.boot.classes.map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>ថ្នាក់ ${esc(c)}</option>`).join(''); }

/* ============================ Dashboard ============================ */
async function viewDashboard(){
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><h2 class="grow" style="font-size:19px">ផ្ទាំងសង្ខេបប្រចាំខែ</h2>
    <select id="dbMonth">${monthOptions(S.month)}</select></div><div id="dbBody" class="loading">កំពុងផ្ទុក…</div>`;
  $('#dbMonth').onchange = e => { S.month = e.target.value; viewDashboard(); };
  const r = await call('monthlyReport', { month: S.month });
  const t = r.total;
  $('#dbBody').className = '';
  $('#dbBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="l">សិស្សត្រូវបង់ក្នុងខែ</div><div class="v">${num(t.students)} នាក់</div><div class="s">ទូទៅ ${num(t.gen)} · ក្រីក្រ ${num(t.poor)}</div></div>
      <div class="kpi gold"><div class="l">ត្រូវប្រមូលសម្រាប់ខែនេះ</div><div class="v">${money(t.due)}</div><div class="s">បានបង់រួច ${money(t.paidForMonth)} (${pct(t.rate)})</div></div>
      <div class="kpi ok"><div class="l">សាច់ប្រាក់ទទួលបានក្នុងខែ</div><div class="v">${money(t.cashTotal)}</div><div class="s">ខែនេះ ${money(t.cashCurrent)} · ខែមុន ${money(t.cashPrev)} · បង់មុន ${money(t.cashAdvance)}</div></div>
      <div class="kpi bad"><div class="l">នៅជំពាក់សរុប ដល់ចុងខែ</div><div class="v">${money(t.outstanding)}</div><div class="s">${num(t.unpaidStudents)} នាក់ មិនទាន់បង់គ្រប់សម្រាប់ខែនេះ</div></div>
    </div>
    <div class="card"><h2>តាមថ្នាក់ — ${mLabel(r.month)}</h2>
    <div class="tbl-wrap"><table><thead><tr><th>ថ្នាក់</th><th class="n">សិស្ស</th><th class="n">ត្រូវប្រមូល</th><th class="n">បានបង់សម្រាប់ខែនេះ</th><th class="n">អត្រា</th>
      <th class="n">ទទួលបានក្នុងខែ</th><th class="n">នៅជំពាក់សរុប</th><th class="n">មិនទាន់បង់</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr class="click" data-c="${esc(x.classId)}"><td><b>${esc(x.classId)}</b></td><td class="n">${num(x.students)}</td><td class="n">${num(x.due)}</td>
        <td class="n">${num(x.paidForMonth)}</td><td class="n">${x.due ? pct(x.rate) : '-'}</td><td class="n">${num(x.cashTotal)}</td><td class="n">${num(x.outstanding)}</td><td class="n">${num(x.unpaidStudents)}</td></tr>`).join('')}
      <tr class="tot"><td>សរុប</td><td class="n">${num(t.students)}</td><td class="n">${num(t.due)}</td><td class="n">${num(t.paidForMonth)}</td><td class="n">${pct(t.rate)}</td><td class="n">${num(t.cashTotal)}</td><td class="n">${num(t.outstanding)}</td><td class="n">${num(t.unpaidStudents)}</td></tr>
    </tbody></table></div><p class="muted" style="font-size:13px;margin:10px 0 0">ចុចលើថ្នាក់ដើម្បីមើលបញ្ជីសិស្ស។ ទិន្នន័យគណនាដោយស្វ័យប្រវត្តិពីបង្កាន់ដៃដែលមានសុពលភាព។</p></div>`;
  $$('#dbBody tr.click').forEach(tr => tr.onclick = () => { S.classId = tr.dataset.c; go('classes'); });
}

/* ============================ Classes & students ============================ */
async function viewClasses(){
  const v = $('#view');
  if (!S.classId) { v.innerHTML = '<div class="card empty">មិនមានថ្នាក់ដែលអ្នកមានសិទ្ធិ</div>'; return; }
  v.innerHTML = `<div class="pills">${S.boot.classes.map(c => `<button class="pill ${c === S.classId ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="toolbar"><h2 style="font-size:19px">ថ្នាក់ទី ${esc(S.classId)}</h2><select id="clMonth">${monthOptions(S.month)}</select>
      <input type="text" id="clSearch" placeholder="ស្វែងរកឈ្មោះ ឬកូដ…" value="${esc(S.clQ || '')}"><span class="grow"></span>
      ${canEditStudents() ? '<button class="btn" id="clBulk">បញ្ចូលសិស្សច្រើន</button><button class="btn primary" id="clAdd">+ បន្ថែមសិស្ស</button>' : ''}</div>
    <div id="clBody" class="loading">កំពុងផ្ទុក…</div>`;
  $$('.pill', v).forEach(p => p.onclick = () => { S.classId = p.dataset.c; viewClasses(); });
  $('#clMonth').onchange = e => { S.month = e.target.value; viewClasses(); };
  if (canEditStudents()) { $('#clAdd').onclick = () => openStudentForm(null); $('#clBulk').onclick = openBulkAdd; }
  const r = await call('classRoster', { classId: S.classId, month: S.month });
  const months = S.boot.settings.months;
  const t = r.total;
  const body = $('#clBody'); body.className = '';
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="l">ស្ថានភាព ${mLabel(r.month)}</div><div class="v">${num(t.paidCount)}/${num(t.students)} នាក់</div><div class="s">បានបង់គ្រប់</div></div>
      <div class="kpi gold"><div class="l">បានបង់សម្រាប់ខែនេះ</div><div class="v">${money(t.paid)}</div><div class="s">នៃ ${money(t.due)}</div></div>
      <div class="kpi ok"><div class="l">បង់សម្រាប់ខែមុនៗ ក្នុងខែនេះ</div><div class="v">${money(t.cashPrev)}</div></div>
      <div class="kpi bad"><div class="l">នៅជំពាក់ ដល់ ${mLabel(r.month, true)}</div><div class="v">${money(t.outstanding)}</div></div>
    </div>
    <div class="legend" style="margin-bottom:8px"><span><i class="dot PAID"></i>បានបង់</span><span><i class="dot PARTIAL"></i>បង់ខ្លះ</span><span><i class="dot UNPAID"></i>មិនទាន់បង់</span><span><i class="dot NA"></i>មិនត្រូវបង់</span>
      <span class="muted">· តារាងខែ៖ ${months.map(m => mLabel(m, true)).join(' → ')}</span></div>
    ${r.rows.length ? `<div class="tbl-wrap"><table id="clTbl"><thead><tr><th class="c">ល.រ</th><th>កូដ</th><th>គោត្តនាម និងនាម</th><th class="c">ភេទ</th><th>ប្រភេទ</th><th class="n">ថ្លៃ/ខែ</th>
      <th class="n">បង់សម្រាប់ខែនេះ</th><th>ស្ថានភាព</th><th>តារាងខែ</th><th>ខែដែលជំពាក់</th><th class="n">ទឹកប្រាក់ជំពាក់</th><th></th></tr></thead><tbody>
      ${r.rows.map((x, i) => `<tr class="${x.active ? '' : 'inactive'}" data-code="${esc(x.code)}" data-q="${esc((x.code + ' ' + x.name).toLowerCase())}">
        <td class="c">${i + 1}</td><td>${esc(x.code)}</td><td><a href="#" data-detail="${esc(x.code)}">${esc(x.name)}</a>${x.active ? '' : ' <span class="chip NA">ឈប់រៀន</span>'}</td>
        <td class="c">${esc(x.sex)}</td><td>${esc(catLabel(x.category))}</td><td class="n">${num(x.fee)}</td><td class="n">${x.monthStatus === 'NA' ? '-' : num(x.monthPaid)}</td>
        <td><span class="chip ${x.monthStatus}">${STATUS_LABEL[x.monthStatus]}</span></td>
        <td><span class="dots">${x.grid.map((g, k) => `<i class="dot ${g}" title="${mLabel(months[k])}: ${STATUS_LABEL[g]}"></i>`).join('')}</span></td>
        <td style="font-size:13px">${x.owedMonths.length ? x.owedMonths.map(m => mLabel(m, true)).join(', ') : '-'}</td>
        <td class="n">${x.outstanding ? num(x.outstanding) : '-'}</td>
        <td>${canRecord() && x.yearOutstanding > 0 ? `<button class="btn sm primary" data-pay="${esc(x.code)}">បង់ប្រាក់</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">មិនទាន់មានសិស្សក្នុងថ្នាក់នេះ</div>'}`;
  $$('[data-detail]', body).forEach(a => a.onclick = e => { e.preventDefault(); openStudentDetail(a.dataset.detail); });
  $$('[data-pay]', body).forEach(b => b.onclick = () => openPayment(b.dataset.pay));
  const applyQ = () => { const q = (S.clQ || '').trim().toLowerCase(); $$('#clTbl tbody tr').forEach(tr => tr.hidden = !!q && tr.dataset.q.indexOf(q) < 0); };
  $('#clSearch').oninput = e => { S.clQ = e.target.value; applyQ(); };
  applyQ();
}

async function openStudentDetail(code){
  openModal(modalShell('ព័ត៌មានសិស្ស', '<div class="loading">កំពុងផ្ទុក…</div>'), { wide: true });
  let d; try { d = await call('studentDetail', { code }); } catch(e){ closeModal(); return fail(e); }
  const s = d.student;
  const owed = d.grid.reduce((a, g) => a + g.bal, 0);
  const card = openModal(modalShell(`${esc(s.name)} <span class="muted" style="font-weight:400">· ${esc(s.code)}</span>`,
    `<div class="row" style="margin-bottom:12px;gap:24px">
      <div>ថ្នាក់៖ <b>${esc(s.classId)}</b></div><div>ភេទ៖ <b>${esc(s.sex)}</b></div><div>ប្រភេទ៖ <b>${esc(catLabel(s.category))}</b> (${money(s.fee)}/ខែ)</div>
      <div>រៀនពី ${mLabel(s.startMonth)}${s.endMonth ? ' ដល់ ' + mLabel(s.endMonth) : ''}</div>
      ${s.active ? '' : '<div><span class="chip NA">ឈប់រៀន</span></div>'}</div>
     ${s.note ? `<p class="muted">សម្គាល់៖ ${esc(s.note)}</p>` : ''}
     <div class="tbl-wrap" style="margin-bottom:16px"><table><thead><tr><th>ខែ</th><th class="n">ត្រូវបង់</th><th class="n">បានបង់</th><th class="n">នៅសល់</th><th>ស្ថានភាព</th></tr></thead><tbody>
      ${d.grid.map(g => { const st = !g.enrolled ? 'NA' : g.paid >= g.due ? 'PAID' : g.paid > 0 ? 'PARTIAL' : 'UNPAID';
        return `<tr><td>${mLabel(g.m)}</td><td class="n">${g.enrolled ? num(g.due) : '-'}</td><td class="n">${num(g.paid)}</td><td class="n">${g.bal ? num(g.bal) : '-'}</td><td><span class="chip ${st}">${STATUS_LABEL[st]}</span></td></tr>`; }).join('')}
      <tr class="tot"><td>សរុប</td><td class="n">${num(d.grid.reduce((a, g) => a + g.due, 0))}</td><td class="n">${num(d.grid.reduce((a, g) => a + g.paid, 0))}</td><td class="n">${num(owed)}</td><td></td></tr></tbody></table></div>
     <h3 style="font-size:15px;margin-bottom:8px">បង្កាន់ដៃ</h3>
     ${d.receipts.length ? `<div class="tbl-wrap"><table><thead><tr><th>លេខ</th><th>ថ្ងៃបង់</th><th class="n">ទឹកប្រាក់</th><th>ស្ថានភាព</th></tr></thead><tbody>
       ${d.receipts.map(r => `<tr class="click ${r.status === 'VOID' ? 'void' : ''}" data-r="${esc(r.receiptNo)}"><td>${esc(r.receiptNo)}</td><td>${dLabel(r.paidDate)}</td><td class="n">${num(r.total)}</td><td><span class="chip ${r.status}">${r.status === 'VOID' ? 'VOID' : 'មានសុពលភាព'}</span></td></tr>`).join('')}
       </tbody></table></div>` : '<p class="muted">មិនទាន់មានការបង់ប្រាក់</p>'}`,
    `${canEditStudents() ? (s.active ? '<button class="btn danger" id="sdWd">ឈប់រៀន</button>' : '<button class="btn" id="sdRe">ចូលរៀនវិញ</button>') + '<button class="btn" id="sdEdit">កែប្រែ</button>' : ''}
     <span style="flex:1"></span>${canRecord() && owed > 0 ? '<button class="btn primary" id="sdPay">បង់ប្រាក់</button>' : ''}<button class="btn" data-close>បិទ</button>`), { wide: true, noFocus: true });
  $$('tr[data-r]', card).forEach(tr => tr.onclick = () => openReceipt(tr.dataset.r));
  if ($('#sdPay', card)) $('#sdPay', card).onclick = () => openPayment(s.code);
  if ($('#sdEdit', card)) $('#sdEdit', card).onclick = () => openStudentForm(s);
  if ($('#sdWd', card)) $('#sdWd', card).onclick = () => openWithdraw(s);
  if ($('#sdRe', card)) $('#sdRe', card).onclick = async () => {
    try { await call('withdrawStudent', { code: s.code, reinstate: true }); toast('បានដាក់សិស្សចូលរៀនវិញ'); closeModal(); refresh(); } catch(e){ fail(e); }
  };
}

function refresh(){ go(S.view); }

function openStudentForm(s){
  const isEdit = !!s;
  const months = S.boot.settings.months;
  const classSel = isEdit && !is('ADMIN') ? `<input type="text" value="${esc(s.classId)}" disabled>` :
    `<select id="sfClass">${S.boot.classes.map(c => `<option ${c === (isEdit ? s.classId : S.classId) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  const card = openModal(modalShell(isEdit ? 'កែប្រែព័ត៌មានសិស្ស ' + esc(s.code) : 'បន្ថែមសិស្សថ្មី',
    `<div class="field"><label>គោត្តនាម និងនាម</label><input type="text" id="sfName" maxlength="100" value="${isEdit ? esc(s.name) : ''}"></div>
     <div class="row"><div class="field"><label>ភេទ</label><select id="sfSex"><option value="ប" ${isEdit && s.sex === 'ប' ? 'selected' : ''}>ប (ប្រុស)</option><option value="ស" ${isEdit && s.sex === 'ស' ? 'selected' : ''}>ស (ស្រី)</option></select></div>
       <div class="field"><label>ប្រភេទសិស្ស</label><select id="sfCat"><option value="GEN" ${isEdit && s.category === 'GEN' ? 'selected' : ''}>សិស្សទូទៅ (${money(S.boot.settings.generalFee)})</option><option value="POOR" ${isEdit && s.category === 'POOR' ? 'selected' : ''}>បណ្ណក្រីក្រ (${money(S.boot.settings.poorFee)})</option></select></div>
       <div class="field"><label>ថ្នាក់</label>${classSel}</div></div>
     <div class="row"><div class="field"><label>ចាប់ផ្ដើមបង់ពីខែ</label><select id="sfStart">${monthOptions(isEdit ? s.startMonth || months[0] : months[0])}</select></div>
       ${isEdit && s.endMonth ? `<div class="field"><label>ខែចុងក្រោយ</label><select id="sfEnd">${monthOptions(s.endMonth)}</select></div>` : ''}</div>
     <div class="field"><label>សម្គាល់</label><input type="text" id="sfNote" maxlength="200" value="${isEdit ? esc(s.note || '') : ''}"></div>
     ${isEdit ? '<div class="notice info">ការប្ដូរប្រភេទសិស្ស ប៉ះពាល់ដល់ថ្លៃគ្រប់ខែ។ ប្រព័ន្ធនឹងបដិសេធ ប្រសិនបើមានខែណាដែលបានបង់លើសថ្លៃថ្មី។</div>' : ''}
     <div class="err" id="sfErr"></div>`,
    `<button class="btn" data-close>បោះបង់</button><button class="btn primary" id="sfOk">រក្សាទុក</button>`));
  $('#sfOk', card).onclick = async () => {
    const btn = $('#sfOk', card); btn.disabled = true;
    try {
      const r = await call('saveStudent', { code: isEdit ? s.code : '', name: $('#sfName', card).value, sex: $('#sfSex', card).value, category: $('#sfCat', card).value,
        classId: $('#sfClass', card) ? $('#sfClass', card).value : s.classId, startMonth: $('#sfStart', card).value,
        endMonth: $('#sfEnd', card) ? $('#sfEnd', card).value : (isEdit ? s.endMonth : ''), note: $('#sfNote', card).value });
      closeModal(); toast(isEdit ? 'បានរក្សាទុក' : 'បានបន្ថែមសិស្ស ' + r.code); refresh();
    } catch(e){ $('#sfErr', card).textContent = e.message; btn.disabled = false; }
  };
}

function openWithdraw(s){
  const months = S.boot.settings.months.filter(m => m >= (s.startMonth || ''));
  const card = openModal(modalShell('សិស្សឈប់រៀន — ' + esc(s.name),
    `<div class="notice info">សិស្សនឹងត្រូវគិតថ្លៃរហូតដល់ខែដែលបានជ្រើស។ បំណុលមុនៗនៅតែរក្សាទុក។ ទិន្នន័យមិនត្រូវលុបទេ។</div>
     <div class="field"><label>ខែចុងក្រោយដែលត្រូវបង់</label><select id="wdEnd">${months.map(m => `<option value="${m}" ${m === S.month ? 'selected' : ''}>${mLabel(m)}</option>`).join('')}</select></div>
     <div class="field"><label>មូលហេតុ</label><input type="text" id="wdReason" maxlength="200"></div><div class="err" id="wdErr"></div>`,
    `<button class="btn" data-close>បោះបង់</button><button class="btn danger" id="wdOk">បញ្ជាក់</button>`));
  $('#wdOk', card).onclick = async () => {
    try { await call('withdrawStudent', { code: s.code, endMonth: $('#wdEnd', card).value, reason: $('#wdReason', card).value }); closeModal(); toast('បានកត់ត្រា'); refresh(); }
    catch(e){ $('#wdErr', card).textContent = e.message; }
  };
}

function parseBulk(text){
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(/\t|,|;/).map(x => x.trim());
    const name = parts[0] || '';
    const sx = (parts[1] || '').toLowerCase();
    const sex = /^(ស|f|female|ស្រី)/.test(sx) ? 'ស' : /^(ប|m|male|ប្រុស)/.test(sx) ? 'ប' : '';
    const ct = (parts[2] || '').toLowerCase();
    const category = /ក្រីក្រ|poor/.test(ct) ? 'POOR' : 'GEN';
    return { name, sex, category };
  });
}
function openBulkAdd(){
  const card = openModal(modalShell('បញ្ចូលសិស្សច្រើននាក់ — ថ្នាក់ ' + esc(S.classId),
    `<div class="notice info">ចម្លងពី Excel ៖ មួយជួរ មួយនាក់ ជា <b>ឈ្មោះ · ភេទ (ប/ស) · ប្រភេទ (ទូទៅ/ក្រីក្រ)</b> បំបែកដោយ Tab ឬក្បៀស។</div>
     <div class="field"><label>បញ្ជីសិស្ស</label><textarea id="bkTxt" placeholder="សុខ ដារា	ប	ទូទៅ&#10;ចាន់ សុភា	ស	ក្រីក្រ"></textarea></div>
     <div class="field"><label>ចាប់ផ្ដើមបង់ពីខែ</label><select id="bkStart">${monthOptions(S.boot.settings.months[0])}</select></div>
     <div id="bkPrev" class="muted"></div><div class="err" id="bkErr"></div>`,
    `<button class="btn" data-close>បោះបង់</button><button class="btn primary" id="bkOk">បញ្ចូល</button>`), { wide: true });
  const upd = () => { const rows = parseBulk($('#bkTxt', card).value); const bad = rows.filter(r => !r.name || !r.sex).length;
    $('#bkPrev', card).innerHTML = rows.length ? `${rows.length} នាក់ (ទូទៅ ${rows.filter(r => r.category === 'GEN').length} · ក្រីក្រ ${rows.filter(r => r.category === 'POOR').length})${bad ? ` · <span style="color:var(--bad)">${bad} ជួរខ្វះភេទ ឬឈ្មោះ</span>` : ''}` : ''; };
  $('#bkTxt', card).oninput = upd;
  $('#bkOk', card).onclick = async () => {
    const btn = $('#bkOk', card); btn.disabled = true;
    try { const r = await call('bulkAddStudents', { classId: S.classId, startMonth: $('#bkStart', card).value, rows: parseBulk($('#bkTxt', card).value) });
      closeModal(); toast('បានបញ្ចូលសិស្ស ' + r.count + ' នាក់'); refresh(); }
    catch(e){ $('#bkErr', card).textContent = e.message; btn.disabled = false; }
  };
}

/* ============================ Payment ============================ */
async function openPayment(code){
  openModal(modalShell('កត់ត្រាការបង់ប្រាក់', '<div class="loading">កំពុងផ្ទុក…</div>'), { wide: true });
  let d; try { d = await call('studentDetail', { code }); } catch(e){ closeModal(); return fail(e); }
  const s = d.student;
  const open = d.grid.filter(g => g.enrolled && g.bal > 0);
  const firstOwed = open.length ? open[0].m : null;
  const requestId = uuid();
  const card = openModal(modalShell(`កត់ត្រាការបង់ប្រាក់ — ${esc(s.name)} <span class="muted" style="font-weight:400">· ${esc(s.code)} · ថ្នាក់ ${esc(s.classId)}</span>`,
    `${open.length ? `<p class="muted" style="margin-top:0">ធីកខែដែលត្រូវបង់។ អាចកែទឹកប្រាក់សម្រាប់ការបង់ខ្លះ។ ប្រព័ន្ធមិនអនុញ្ញាតឱ្យបង់លើសទេ។</p>
     <div class="tbl-wrap" style="margin-bottom:14px"><table><thead><tr><th class="c">ជ្រើស</th><th>ខែ</th><th class="n">ត្រូវបង់</th><th class="n">បានបង់</th><th class="n">នៅសល់</th><th class="n" style="width:160px">បង់លើកនេះ (៛)</th></tr></thead><tbody>
     ${open.map(g => `<tr><td class="c"><input type="checkbox" data-m="${g.m}" ${g.m === firstOwed ? 'checked' : ''}></td><td>${mLabel(g.m)}${g.m > S.boot.currentMonth ? ' <span class="chip NA">បង់មុន</span>' : ''}</td>
       <td class="n">${num(g.due)}</td><td class="n">${num(g.paid)}</td><td class="n">${num(g.bal)}</td>
       <td class="n"><input type="number" data-a="${g.m}" min="100" step="100" max="${g.bal}" value="${g.m === firstOwed ? g.bal : ''}" ${g.m === firstOwed ? '' : 'disabled'} style="text-align:right"></td></tr>`).join('')}
     </tbody></table></div>
     <div class="row"><div class="field"><label>ថ្ងៃទទួលប្រាក់</label><input type="date" id="pyDate" value="${S.boot.today}" max="${S.boot.today}"></div>
       <div class="field"><label>វិធីបង់</label><select id="pyMethod">${S.boot.settings.methods.map(m => `<option>${esc(m)}</option>`).join('')}</select></div></div>
     <div class="field"><label>សម្គាល់</label><input type="text" id="pyNote" maxlength="200"></div>
     <div style="font-size:18px;text-align:right">សរុប៖ <b id="pyTotal">0 ៛</b></div><div class="err" id="pyErr"></div>`
     : '<div class="empty">សិស្សនេះបានបង់គ្រប់ខែរួចហើយ</div>'}`,
    `<button class="btn" data-close>បោះបង់</button>${open.length ? '<button class="btn primary" id="pyOk">រក្សាទុក និងចេញបង្កាន់ដៃ</button>' : ''}`), { wide: true, noFocus: true });
  if (!open.length) return;
  const recalc = () => { let t = 0; $$('input[data-a]', card).forEach(i => { if (!i.disabled) t += Number(i.value || 0); }); $('#pyTotal', card).textContent = money(t); };
  $$('input[data-m]', card).forEach(cb => cb.onchange = () => {
    const inp = $(`input[data-a="${cb.dataset.m}"]`, card); inp.disabled = !cb.checked;
    inp.value = cb.checked ? inp.max : ''; recalc();
  });
  $$('input[data-a]', card).forEach(i => i.oninput = recalc);
  recalc();
  $('#pyOk', card).onclick = async () => {
    const lines = $$('input[data-a]', card).filter(i => !i.disabled).map(i => ({ monthKey: i.dataset.a, amount: Number(i.value) }));
    if (!lines.length) { $('#pyErr', card).textContent = 'សូមជ្រើសខែយ៉ាងហោចណាស់មួយ'; return; }
    const btn = $('#pyOk', card); btn.disabled = true; btn.textContent = 'កំពុងរក្សាទុក…';
    try {
      const r = await call('recordPayment', { requestId, studentCode: s.code, paidDate: $('#pyDate', card).value, method: $('#pyMethod', card).value, note: $('#pyNote', card).value, lines });
      toast('បានកត់ត្រា បង្កាន់ដៃ ' + r.receiptNo);
      showReceipt(r);
      if (S.view === 'classes' || S.view === 'dashboard' || S.view === 'receipts') refreshBehind();
    } catch(e){ $('#pyErr', card).textContent = e.message; btn.disabled = false; btn.textContent = 'រក្សាទុក និងចេញបង្កាន់ដៃ'; }
  };
}
function refreshBehind(){ const fn = { classes: viewClasses, dashboard: viewDashboard, receipts: viewReceipts }[S.view]; if (fn) fn().catch(() => {}); }

/* ============================ Receipts ============================ */
function receiptHtml(r){
  const st = S.boot.settings;
  return `<div class="receipt">${r.status === 'VOID' ? '<div class="stamp">VOID</div>' : ''}
    <div style="display:flex;justify-content:space-between;font-size:13px"><div>${esc(st.schoolName)}</div><div>លេខ៖ <b>${esc(r.receiptNo)}</b></div></div>
    <h2 class="moul">បង្កាន់ដៃទទួលប្រាក់</h2>
    <div style="text-align:center;font-size:13px;margin:-6px 0 12px">ថវិកាការបង្រៀនពេញម៉ោង ឆ្នាំសិក្សា ${esc(st.schoolYear)}</div>
    <div class="meta"><div>ឈ្មោះសិស្ស៖ <b>${esc(r.studentName)}</b></div><div>កូដ៖ ${esc(r.studentCode)}</div>
      <div>ថ្នាក់ទី៖ <b>${esc(r.classId)}</b></div><div>ថ្ងៃទទួល៖ ${dLabel(r.paidDate)}</div>
      <div>វិធីបង់៖ ${esc(r.method)}</div><div>អ្នកទទួល៖ ${esc(r.recordedBy)}</div></div>
    <table style="width:100%"><thead><tr><th>សម្រាប់ខែ</th><th class="n">ទឹកប្រាក់ (៛)</th></tr></thead><tbody>
      ${r.lines.map(l => `<tr><td>${mLabel(l.month)}</td><td class="n">${num(l.amount)}</td></tr>`).join('')}
      <tr class="tot"><td>សរុប</td><td class="n">${num(r.total)}</td></tr></tbody></table>
    ${r.note ? `<p style="font-size:13px">សម្គាល់៖ ${esc(r.note)}</p>` : ''}
    ${r.status === 'VOID' ? `<p style="font-size:13px;color:var(--bad)">VOID ដោយ ${esc(r.voidedBy)} (${esc(r.voidedAt)})៖ ${esc(r.voidReason)}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;text-align:center;margin-top:18px;font-size:14px"><div>អ្នកបង់ប្រាក់<div style="height:60px"></div></div><div>អ្នកទទួលប្រាក់<div style="height:60px"></div></div></div>
    <div style="font-size:11px;color:#777;text-align:center">បង្កើតដោយប្រព័ន្ធ · ${esc(r.createdAt)}</div></div>`;
}
function showReceipt(r){
  const card = openModal(modalShell('បង្កាន់ដៃ ' + esc(r.receiptNo), receiptHtml(r),
    `${is('ADMIN') && r.status === 'ACTIVE' ? '<button class="btn danger" id="rcVoid">VOID</button><span style="flex:1"></span>' : ''}<button class="btn" data-close>បិទ</button><button class="btn primary" id="rcPrint">បោះពុម្ព</button>`), { noFocus: true });
  $('#rcPrint', card).onclick = () => printHtml(receiptHtml(r));
  if ($('#rcVoid', card)) $('#rcVoid', card).onclick = async () => {
    const reason = await askReason('VOID បង្កាន់ដៃ ' + r.receiptNo, 'បង្កាន់ដៃនឹងនៅតែមានក្នុងប្រព័ន្ធ ជាមួយស្លាក VOID ហើយទឹកប្រាក់នឹងមិនត្រូវរាប់ទៀតទេ។ សកម្មភាពនេះត្រូវកត់ក្នុងកំណត់ហេតុ។');
    if (!reason) return;
    try { await call('voidReceipt', { receiptNo: r.receiptNo, reason }); toast('បាន VOID'); refresh(); } catch(e){ fail(e); }
  };
}
async function openReceipt(no){ try { showReceipt(await call('getReceipt', { receiptNo: no })); } catch(e){ fail(e); } }

async function viewReceipts(){
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><h2 style="font-size:19px">បង្កាន់ដៃទទួលប្រាក់</h2><span class="grow"></span>
    <select id="rcMonth"><option value="">គ្រប់ខែ</option>${monthOptions(S.rcMonth === undefined ? S.month : S.rcMonth)}</select>
    <select id="rcClass">${classOptions(S.rcClass || '', true)}</select>
    <input type="text" id="rcQ" placeholder="លេខបង្កាន់ដៃ ឈ្មោះ ឬកូដ…" value="${esc(S.rcQ || '')}"></div><div id="rcBody" class="loading">កំពុងផ្ទុក…</div>`;
  const reload = () => { S.rcMonth = $('#rcMonth').value; S.rcClass = $('#rcClass').value; S.rcQ = $('#rcQ').value; viewReceipts(); };
  $('#rcMonth').onchange = reload; $('#rcClass').onchange = reload;
  let qt; $('#rcQ').oninput = () => { clearTimeout(qt); qt = setTimeout(reload, 500); };
  const r = await call('listReceipts', { month: $('#rcMonth').value, classId: $('#rcClass').value, q: $('#rcQ').value });
  const b = $('#rcBody'); b.className = '';
  b.innerHTML = `<p class="muted" style="margin-top:0">${num(r.count)} បង្កាន់ដៃ · សរុបមានសុពលភាព <b>${money(r.total)}</b> (តាមថ្ងៃទទួលប្រាក់)</p>
    ${r.rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>លេខ</th><th>ថ្ងៃទទួល</th><th>សិស្ស</th><th>ថ្នាក់</th><th class="n">ទឹកប្រាក់</th><th>វិធី</th><th>អ្នកកត់ត្រា</th><th>ស្ថានភាព</th></tr></thead><tbody>
    ${r.rows.map(x => `<tr class="click ${x.status === 'VOID' ? 'void' : ''}" data-r="${esc(x.receiptNo)}"><td>${esc(x.receiptNo)}</td><td>${dLabel(x.paidDate)}</td><td>${esc(x.studentName)} <span class="muted">${esc(x.studentCode)}</span></td>
      <td>${esc(x.classId)}</td><td class="n">${num(x.total)}</td><td>${esc(x.method)}</td><td>${esc(x.recordedBy)}</td><td><span class="chip ${x.status}">${x.status === 'VOID' ? 'VOID' : 'មានសុពលភាព'}</span></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">មិនមានបង្កាន់ដៃ</div>'}`;
  $$('tr[data-r]', b).forEach(tr => tr.onclick = () => openReceipt(tr.dataset.r));
}

/* ============================ Expenses ============================ */
async function viewExpenses(){
  const v = $('#view');
  const writable = is('ADMIN','ACCOUNTANT');
  v.innerHTML = `<div class="toolbar"><h2 style="font-size:19px">ចំណាយ និងប្រាក់ម៉ោងគ្រូ</h2><span class="grow"></span><select id="exMonth">${monthOptions(S.month)}</select>
    ${writable ? '<button class="btn" id="exOther">+ ចំណាយផ្សេងៗ</button><button class="btn primary" id="exTeacher">+ ប្រាក់ម៉ោងគ្រូ</button>' : ''}</div><div id="exBody" class="loading">កំពុងផ្ទុក…</div>`;
  $('#exMonth').onchange = e => { S.month = e.target.value; viewExpenses(); };
  if (writable) { $('#exTeacher').onclick = () => openExpenseForm('TEACHER'); $('#exOther').onclick = () => openExpenseForm('OTHER'); }
  const r = await call('listExpenses', { month: S.month });
  const b = $('#exBody'); b.className = '';
  b.innerHTML = `<div class="kpis"><div class="kpi gold"><div class="l">ប្រាក់ម៉ោងគ្រូ ${mLabel(S.month)}</div><div class="v">${money(r.totalTeacher)}</div></div>
    <div class="kpi"><div class="l">ចំណាយផ្សេងៗ</div><div class="v">${money(r.totalOther)}</div></div>
    <div class="kpi bad"><div class="l">ចំណាយសរុប</div><div class="v">${money(r.totalTeacher + r.totalOther)}</div></div></div>
    ${r.rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>លេខ</th><th>ថ្ងៃ</th><th>ប្រភេទ</th><th>ឈ្មោះគ្រូ / បរិយាយ</th><th>តួនាទី / ប្រភេទចំណាយ</th><th class="n">ម៉ោង</th><th class="n">អត្រា/ម៉ោង</th><th class="n">ទឹកប្រាក់</th><th>លេខយោង</th><th>ស្ថានភាព</th><th></th></tr></thead><tbody>
      ${r.rows.map(x => `<tr class="${x.status === 'VOID' ? 'void' : ''}"><td>${esc(x.id)}</td><td>${dLabel(x.date)}</td><td>${esc(S.boot.settings.expenseTypes[x.type])}</td><td>${esc(x.payee)}</td><td>${esc(x.category)}</td>
        <td class="n">${x.hours === '' ? '' : num(x.hours)}</td><td class="n">${x.rate === '' ? '' : num(x.rate)}</td><td class="n">${num(x.amount)}</td><td>${esc(x.refNo)}</td>
        <td><span class="chip ${x.status}">${x.status === 'VOID' ? 'VOID' : 'មានសុពលភាព'}</span>${x.voidReason ? `<div class="muted" style="font-size:12px">${esc(x.voidReason)}</div>` : ''}</td>
        <td>${is('ADMIN') && x.status === 'ACTIVE' ? `<button class="btn sm danger" data-void="${esc(x.id)}">VOID</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">មិនមានចំណាយក្នុងខែនេះ</div>'}`;
  $$('[data-void]', b).forEach(btn => btn.onclick = async () => {
    const reason = await askReason('VOID ចំណាយ ' + btn.dataset.void); if (!reason) return;
    try { await call('voidExpense', { id: btn.dataset.void, reason }); toast('បាន VOID'); viewExpenses(); } catch(e){ fail(e); }
  });
}
function openExpenseForm(type){
  const st = S.boot.settings; const requestId = uuid(); const T = type === 'TEACHER';
  const card = openModal(modalShell(T ? 'កត់ត្រាប្រាក់ម៉ោងគ្រូ' : 'កត់ត្រាចំណាយផ្សេងៗ',
    `<div class="row"><div class="field"><label>ថ្ងៃចំណាយ</label><input type="date" id="efDate" value="${S.boot.today}" max="${S.boot.today}"></div>
      <div class="field"><label>សម្រាប់ខែ</label><select id="efMonth">${monthOptions(S.month)}</select></div></div>
     <div class="field"><label>${T ? 'ឈ្មោះគ្រូបង្រៀន' : 'បរិយាយចំណាយ'}</label><input type="text" id="efPayee" maxlength="100"></div>
     ${T ? `<div class="field"><label>តួនាទី / មុខវិជ្ជា</label><input type="text" id="efCat" maxlength="100" placeholder="ឧ. គ្រូបង្រៀនគណិតវិទ្យា"></div>
       <div class="row"><div class="field"><label>ចំនួនម៉ោងក្នុងខែ</label><input type="number" id="efHours" min="0" step="0.5"></div>
       <div class="field"><label>អត្រាប្រាក់ក្នុង១ម៉ោង (៛)</label><input type="number" id="efRate" min="0" step="100"></div></div>
       <div style="text-align:right;font-size:17px">ទឹកប្រាក់៖ <b id="efAmt">0 ៛</b></div>`
     : `<div class="row"><div class="field"><label>ប្រភេទចំណាយ</label><select id="efCat">${st.expenseCategories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
       <div class="field"><label>ទឹកប្រាក់ (៛)</label><input type="number" id="efAmount" min="0" step="100"></div></div>`}
     <div class="row"><div class="field"><label>លេខវិក្កយបត្រ / លេខយោង</label><input type="text" id="efRef" maxlength="50"></div>
       <div class="field"><label>សម្គាល់</label><input type="text" id="efNote" maxlength="200"></div></div><div class="err" id="efErr"></div>`,
    `<button class="btn" data-close>បោះបង់</button><button class="btn primary" id="efOk">រក្សាទុក</button>`));
  if (T) { const up = () => $('#efAmt', card).textContent = money(Math.round(Number($('#efHours', card).value || 0) * Number($('#efRate', card).value || 0))); $('#efHours', card).oninput = up; $('#efRate', card).oninput = up; }
  $('#efOk', card).onclick = async () => {
    const btn = $('#efOk', card); btn.disabled = true;
    try {
      await call('recordExpense', { requestId, type, expenseDate: $('#efDate', card).value, monthKey: $('#efMonth', card).value, payee: $('#efPayee', card).value,
        category: $('#efCat', card).value, hours: T ? $('#efHours', card).value : '', rate: T ? $('#efRate', card).value : '', amount: T ? '' : $('#efAmount', card).value,
        refNo: $('#efRef', card).value, note: $('#efNote', card).value });
      closeModal(); toast('បានកត់ត្រាចំណាយ'); viewExpenses();
    } catch(e){ $('#efErr', card).textContent = e.message; btn.disabled = false; }
  };
}

/* ============================ Reports ============================ */
function docHead(){
  const st = S.boot.settings;
  return `<div class="doc-head"><div class="l moul" style="font-size:13px">${esc(st.ministry)}<br>${esc(st.provinceOffice)}<br>${esc(st.schoolName)}</div>
    <div class="r moul" style="font-size:13px">ព្រះរាជាណាចក្រកម្ពុជា<br>ជាតិ សាសនា ព្រះមហាក្សត្រ<br><span style="font-family:serif">❖❖❖</span></div></div>`;
}
function signBlock(roles){
  return `<div class="sign"><div class="date">${esc(S.boot.settings.location)}, ថ្ងៃទី........ ខែ............ ឆ្នាំ${kh(new Date().getFullYear())}</div>
    ${roles.map(r => `<div class="who">${r}<div style="height:70px"></div>(................................................)</div>`).join('')}</div>`;
}
async function viewReports(){
  const v = $('#view');
  const tabs = [['monthly', 'របាយការណ៍ប្រចាំខែ'], ['annual', 'របាយការណ៍ដំណាច់ឆ្នាំ']];
  if (!is('TEACHER')) tabs.push(['finance', 'ចំណូល-ចំណាយ និងសមតុល្យ']);
  if (!tabs.some(t => t[0] === S.reportTab)) S.reportTab = 'monthly';
  v.innerHTML = `<div class="toolbar"><div class="tabs" style="margin:0">${tabs.map(t => `<button class="pill ${t[0] === S.reportTab ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>
    <span class="grow"></span>${S.reportTab === 'monthly' ? `<select id="rpMonth">${monthOptions(S.month)}</select>` : ''}<button class="btn primary" id="rpPrint">បោះពុម្ព / PDF</button></div>
    <div id="rpBody" class="loading">កំពុងផ្ទុក…</div>`;
  $$('[data-t]', v).forEach(b => b.onclick = () => { S.reportTab = b.dataset.t; viewReports(); });
  if ($('#rpMonth')) $('#rpMonth').onchange = e => { S.month = e.target.value; viewReports(); };
  const st = S.boot.settings;
  let html = '';
  if (S.reportTab === 'monthly') {
    const r = await call('monthlyReport', { month: S.month }); const t = r.total;
    html = `<div class="paper">${docHead()}
      <div class="doc-title moul">របាយការណ៍បូកសរុបការប្រមូលថវិកាការបង្រៀនពេញម៉ោង<br>ប្រចាំ${mLabel(r.month)}</div>
      <div class="doc-sub">ឆ្នាំសិក្សា ${esc(st.schoolYear)} · ${esc(st.schoolName)}${is('TEACHER') ? ' · ថ្នាក់ ' + esc(S.boot.classes.join(', ')) : ''}</div>
      <table style="width:100%"><thead><tr><th rowspan="2">ល.រ</th><th rowspan="2">ថ្នាក់</th><th colspan="3">ចំនួនសិស្ស</th><th rowspan="2">ត្រូវប្រមូល<br>ក្នុងខែ</th>
        <th colspan="4">សាច់ប្រាក់ទទួលបានក្នុងខែ</th><th rowspan="2">បានបង់សម្រាប់<br>ខែនេះ</th><th rowspan="2">អត្រា<br>ប្រមូល</th><th rowspan="2">នៅជំពាក់<br>សរុប</th></tr>
        <tr><th>សរុប</th><th>ទូទៅ</th><th>ក្រីក្រ</th><th>ខែនេះ</th><th>ខែមុនៗ</th><th>បង់មុន</th><th>សរុប</th></tr></thead><tbody>
        ${r.rows.map((x, i) => `<tr><td class="c">${kh(i + 1)}</td><td class="c">${esc(x.classId)}</td><td class="n">${num(x.students)}</td><td class="n">${num(x.gen)}</td><td class="n">${num(x.poor)}</td><td class="n">${num(x.due)}</td>
          <td class="n">${num(x.cashCurrent)}</td><td class="n">${num(x.cashPrev)}</td><td class="n">${num(x.cashAdvance)}</td><td class="n">${num(x.cashTotal)}</td><td class="n">${num(x.paidForMonth)}</td><td class="n">${x.due ? pct(x.rate) : '-'}</td><td class="n">${num(x.outstanding)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="2" class="c">សរុប</td><td class="n">${num(t.students)}</td><td class="n">${num(t.gen)}</td><td class="n">${num(t.poor)}</td><td class="n">${num(t.due)}</td><td class="n">${num(t.cashCurrent)}</td><td class="n">${num(t.cashPrev)}</td>
          <td class="n">${num(t.cashAdvance)}</td><td class="n">${num(t.cashTotal)}</td><td class="n">${num(t.paidForMonth)}</td><td class="n">${pct(t.rate)}</td><td class="n">${num(t.outstanding)}</td></tr></tbody></table>
      <p style="font-size:12px;color:#555">ឯកតា៖ រៀល (៛)។ «នៅជំពាក់សរុប» = ថ្លៃត្រូវបង់ពីដើមឆ្នាំដល់ចុងខែ ដកការបង់ដែលទទួលបានត្រឹមចុងខែ។ គណនានៅ ${esc(r.generatedAt)}។</p>
      ${signBlock(['ប្រធានគណៈកម្មការទ្រទ្រង់', 'គណនេយ្យករ', 'នាយកវិទ្យាល័យ'])}</div>`;
  } else if (S.reportTab === 'annual') {
    const r = await call('annualReport'); const t = r.total;
    html = `<div class="paper">${docHead()}
      <div class="doc-title moul">របាយការណ៍បូកសរុបថវិកាការបង្រៀនពេញម៉ោង<br>ដំណាច់ឆ្នាំសិក្សា ${esc(st.schoolYear)}</div>
      <div class="doc-sub">${kh(st.months.length)} ខែ (${mLabel(st.months[0])} ដល់ ${mLabel(st.months[st.months.length - 1])}) · ${kh(r.rows.length)} ថ្នាក់</div>
      <table style="width:100%"><thead><tr><th>ល.រ</th><th>ថ្នាក់</th><th>សិស្សសរុប</th><th>ទូទៅ</th><th>ក្រីក្រ</th><th>ឈប់រៀន</th><th>ថវិកាត្រូវប្រមូល</th><th>ថវិកាបានបង់</th><th>នៅជំពាក់</th><th>ភាគរយ</th></tr></thead><tbody>
      ${r.rows.map((x, i) => `<tr><td class="c">${kh(i + 1)}</td><td class="c">${esc(x.classId)}</td><td class="n">${num(x.students)}</td><td class="n">${num(x.gen)}</td><td class="n">${num(x.poor)}</td><td class="n">${num(x.withdrawn)}</td>
        <td class="n">${num(x.due)}</td><td class="n">${num(x.paid)}</td><td class="n">${num(x.outstanding)}</td><td class="n">${x.due ? pct(x.rate) : '-'}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2" class="c">សរុបរួម</td><td class="n">${num(t.students)}</td><td class="n">${num(t.gen)}</td><td class="n">${num(t.poor)}</td><td class="n">${num(t.withdrawn)}</td><td class="n">${num(t.due)}</td><td class="n">${num(t.paid)}</td><td class="n">${num(t.outstanding)}</td><td class="n">${pct(t.rate)}</td></tr>
      </tbody></table><p style="font-size:12px;color:#555">ឯកតា៖ រៀល (៛)។ គិតតាមខែដែលសិស្សពិតជាចុះឈ្មោះរៀន (ចូលយឺត / ឈប់រៀន)។ គណនានៅ ${esc(r.generatedAt)}។</p>
      ${signBlock(['បានពិនិត្យត្រឹមត្រូវ<br>គណៈកម្មការហិរញ្ញវត្ថុ', 'គណនេយ្យករ', 'បានឃើញ និងឯកភាព<br>នាយកវិទ្យាល័យ'])}</div>`;
  } else {
    const r = await call('financeReport'); const t = r.total;
    html = `<div class="paper">${docHead()}
      <div class="doc-title moul">តារាងចំណូល ចំណាយ និងសមតុល្យ<br>ថវិកាការបង្រៀនពេញម៉ោង ឆ្នាំសិក្សា ${esc(st.schoolYear)}</div><div class="doc-sub">${esc(st.schoolName)}</div>
      <table style="width:100%"><thead><tr><th>ខែ</th><th>ចំណូល (ការបង់របស់សិស្ស)</th><th>ប្រាក់ម៉ោងគ្រូ</th><th>ចំណាយផ្សេងៗ</th><th>ចំណូល − ចំណាយ</th><th>សមតុល្យបូកបន្ត</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td>${mLabel(x.month)}</td><td class="n">${num(x.income)}</td><td class="n">${num(x.teacher)}</td><td class="n">${num(x.other)}</td><td class="n" style="${x.net < 0 ? 'color:var(--bad)' : ''}">${num(x.net)}</td><td class="n"><b>${num(x.balance)}</b></td></tr>`).join('')}
      <tr class="tot"><td>សរុប</td><td class="n">${num(t.income)}</td><td class="n">${num(t.teacher)}</td><td class="n">${num(t.other)}</td><td class="n">${num(t.net)}</td><td class="n">${num(t.balance)}</td></tr></tbody></table>
      <p style="font-size:12px;color:#555">ឯកតា៖ រៀល (៛)។ ចំណូលគិតតាមថ្ងៃទទួលប្រាក់ ចំណាយគិតតាមខែដែលបានកំណត់។ គណនានៅ ${esc(r.generatedAt)}។</p>
      ${signBlock(['ប្រធានគណៈកម្មការទ្រទ្រង់', 'គណនេយ្យករ', 'នាយកវិទ្យាល័យ'])}</div>`;
  }
  const b = $('#rpBody'); b.className = ''; b.innerHTML = html;
  $('#rpPrint').onclick = () => printHtml(html);
}

/* ============================ Users ============================ */
async function viewUsers(){
  const rows = await call('listUsers');
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><h2 style="font-size:19px">អ្នកប្រើប្រាស់</h2><span class="grow"></span><button class="btn primary" id="usAdd">+ បន្ថែមអ្នកប្រើ</button></div>
    <div class="notice info">អ្នកប្រើចូលប្រព័ន្ធដោយគណនី Google របស់ខ្លួន។ ម្នាក់ត្រូវមានគណនីផ្ទាល់ខ្លួនមួយ។ កុំប្រើគណនីរួមគ្នា ដើម្បីឱ្យកំណត់ហេតុបង្ហាញថាអ្នកណាជាអ្នកធ្វើសកម្មភាព។</div>
    <div class="tbl-wrap"><table><thead><tr><th>ឈ្មោះអ្នកប្រើ</th><th>ឈ្មោះពេញ</th><th>អ៊ីមែល Google</th><th>តួនាទី</th><th>ថ្នាក់</th><th>ស្ថានភាព</th><th>ចូលចុងក្រោយ</th><th></th></tr></thead><tbody>
    ${rows.map(u => `<tr class="${u.active ? '' : 'inactive'}"><td><b>${esc(u.username)}</b></td><td>${esc(u.displayName)}</td><td>${u.email ? esc(u.email) : '<span style="color:var(--bad)">មិនទាន់មាន</span>'}</td><td><span class="chip role">${ROLE_LABEL[u.role] || esc(u.role)}</span></td>
      <td>${esc(u.classes === '*' ? 'ទាំងអស់' : u.classes)}</td><td>${u.active ? 'សកម្ម' : 'បិទ'}</td>
      <td>${esc(u.lastLoginAt || '-')}</td><td style="white-space:nowrap"><button class="btn sm" data-edit="${esc(u.username)}">កែ</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#usAdd').onclick = () => openUserForm(null);
  $$('[data-edit]').forEach(b => b.onclick = () => openUserForm(rows.find(u => u.username === b.dataset.edit)));
}
function openUserForm(u){
  const isEdit = !!u;
  const card = openModal(modalShell(isEdit ? 'កែប្រែអ្នកប្រើ ' + esc(u.username) : 'បន្ថែមអ្នកប្រើថ្មី',
    `<div class="row"><div class="field"><label>ឈ្មោះអ្នកប្រើ (a-z, 0-9)</label><input type="text" id="ufUser" value="${isEdit ? esc(u.username) : ''}" ${isEdit ? 'disabled' : ''}></div>
      <div class="field"><label>ឈ្មោះពេញ</label><input type="text" id="ufName" value="${isEdit ? esc(u.displayName) : ''}"></div></div>
     <div class="field"><label>អ៊ីមែល Google (សម្រាប់ចូលប្រព័ន្ធ)</label><input type="text" id="ufEmail" inputmode="email" autocomplete="off" value="${isEdit ? esc(u.email || '') : ''}" placeholder="name@gmail.com"></div>
     <div class="row"><div class="field"><label>តួនាទី</label><select id="ufRole">${Object.keys(ROLE_LABEL).map(r => `<option value="${r}" ${isEdit && u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
      <div class="field"><label>ថ្នាក់ (សម្រាប់គ្រូបន្ទុកថ្នាក់ ឧ. 7A,7B)</label><input type="text" id="ufClasses" value="${isEdit && u.classes !== '*' ? esc(u.classes) : ''}"></div></div>
     ${isEdit ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ufActive" ${u.active ? 'checked' : ''}> គណនីសកម្ម</label>` : ''}
     <div class="muted" style="font-size:13px;margin-top:10px">គណនេយ្យករ៖ កត់ត្រាការបង់ប្រាក់ សិស្ស និងចំណាយ · គ្រូបន្ទុកថ្នាក់៖ មើល (និងកត់ត្រាការបង់ ប្រសិនបើអនុញ្ញាត) តែថ្នាក់ខ្លួន · នាយក៖ មើលបានទាំងអស់ តែមិនអាចកែ</div>
     <div class="err" id="ufErr"></div>`,
    `<button class="btn" data-close>បោះបង់</button><button class="btn primary" id="ufOk">រក្សាទុក</button>`));
  $('#ufOk', card).onclick = async () => {
    try {
      await call('saveUser', { isEdit, username: $('#ufUser', card).value, displayName: $('#ufName', card).value, email: $('#ufEmail', card).value,
        role: $('#ufRole', card).value, classes: $('#ufClasses', card).value, active: isEdit ? $('#ufActive', card).checked : true });
      closeModal(); toast('បានរក្សាទុក');
      viewUsers();
    } catch(e){ $('#ufErr', card).textContent = e.message; }
  };
}

/* ============================ Settings ============================ */
async function viewSettings(){
  const st = S.boot.settings;
  const v = $('#view');
  v.innerHTML = `<div class="card"><h2>ព័ត៌មានសាលា និងថ្លៃសិក្សា</h2>
    <div class="row"><div class="field"><label>ឈ្មោះសាលា</label><input type="text" id="stSchool" value="${esc(st.schoolName)}"></div><div class="field"><label>ទីកន្លែង (សម្រាប់ហត្ថលេខា)</label><input type="text" id="stLoc" value="${esc(st.location)}"></div></div>
    <div class="row"><div class="field"><label>ក្រសួង</label><input type="text" id="stMin" value="${esc(st.ministry)}"></div><div class="field"><label>មន្ទីរ</label><input type="text" id="stProv" value="${esc(st.provinceOffice)}"></div></div>
    <div class="row"><div class="field"><label>ថ្លៃសិស្សទូទៅ / ខែ (៛)</label><input type="number" id="stGen" value="${st.generalFee}"></div><div class="field"><label>ថ្លៃសិស្សបណ្ណក្រីក្រ / ខែ (៛)</label><input type="number" id="stPoor" value="${st.poorFee}"></div></div>
    <div class="row"><div class="field"><label>ឆ្នាំសិក្សា</label><input type="text" id="stYear" value="${esc(st.schoolYear)}"></div><div class="field"><label>ខែសិក្សា (YYYY-MM បំបែកដោយក្បៀស)</label><input type="text" id="stMonths" value="${esc(st.months.join(', '))}"></div></div>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="stTeach" ${st.teacherCanRecord ? 'checked' : ''}> អនុញ្ញាតឱ្យគ្រូបន្ទុកថ្នាក់កត់ត្រាការបង់ប្រាក់សម្រាប់ថ្នាក់របស់ខ្លួន</label>
    <div class="notice">ការប្ដូរថ្លៃសិក្សា ប៉ះពាល់ដល់ការគណនាគ្រប់ខែ។ ការប្ដូរខែសិក្សា មិនអាចធ្វើបានទេ ពេលមានការបង់ប្រាក់រួចហើយ។</div>
    <div class="err" id="stErr"></div><button class="btn primary" id="stSave">រក្សាទុក</button></div>
    <div class="card"><h2>ថ្នាក់រៀន</h2><div class="pills">${S.boot.allClasses.map(c => `<button class="pill ${c.active ? 'on' : ''}" data-cl="${esc(c.classId)}" data-a="${c.active ? 1 : 0}" title="ចុចដើម្បីបិទ/បើក">${esc(c.classId)}</button>`).join('')}</div>
      <div class="row"><div class="field" style="max-width:200px"><label>បន្ថែមថ្នាក់ថ្មី</label><input type="text" id="stNewClass" placeholder="ឧ. 11G"></div><button class="btn" id="stAddClass" style="margin-bottom:12px">បន្ថែម</button></div></div>
    <div class="card"><h2>ការបម្រុងទុក</h2><p class="muted">ចម្លង Spreadsheet ទាំងមូលទៅ Google Drive ថត HSK-Budget-Backups។ ការបម្រុងទុកប្រចាំថ្ងៃដំណើរការដោយស្វ័យប្រវត្តិ ប្រសិនបើបានដំឡើង។</p><button class="btn" id="stBackup">បម្រុងទុកឥឡូវនេះ</button></div>`;
  $('#stSave').onclick = async () => {
    try {
      const months = $('#stMonths').value.split(',').map(x => x.trim()).filter(Boolean);
      await call('saveSettings', { schoolName: $('#stSchool').value, location: $('#stLoc').value, ministry: $('#stMin').value, provinceOffice: $('#stProv').value,
        generalFee: $('#stGen').value, poorFee: $('#stPoor').value, teacherCanRecord: $('#stTeach').checked, schoolYear: $('#stYear').value, months });
      toast('បានរក្សាទុក'); await startApp(); go('settings');
    } catch(e){ $('#stErr').textContent = e.message; }
  };
  $$('[data-cl]').forEach(b => b.onclick = async () => {
    try { await call('saveClass', { classId: b.dataset.cl, active: b.dataset.a !== '1' }); await startApp(); go('settings'); } catch(e){ fail(e); }
  });
  $('#stAddClass').onclick = async () => { try { await call('saveClass', { classId: $('#stNewClass').value }); await startApp(); go('settings'); toast('បានបន្ថែមថ្នាក់'); } catch(e){ fail(e); } };
  $('#stBackup').onclick = async () => { try { const r = await call('backupNow'); toast('បានបម្រុងទុក៖ ' + r.name); } catch(e){ fail(e); } };
}

/* ============================ Audit ============================ */
async function viewAudit(){
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><h2 style="font-size:19px">កំណត់ហេតុសកម្មភាព</h2><span class="grow"></span><input type="text" id="auQ" placeholder="ស្វែងរក…" value="${esc(S.auQ || '')}">
    <button class="btn" id="auVerify">ផ្ទៀងផ្ទាត់ភាពត្រឹមត្រូវ</button></div><div id="auRes"></div><div id="auBody" class="loading">កំពុងផ្ទុក…</div>`;
  let qt; $('#auQ').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.auQ = e.target.value; viewAudit(); }, 500); };
  $('#auVerify').onclick = async () => {
    try { const r = await call('verifyAudit');
      $('#auRes').innerHTML = r.ok ? `<div class="notice info">✔ កំណត់ហេតុទាំង ${num(r.rows)} ជួរ ត្រឹមត្រូវ មិនមានការកែប្រែ។</div>`
        : `<div class="notice" style="background:var(--bad-soft);border-color:#efc2bd;color:var(--bad)">⚠ រកឃើញការកែប្រែកំណត់ហេតុនៅជួរទី ${num(r.brokenAtRow)} (${esc(r.ts)})។ សូមពិនិត្យជាមួយការបម្រុងទុក។</div>`;
    } catch(e){ fail(e); }
  };
  const rows = await call('auditLog', { q: S.auQ || '' });
  const b = $('#auBody'); b.className = '';
  b.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>ពេលវេលា</th><th>អ្នកធ្វើ</th><th>សកម្មភាព</th><th>វត្ថុ</th><th>លេខ</th><th>ព័ត៌មានលម្អិត</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td style="white-space:nowrap">${esc(r.ts)}</td><td>${esc(r.actor)}</td><td><b>${esc(r.action)}</b></td><td>${esc(r.entity)}</td><td>${esc(r.id)}</td><td style="font-size:13px">${esc(r.summary)}</td></tr>`).join('')}
    </tbody></table></div><p class="muted" style="font-size:13px">បង្ហាញ ៣០០ ជួរចុងក្រោយ</p>`;
}

/* ============================ Boot ============================ */
(async function init(){
  try { await startApp(); }
  catch(e){ if (!leaving) { $('#appShell').hidden = false; $('#view').innerHTML = `<div class="card err">${esc(e.message)}</div>`; } }
})();
}
