/**
 * Client-side mirror of the server security policy.
 * The server is always the authority; this module only gives immediate,
 * localized feedback so users do not have to guess why a form was rejected.
 */

export const PASSWORD_MIN_LENGTH = 12;

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'admin123', 'admin1234', 'welcome1', 'iloveyou',
  'letmein1', 'centralmine', 'central123', 'mine1234', 'iran1234', 'test1234',
  'passw0rd', 'p@ssw0rd', 'abcd1234', 'a1b2c3d4', '11111111', '00000000'
]);

/** Converts Persian/Arabic digits to Latin and strips separators from phone numbers. */
export function normalizePhone(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-()]/g, '')
    .replace(/^\+?98/, '0');
}

export function isValidIranPhone(value) {
  return /^09\d{9}$/.test(normalizePhone(value));
}

/** Returns the list of unmet policy rules (empty array = accepted by policy). */
export function passwordProblems(password, { personal = [] } = {}) {
  const problems = [];
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) problems.push(`حداقل ${PASSWORD_MIN_LENGTH} نویسه لازم است.`);
  if (value && !/[a-z]/.test(value)) problems.push('حداقل یک حرف کوچک لاتین.');
  if (value && !/[A-Z]/.test(value)) problems.push('حداقل یک حرف بزرگ لاتین.');
  if (value && !/\d/.test(value)) problems.push('حداقل یک رقم.');
  if (value && !/[^A-Za-z0-9]/.test(value)) problems.push('حداقل یک نشانهٔ ویژه مانند !@#$.');
  if (/(.)\1{3,}/.test(value)) problems.push('بدون تکرار پشت‌سرهم چهار نویسه.');
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwerty|asdf)/i.test(value)) {
    problems.push('بدون دنبالهٔ ساده مثل 1234 یا qwerty.');
  }
  if (COMMON.has(value.toLowerCase())) problems.push('این رمز بسیار رایج است.');
  const lowered = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const raw of personal) {
    const token = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (token.length >= 4 && lowered.includes(token)) {
      problems.push('رمز نباید شامل نام، شماره یا ایمیل شما باشد.');
      break;
    }
  }
  return problems;
}

/** 0–4 strength buckets for the meter. */
export function passwordStrength(password) {
  const value = String(password || '');
  if (!value) return { score: 0, label: 'خالی', tone: 'empty' };
  const problems = passwordProblems(value);
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value) && value.length >= PASSWORD_MIN_LENGTH + 2) score += 1;
  if (problems.length) score = Math.min(score, 2);
  const labels = ['بسیار ضعیف', 'ضعیف', 'متوسط', 'قوی', 'بسیار قوی'];
  const tones = ['danger', 'danger', 'warn', 'ok', 'ok'];
  return { score, label: labels[score], tone: tones[score] };
}
