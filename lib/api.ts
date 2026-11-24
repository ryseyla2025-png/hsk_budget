/** Equivalent of api(token, action, payload) in Code.gs — identity now comes from the Google session email. */
import { ACTIONS, backup_, findUserByEmail_, recordLogin_ } from './actions';
import { getSnapshot, loadAuditLog, runWithDb, type Db } from './db';

export type ApiResult = { ok: true; data: any } | { ok: false; error: string; code: string };

const GENERIC = 'មានបញ្ហាបច្ចេកទេស។ សូមព្យាយាមម្ដងទៀត ឬទាក់ទង Admin។';

function toError(e: any, action: string): ApiResult {
  if (e && e.userFacing) return { ok: false, error: e.message, code: e.code || '' };
  console.error(`api ${action} failed:`, e && e.stack ? e.stack : e);
  return { ok: false, error: GENERIC, code: 'SERVER' };
}

export async function runApi(email: string | null | undefined, action: string, payload: unknown): Promise<ApiResult> {
  const started = Date.now();
  try {
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!def) return { ok: false, error: 'សំណើមិនត្រឹមត្រូវ', code: '' };
    if (!email) return { ok: false, error: 'សូមចូលប្រព័ន្ធម្ដងទៀត', code: 'AUTH' };
    const snapshot = await getSnapshot();
    let db: Db = snapshot;
    if (def.auditLog) {
      // copy the table map so the shared snapshot is not modified
      const copy = Object.create(snapshot) as Db;
      copy.tables = { ...snapshot.tables };
      await loadAuditLog(copy);
      db = copy;
    }
    return await runWithDb(db, async () => {
      const user = findUserByEmail_(email);
      if (!user || user.Active !== 'YES') return { ok: false, error: 'គណនីរបស់អ្នកមិនមានសិទ្ធិ ឬត្រូវបានបិទ', code: 'AUTH' } as ApiResult;
      if (def.roles && def.roles.indexOf(user.Role) < 0) {
        return { ok: false, error: 'អ្នកគ្មានសិទ្ធិធ្វើសកម្មភាពនេះទេ', code: 'FORBIDDEN' } as ApiResult;
      }
      const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const data = await def.fn(p, user);
      return { ok: true, data: data === undefined ? null : data } as ApiResult;
    });
  } catch (e) {
    return toError(e, action);
  } finally {
    if (Date.now() - started > 20000) console.warn(`slow api ${action} ${Date.now() - started}ms`);
  }
}

/** Used by the Auth.js signIn callback: is this Google email an active user? Records the login. */
export async function checkLogin(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const snapshot = await getSnapshot();
    return await runWithDb(snapshot, async () => {
      const user = findUserByEmail_(email);
      if (!user || user.Active !== 'YES') return false;
      try { await recordLogin_(user); } catch (e) { console.error('recordLogin failed', e); }
      return true;
    });
  } catch (e) {
    console.error('checkLogin failed', e);
    return false;
  }
}

/** Daily backup from Vercel Cron. */
export async function runScheduledBackup(): Promise<ApiResult> {
  try {
    const snapshot = await getSnapshot();
    return await runWithDb(snapshot, async () => ({ ok: true, data: await backup_('TRIGGER') }) as ApiResult);
  } catch (e) {
    return toError(e, 'cronBackup');
  }
}
