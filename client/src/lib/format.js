/**
 * Formatting helpers (§5):
 * - Unknown / null / undefined money values are NEVER rendered as 0 ("نامشخص").
 * - Currency unit ("تومان") is ALWAYS shown next to every monetary value.
 * - API ISO-8601 timestamps are formatted in Persian calendar (fa-IR) with local timezone.
 */

export function formatMoney(amount, { freeLabel = false } = {}) {
  if (amount === null || amount === undefined || amount === '') {
    return 'نامشخص';
  }
  const num = Number(amount);
  if (!Number.isFinite(num)) {
    return 'نامشخص';
  }
  if (num === 0 && freeLabel) {
    return 'رایگان (۰ تومان)';
  }
  return `${Math.trunc(num).toLocaleString('fa-IR')} تومان`;
}

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return 'نامشخص';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'نامشخص';
  return num.toLocaleString('fa-IR');
}

const dtFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const dateOnlyFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

export function formatDateTime(iso) {
  if (!iso) return 'ثبت‌نشده';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'نامشخص';
  return dtFormatter.format(d);
}

export function formatDate(iso) {
  if (!iso) return 'ثبت‌نشده';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'نامشخص';
  return dateOnlyFormatter.format(d);
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return 'نامشخص';
  const n = Number(bytes);
  if (!Number.isFinite(n)) return 'نامشخص';
  if (n < 1024) return `${n.toLocaleString('fa-IR')} بایت`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString('fa-IR')} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(1)} مگابایت`;
}

export const ROLE_LABELS = {
  customer: 'مشتری',
  operator: 'اپراتور خدمات',
  support: 'کارشناس پشتیبانی',
  warehouse: 'مسئول انبار و ارسال',
  finance: 'مسئول مالی',
  admin: 'مدیر سامانه',
  system: 'سامانه'
};

export const PRIORITY_LABELS = {
  low: 'کم',
  normal: 'عادی',
  high: 'بالا',
  urgent: 'فوری'
};

export const TICKET_CATEGORY_LABELS = {
  general: 'عمومی',
  orders: 'پیگیری سفارش کالا',
  payments: 'پرداخت و امور مالی',
  services: 'پرسش دربارهٔ خدمات',
  account: 'حساب کاربری',
  other: 'سایر موارد'
};

export function isStaffRole(role) {
  return ['operator', 'support', 'warehouse', 'finance', 'admin'].includes(role);
}
