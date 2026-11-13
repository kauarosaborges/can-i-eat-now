import { MS_PER_DAY, timeToMinutes } from './time.js';
import { monthKeyOf } from './measurementReport.js';

export const REMINDER_DAY_LIMITS = { min: 1, max: 31 };
export const REMINDER_GRACE_DAYS = 7;
export const DEFAULT_REMINDER = { enabled: true, day: 1, time: '07:00', dismissedMonth: null };

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function occurrenceIn(year, monthIndex, reminder) {
  const day = Math.min(Math.max(1, reminder.day), daysInMonth(year, monthIndex));
  const minutes = timeToMinutes(reminder.time);
  return new Date(year, monthIndex, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

export function currentOccurrence(reminder, now) {
  return occurrenceIn(now.getFullYear(), now.getMonth(), reminder);
}

export function nextOccurrence(reminder, now) {
  const current = currentOccurrence(reminder, now);
  if (current.getTime() > now.getTime()) return current;
  return occurrenceIn(now.getFullYear(), now.getMonth() + 1, reminder);
}

function latestSessionAt(sessions) {
  return (sessions || []).reduce((latest, session) => Math.max(latest, session.at), -Infinity);
}

export function measuredAround(sessions, occurrence) {
  return latestSessionAt(sessions) >= occurrence.getTime() - REMINDER_GRACE_DAYS * MS_PER_DAY;
}

export function reminderDue(measurements, now) {
  const reminder = measurements && measurements.reminder;
  if (!reminder || !reminder.enabled) return false;
  if (!measurements.sessions || measurements.sessions.length === 0) return false;
  const occurrence = currentOccurrence(reminder, now);
  if (now.getTime() < occurrence.getTime()) return false;
  if (reminder.dismissedMonth === monthKeyOf(now.getTime())) return false;
  return !measuredAround(measurements.sessions, occurrence);
}

export function reminderNotificationAt(measurements, now) {
  const reminder = measurements && measurements.reminder;
  if (!reminder || !reminder.enabled || !measurements.sessions || measurements.sessions.length === 0) return null;
  let next = nextOccurrence(reminder, now);
  if (measuredAround(measurements.sessions, next) || reminder.dismissedMonth === monthKeyOf(next.getTime())) {
    next = occurrenceIn(next.getFullYear(), next.getMonth() + 1, reminder);
  }
  return next;
}
