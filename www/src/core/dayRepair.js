import { classifyDay } from './fasting.js';
import { cloneDayLog, mealsForDay } from './meals.js';
import { actualWakeMinute, isAsleepAt } from './sleep.js';
import { dateAtMinutes, timeToMinutes, toDateKey } from './time.js';

export function wakeMinuteFor(state, dateKey) {
  const actual = actualWakeMinute(state, dateKey);
  return actual === null ? timeToMinutes(state.profile.wakeTime) : actual;
}

export function isSleepMinute(state, dateKey, minute) {
  return isAsleepAt(state.profile, dateAtMinutes(dateKey, minute));
}

export function mealMinuteProblem(state, dateKey, plan, minute, { allowOutsideWindow = false } = {}) {
  if (isSleepMinute(state, dateKey, minute)) return 'sleep';
  if (minute < wakeMinuteFor(state, dateKey) && !(plan.window && plan.window.end > 1440 && minute >= 1440)) return 'beforeWake';
  if (allowOutsideWindow || !plan.window) return null;
  const tolerance = state.fasting.toleranceMinutes;
  if (minute < plan.window.start - tolerance || minute > plan.window.end + tolerance) return 'outsideWindow';
  return null;
}

export function isReasonableMealMinute(state, dateKey, plan, minute, options = {}) {
  return mealMinuteProblem(state, dateKey, plan, minute, options) === null;
}

export function repairDayLog(state, dateKey, dayLog) {
  const plan = classifyDay(state.fasting, dateKey);
  const next = cloneDayLog(dayLog);
  const known = new Set(mealsForDay(state.meals, plan).map((entry) => entry.id));
  const dropped = [];
  for (const [id, minute] of Object.entries(next.adjustments)) {
    if (!known.has(id) || !isReasonableMealMinute(state, dateKey, plan, minute)) {
      delete next.adjustments[id];
      dropped.push(id);
    }
  }
  for (const [id, minute] of Object.entries(next.manualTimes)) {
    if (!known.has(id) || !isReasonableMealMinute(state, dateKey, plan, minute, { allowOutsideWindow: true })) {
      delete next.manualTimes[id];
      dropped.push(id);
    }
  }
  if (next.windowShift !== 0 && plan.window) {
    const start = plan.window.start + next.windowShift;
    const tooFar = -next.windowShift > state.fasting.toleranceMinutes;
    if (tooFar || isSleepMinute(state, dateKey, start) || start < wakeMinuteFor(state, dateKey)) {
      next.windowShift = 0;
      dropped.push('windowShift');
    }
  }
  return { dayLog: next, dropped };
}

export function repairDayPlans(state, now) {
  const todayKey = toDateKey(now);
  const days = {};
  let changed = false;
  for (const [key, dayLog] of Object.entries(state.days || {})) {
    if (key < todayKey) {
      days[key] = dayLog;
      continue;
    }
    const result = repairDayLog(state, key, dayLog);
    days[key] = result.dayLog;
    if (result.dropped.length > 0) changed = true;
  }
  return changed ? { ...state, days } : state;
}

export function earliestMealMinute(state, dateKey) {
  return wakeMinuteFor(state, dateKey);
}
