import { LOCALE, t } from '../i18n/index.js';
import { MS_PER_MINUTE, daysBetween, minutesToTime, pad2, splitDuration, weekdayOfKey } from '../core/time.js';

export function formatDuration(ms) {
  const rounded = Math.ceil(Math.max(0, ms) / MS_PER_MINUTE) * MS_PER_MINUTE;
  const { hours, minutes } = splitDuration(rounded);
  if (hours === 0) return t('common.durationMinutes', { m: minutes });
  return t('common.duration', { h: hours, m: pad2(minutes) });
}

export function formatClock(ms) {
  const { hours, minutes, seconds } = splitDuration(ms);
  return t('common.clock', { h: hours, m: pad2(minutes), s: pad2(seconds) });
}

export function formatTimeOfDay(minutes) {
  return minutesToTime(minutes);
}

export function formatTimestamp(ms) {
  const date = new Date(ms);
  return minutesToTime(date.getHours() * 60 + date.getMinutes());
}

export function formatMl(ml) {
  if (ml >= 1000) {
    const liters = (ml / 1000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return t('common.liters', { value: liters });
  }
  return t('common.ml', { value: Math.round(ml) });
}

export function formatDayShort(dateKey) {
  const day = Number(dateKey.slice(8, 10));
  return `${t(`days.short.${weekdayOfKey(dateKey)}`)} ${day}`;
}

export function formatDayLong(dateKey) {
  return t(`days.long.${weekdayOfKey(dateKey)}`);
}

export function formatDateHeading(date) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

export function formatPercent(ratio) {
  return t('common.percent', { value: Math.round(ratio * 100) });
}

export function formatHours(value) {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
}

export function formatKg(value, digits = 1) {
  return t('body.kg', { value: value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
}

export function formatNumber(value, digits = 0) {
  return value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatKcal(value) {
  return t('body.kcal', { value: Math.round(value).toLocaleString(LOCALE) });
}

export function formatDateShort(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day));
}

export function formatMinutes(minutes) {
  return formatDuration(Math.max(0, Math.round(minutes)) * MS_PER_MINUTE);
}

export function formatKm(meters) {
  return (meters / 1000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatRelativeDay(key, todayKey) {
  const days = daysBetween(key, todayKey);
  if (days <= 0) return t('summary.today');
  if (days === 1) return t('summary.yesterday');
  return t('summary.daysAgo', { days });
}

export function formatGoal(minutes) {
  const rounded = Math.round(minutes);
  if (rounded > 0 && rounded % 60 === 0) return t('common.hoursOnly', { h: rounded / 60 });
  return formatMinutes(rounded);
}

export function formatList(items) {
  if (typeof Intl !== 'undefined' && typeof Intl.ListFormat === 'function') return new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' }).format(items);
  return items.join(', ');
}
