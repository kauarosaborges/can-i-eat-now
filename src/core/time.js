export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_DAY = 86400000;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampNumber(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export function clampInteger(value, min, max, fallback) {
  const parsed = clampNumber(value, min, max, fallback);
  return Math.round(parsed);
}

export function isValidTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function sanitizeTime(value, fallback) {
  return isValidTime(value) ? value : fallback;
}

export function timeToMinutes(value) {
  const match = TIME_PATTERN.exec(value);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes) {
  const normalized = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isValidDateKey(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function dayNumber(dateKey) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return NaN;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY);
}

export function daysBetween(fromKey, toKey) {
  return dayNumber(toKey) - dayNumber(fromKey);
}

export function addDaysToKey(dateKey, amount) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount));
  return `${probe.getUTCFullYear()}-${pad2(probe.getUTCMonth() + 1)}-${pad2(probe.getUTCDate())}`;
}

export function weekdayOfKey(dateKey) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

export function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function dateAtMinutes(dateKey, minutes) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, whole, seconds, 0);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function splitDuration(ms) {
  const safe = Math.max(0, ms);
  const totalMinutes = Math.floor(safe / MS_PER_MINUTE);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    seconds: Math.floor((safe % MS_PER_MINUTE) / 1000),
  };
}
