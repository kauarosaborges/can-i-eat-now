import { MODIFIED_MEAL_ID, absoluteWindows, classifyDay, dayContext, effectiveWindow, isInsideWindow } from './fasting.js';
import { buildReminderSchedule, computeDailyGoal, hydrationDayContext, totalWaterMl } from './hydration.js';
import { mealsForDay, scheduledMinutes } from './meals.js';
import { MINUTES_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, addDaysToKey, dateAtMinutes, timeToMinutes, toDateKey } from './time.js';

export const NOTIFICATION_KINDS = ['water', 'mealAllowed', 'windowOpen', 'windowClosing'];
export const MAX_PENDING_NOTIFICATIONS = 60;
export const DEFAULT_HORIZON_HOURS = 96;
export const WINDOW_CLOSING_LEAD_MINUTES = 30;

export function stableNotificationId(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 0x7fffffff) || 1;
}

export function isAsleepAt(profile, date) {
  const wake = timeToMinutes(profile.wakeTime);
  const sleep = timeToMinutes(profile.sleepTime);
  const minute = date.getHours() * 60 + date.getMinutes();
  if (wake === sleep) return false;
  if (sleep > wake) return minute >= sleep || minute < wake;
  return minute >= sleep && minute < wake;
}

export function nextWakeAfter(profile, date) {
  const wake = timeToMinutes(profile.wakeTime);
  const key = toDateKey(date);
  const sameDay = dateAtMinutes(key, wake);
  if (sameDay.getTime() > date.getTime()) return sameDay;
  return dateAtMinutes(addDaysToKey(key, 1), wake);
}

function kindEnabled(state, kind) {
  const kinds = state.notifications && state.notifications.kinds ? state.notifications.kinds : {};
  return kinds[kind] !== false;
}

function waterItems(state, now, until) {
  const items = [];
  const profile = state.profile;
  const goal = computeDailyGoal(profile).goalMl;
  const schedule = buildReminderSchedule({ goalMl: goal, glassMl: profile.glassMl, wakeTime: profile.wakeTime, sleepTime: profile.sleepTime });
  const context = hydrationDayContext(profile, now);
  const days = Math.ceil((until - now.getTime()) / (MINUTES_PER_DAY * MS_PER_MINUTE)) + 1;
  for (let offset = 0; offset <= days; offset += 1) {
    const key = addDaysToKey(context.key, offset);
    const dayLog = state.days[key];
    if (dayLog && totalWaterMl(dayLog.water) >= goal) continue;
    const handled = offset === 0 && dayLog && Number.isFinite(dayLog.lastReminder) ? dayLog.lastReminder : -1;
    for (const minute of schedule.times) {
      if (minute <= handled) continue;
      const at = dateAtMinutes(key, minute);
      items.push({
        id: stableNotificationId(`water:${key}:${minute}`),
        at,
        kind: 'water',
        titleKey: 'notificationPlan.waterTitle',
        bodyKey: 'notificationPlan.waterBody',
        params: { ml: schedule.mlPerReminder },
      });
    }
  }
  return items;
}

function mealItems(state, now, until) {
  const items = [];
  const context = dayContext(state.fasting, state.days, now);
  const days = Math.ceil((until - now.getTime()) / (MINUTES_PER_DAY * MS_PER_MINUTE)) + 1;
  for (let offset = 0; offset <= days; offset += 1) {
    const key = addDaysToKey(context.key, offset);
    const plan = classifyDay(state.fasting, key);
    const dayLog = state.days[key];
    const window = effectiveWindow(plan, dayLog);
    if (!window) continue;
    for (const entry of mealsForDay(state.meals, plan)) {
      if (plan.isFastingDay && !entry.isModified) continue;
      if (dayLog && dayLog.meals && dayLog.meals[entry.id]) continue;
      if (dayLog && dayLog.skips && dayLog.skips[entry.id]) continue;
      if (entry.isModified && dayLog && dayLog.meals && dayLog.meals[MODIFIED_MEAL_ID]) continue;
      const scheduled = scheduledMinutes(entry, dayLog);
      if (!isInsideWindow(window, scheduled)) continue;
      items.push({
        id: stableNotificationId(`meal:${key}:${entry.id}`),
        at: dateAtMinutes(key, scheduled),
        kind: 'mealAllowed',
        titleKey: 'notificationPlan.mealTitle',
        bodyKey: entry.isModified ? 'notificationPlan.mealModifiedBody' : 'notificationPlan.mealBody',
        params: entry.isModified ? { kcal: entry.kcal } : { name: entry.name },
      });
    }
  }
  return items;
}

function windowItems(state, now, until) {
  const items = [];
  const nowMs = now.getTime();
  const fromKey = addDaysToKey(toDateKey(now), -1);
  const days = Math.ceil((until - nowMs) / (MINUTES_PER_DAY * MS_PER_MINUTE)) + 3;
  const windows = absoluteWindows(state.fasting, state.days, fromKey, days);
  for (const window of windows) {
    if (window.start > nowMs) {
      const start = new Date(window.start);
      const deferred = isAsleepAt(state.profile, start) ? nextWakeAfter(state.profile, start) : start;
      if (deferred.getTime() < window.end) {
        items.push({
          id: stableNotificationId(`open:${window.start}`),
          at: deferred,
          kind: 'windowOpen',
          titleKey: 'notificationPlan.openTitle',
          bodyKey: 'notificationPlan.openBody',
          params: { hours: Math.round((window.end - window.start) / MS_PER_HOUR) },
        });
      }
    }
    const closingAt = window.end - WINDOW_CLOSING_LEAD_MINUTES * MS_PER_MINUTE;
    if (closingAt > window.start && closingAt > nowMs) {
      items.push({
        id: stableNotificationId(`closing:${window.end}`),
        at: new Date(closingAt),
        kind: 'windowClosing',
        titleKey: 'notificationPlan.closingTitle',
        bodyKey: 'notificationPlan.closingBody',
        params: { minutes: WINDOW_CLOSING_LEAD_MINUTES },
      });
    }
  }
  return items;
}

export function buildNotificationPlan(state, now, horizonHours = DEFAULT_HORIZON_HOURS) {
  if (!state.notifications || state.notifications.enabled !== true) return [];
  const nowMs = now.getTime();
  const until = nowMs + horizonHours * MS_PER_HOUR;
  const builders = { water: waterItems, mealAllowed: mealItems, windowOpen: windowItems, windowClosing: windowItems };
  const collected = new Map();
  for (const kind of NOTIFICATION_KINDS) {
    if (!kindEnabled(state, kind)) continue;
    for (const item of builders[kind](state, now, until)) {
      if (item.kind !== kind) continue;
      if (item.at.getTime() <= nowMs || item.at.getTime() > until) continue;
      if (item.kind !== 'water' && item.kind !== 'windowOpen' && isAsleepAt(state.profile, item.at)) continue;
      collected.set(item.id, item);
    }
  }
  return [...collected.values()]
    .sort((left, right) => left.at.getTime() - right.at.getTime() || left.id - right.id)
    .slice(0, MAX_PENDING_NOTIFICATIONS);
}
