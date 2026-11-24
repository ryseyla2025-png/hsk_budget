/**
 * App constants and sheet schema — ported from Code.gs (APP / SCHEMA / NUMERIC_COLS).
 * v3.0: password columns are no longer used (Google Sign-In); Users gets an Email column.
 */

export const APP = {
  NAME: 'ប្រព័ន្ធគ្រប់គ្រងថវិកាការបង្រៀនពេញម៉ោង',
  VERSION: '3.0.0',
  TZ: 'Asia/Phnom_Penh',
  ROLES: ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'DIRECTOR'] as const,
  CATEGORIES: { GEN: 'សិស្សទូទៅ', POOR: 'បណ្ណក្រីក្រ' } as Record<string, string>,
  METHODS: ['សាច់ប្រាក់', 'ផ្ទេរតាមធនាគារ', 'ផ្សេងៗ'],
  EXPENSE_TYPES: { TEACHER: 'ប្រាក់ម៉ោងគ្រូ', OTHER: 'ចំណាយផ្សេងៗ' } as Record<string, string>,
  EXPENSE_CATEGORIES: ['សម្ភារៈការិយាល័យ', 'ឯកសារ/បោះពុម្ព', 'ទឹក ភ្លើង', 'ជួសជុល', 'ប្រាក់លើកទឹកចិត្ត', 'ផ្សេងៗ'],
  DEFAULT_CLASSES: ['7A', '7B', '7C', '8A', '8B', '9A', '9B',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F',
    '12A', '12B', '12C', '12D'],
  DEFAULT_MONTHS: ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08'],
  BACKUP_FOLDER: 'HSK-Budget-Backups',
};

export const SCHEMA: Record<string, string[]> = {
  Settings: ['Key', 'Value'],
  Users: ['Username', 'DisplayName', 'Role', 'AllowedClasses', 'Active', 'PasswordHash', 'FailedAttempts', 'LockedUntil', 'MustChangePassword', 'CreatedAt', 'UpdatedAt', 'LastLoginAt', 'Email'],
  Classes: ['ClassId', 'Grade', 'SortOrder', 'Active'],
  Students: ['Code', 'Name', 'Sex', 'ClassId', 'Category', 'StartMonth', 'EndMonth', 'Active', 'Note', 'CreatedAt', 'UpdatedAt', 'CreatedBy'],
  Receipts: ['ReceiptNo', 'PaidDate', 'StudentCode', 'StudentName', 'ClassId', 'Total', 'Method', 'Note', 'RecordedBy', 'Status', 'CreatedAt', 'RequestId', 'VoidReason', 'VoidedAt', 'VoidedBy'],
  PaymentLines: ['ReceiptNo', 'StudentCode', 'ClassId', 'MonthKey', 'Amount', 'Status'],
  Expenses: ['ExpenseId', 'ExpenseDate', 'MonthKey', 'Type', 'Payee', 'Category', 'Hours', 'Rate', 'Amount', 'RefNo', 'Note', 'RecordedBy', 'Status', 'CreatedAt', 'RequestId', 'VoidReason', 'VoidedAt', 'VoidedBy'],
  AuditLog: ['Timestamp', 'Actor', 'Action', 'Entity', 'EntityId', 'Summary', 'PrevHash', 'Hash'],
};

/** Sheets loaded into the shared read snapshot (AuditLog is loaded only when needed — it grows large). */
export const CORE_SHEETS = ['Settings', 'Users', 'Classes', 'Students', 'Receipts', 'PaymentLines', 'Expenses'];

export const LOCK_SHEET = '_Locks';
export const LOCK_HEADERS = ['Ticket', 'Ts', 'State'];

export const NUMERIC_COLS: Record<string, 1> = { Total: 1, Amount: 1, Hours: 1, Rate: 1, FailedAttempts: 1, SortOrder: 1, Grade: 1 };

export type Role = (typeof APP.ROLES)[number];
