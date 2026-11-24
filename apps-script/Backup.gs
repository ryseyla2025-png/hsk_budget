/**
 * HSK Budget — backup helper for the Next.js version (v3).
 *
 * Service accounts have no Google Drive storage of their own, so the spreadsheet copy is made here,
 * running as YOU (the spreadsheet owner). The Next.js app calls this web app with a shared secret.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file.
 *  2. Project Settings → Script properties:
 *       SHEET_ID       = the spreadsheet ID (same as SHEET_ID in Vercel)
 *       BACKUP_SECRET  = a long random string (same as BACKUP_SECRET in Vercel)
 *       SERVICE_ACCOUNT = the service account email (only needed for allowServiceAccount)
 *  3. Run allowServiceAccount() once (authorise when asked) — lets the app write to the protected sheets.
 *  4. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → copy the /exec URL
 *     into BACKUP_WEBAPP_URL in Vercel.
 *
 * IMPORTANT: retire the old v2 web app (Code.gs) — delete its daily trigger and archive its deployment —
 * so only the Next.js app writes to the sheet. Two writers would break the audit hash chain.
 */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('BACKUP_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    var name = String(body.name || ('Backup ' + new Date().toISOString())).slice(0, 100);
    var folderName = String(body.folder || 'HSK-Budget-Backups').slice(0, 100);
    var keep = Math.max(5, Math.min(365, Number(body.keep) || 60));

    var file = DriveApp.getFileById(props.getProperty('SHEET_ID'));
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    file.makeCopy(name, folder);

    // keep the newest N copies
    var list = [];
    var it = folder.getFiles();
    while (it.hasNext()) list.push(it.next());
    list.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    list.slice(keep).forEach(function (f) { f.setTrashed(true); });

    return json_({ ok: true, name: name });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'hsk-budget-backup' });
}

/** Run once from the editor: adds the service account as an editor of every protected sheet/range. */
function allowServiceAccount() {
  var props = PropertiesService.getScriptProperties();
  var sa = props.getProperty('SERVICE_ACCOUNT');
  if (!sa) throw new Error('Set the SERVICE_ACCOUNT script property first');
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  ss.addEditor(sa);
  var n = 0;
  ss.getSheets().forEach(function (sh) {
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).concat(sh.getProtections(SpreadsheetApp.ProtectionType.RANGE))
      .forEach(function (p) { if (p.canEdit()) { p.addEditor(sa); n++; } });
  });
  Logger.log('Service account added to ' + n + ' protection(s).');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
