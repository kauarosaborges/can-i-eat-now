import { MODIFIED_MEAL_ID, checkEatAt, classifyDay, effectiveWindow, isInsideWindow } from './fasting.js';
import { MINUTES_PER_DAY, minutesOfDay, timeToMinutes } from './time.js';

export const SOON_THRESHOLD_MINUTES = 30;
export const MAX_MEALS = 8;
export const MAX_MEAL_NAME_LENGTH = 30;

export function emptyDayLog() {
  return { windowShift: 0, meals: {}, skips: {}, adjustments: {}, water: [], snacks: [], lastReminder: -1 };
}

export function cloneDayLog(dayLog) {
  const source = dayLog || emptyDayLog();
  return {
    windowShift: Number.isFinite(source.windowShift) ? source.windowShift : 0,
    meals: Object.fromEntries(Object.entries(source.meals || {}).map(([id, value]) => [id, { ...value }])),
    skips: { ...(source.skips || {}) },
    adjustments: { ...(source.adjustments || {}) },
    water: (source.water || []).map((entry) => ({ ...entry })),
    snacks: (source.snacks || []).map((entry) => ({ ...entry })),
    lastReminder: Number.isFinite(source.lastReminder) ? source.lastReminder : -1,
  };
}

export function placeInWindow(minutes, window) {
  if (window && window.end > MINUTES_PER_DAY && minutes < window.start && minutes + MINUTES_PER_DAY < window.end) {
    return minutes + MINUTES_PER_DAY;
  }
  return minutes;
}

export function mealsForDay(meals, plan) {
  const regular = meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    plannedMinutes: placeInWindow(timeToMinutes(meal.time), plan.isFastingDay ? null : plan.window),
    isModified: false,
  }));
  if (plan.fastingType === 'modified' && plan.modifiedMeal) {
    return [
      { id: MODIFIED_MEAL_ID, name: null, plannedMinutes: plan.modifiedMeal.minutes, isModified: true, kcal: plan.modifiedMeal.kcal },
      ...regular,
    ];
  }
  return regular;
}

export function scheduledMinutes(entry, dayLog) {
  const adjusted = dayLog && dayLog.adjustments ? dayLog.adjustments[entry.id] : undefined;
  return Number.isFinite(adjusted) ? adjusted : entry.plannedMinutes;
}

function isBlockedByFastingDay(entry, plan) {
  if (!plan.isFastingDay) return false;
  return !(plan.fastingType === 'modified' && entry.isModified);
}

function byScheduled(dayLog) {
  return (left, right) => scheduledMinutes(left, dayLog) - scheduledMinutes(right, dayLog);
}

export function buildTimeline(meals, plan, dayLog, minute, toleranceMinutes) {
  const log = dayLog || emptyDayLog();
  const window = effectiveWindow(plan, log);
  const windowOpen = isInsideWindow(window, minute);
  const eatCheck = checkEatAt(plan, log, minute, toleranceMinutes);
  const entries = mealsForDay(meals, plan).sort(byScheduled(log));
  const timeline = entries.map((entry) => {
    const scheduled = scheduledMinutes(entry, log);
    const item = {
      id: entry.id,
      name: entry.name,
      isModified: entry.isModified,
      kcal: entry.kcal,
      plannedMinutes: entry.plannedMinutes,
      scheduledMinutes: scheduled,
      adjusted: scheduled !== entry.plannedMinutes,
      status: 'upcoming',
      skipReason: null,
      eatenMinutes: null,
      canEatNow: false,
    };
    if (log.meals[entry.id]) {
      item.status = 'done';
      item.eatenMinutes = log.meals[entry.id].minute;
      return item;
    }
    if (log.skips[entry.id]) {
      item.status = 'skipped';
      item.skipReason = log.skips[entry.id];
      return item;
    }
    if (isBlockedByFastingDay(entry, plan)) {
      item.status = 'notAllowed';
      return item;
    }
    item.canEatNow = eatCheck.allowed;
    if (!isInsideWindow(window, scheduled)) {
      item.status = 'notAllowed';
      return item;
    }
    item.status = 'pending';
    return item;
  });

  const lastDone = timeline.filter((item) => item.status === 'done').reduce((latest, item) => Math.max(latest, item.scheduledMinutes), -Infinity);
  const isOverdue = (item) => minute - item.scheduledMinutes > toleranceMinutes;
  for (const item of timeline) {
    if (item.status === 'pending' && item.scheduledMinutes < lastDone && isOverdue(item)) {
      item.status = 'missed';
      item.canEatNow = false;
    }
  }
  const pending = timeline.filter((item) => item.status === 'pending');
  const past = pending.filter((item) => item.scheduledMinutes <= minute);
  const future = pending.filter((item) => item.scheduledMinutes > minute);
  const latestPast = past.reduce((latest, item) => Math.max(latest, item.scheduledMinutes), -Infinity);
  let hasCurrent = false;
  for (const item of past) {
    if (windowOpen && (item.scheduledMinutes === latestPast || !isOverdue(item))) {
      item.status = 'allowedNow';
      hasCurrent = true;
    } else {
      item.status = 'missed';
    }
  }
  const soonest = future.reduce((earliest, item) => Math.min(earliest, item.scheduledMinutes), Infinity);
  for (const item of future) {
    const soon = item.scheduledMinutes - minute <= SOON_THRESHOLD_MINUTES;
    item.status = !hasCurrent && windowOpen && soon && item.scheduledMinutes === soonest ? 'allowedNow' : 'upcoming';
  }
  return timeline;
}

export function nextMeal(timeline) {
  return timeline.find((item) => item.status === 'allowedNow' || item.status === 'upcoming') || null;
}

export function eatMealNow({ meals, plan, dayLog, mealId, now, minute: contextMinute, toleranceMinutes, minGapMinutes }) {
  const log = dayLog || emptyDayLog();
  const minute = Math.floor(Number.isFinite(contextMinute) ? contextMinute : minutesOfDay(now));
  const entries = mealsForDay(meals, plan).sort(byScheduled(log));
  const target = entries.find((entry) => entry.id === mealId);
  if (!target) return { ok: false, reason: 'unknownMeal' };
  if (log.meals[mealId]) return { ok: false, reason: 'alreadyDone' };
  if (isBlockedByFastingDay(target, plan)) return { ok: false, reason: 'fastingDay' };
  const check = checkEatAt(plan, log, minute, toleranceMinutes);
  if (!check.allowed) return { ok: false, reason: check.reason, minutesUntilAllowed: check.minutesUntilAllowed };

  const previousWindow = effectiveWindow(plan, log);
  const next = cloneDayLog(log);
  next.windowShift = check.windowShift;
  const targetScheduled = scheduledMinutes(target, log);
  const delta = minute - targetScheduled;
  const eatenAt = now.getTime();
  next.meals[mealId] = { eatenAt, minute };
  const undo = {
    mealId,
    eatenAt,
    previousWindowShift: log.windowShift || 0,
    appliedWindowShift: next.windowShift,
    adjustments: {},
    skips: { [mealId]: log.skips[mealId] || null },
  };
  delete next.skips[mealId];

  const window = effectiveWindow(plan, next);
  const followers = entries.filter((entry) => {
    if (entry.id === mealId) return false;
    if (log.meals[entry.id] || log.skips[entry.id]) return false;
    if (isBlockedByFastingDay(entry, plan)) return false;
    const scheduled = scheduledMinutes(entry, log);
    return scheduled > targetScheduled && isInsideWindow(previousWindow, scheduled);
  });

  const adjustments = [];
  const skipped = [];
  let previous = minute;
  for (const entry of followers) {
    const from = scheduledMinutes(entry, log);
    const candidate = Math.max(from + delta, previous + minGapMinutes);
    if (candidate >= window.end) {
      undo.skips[entry.id] = log.skips[entry.id] || null;
      undo.adjustments[entry.id] = Number.isFinite(log.adjustments[entry.id]) ? log.adjustments[entry.id] : null;
      next.skips[entry.id] = 'noFit';
      delete next.adjustments[entry.id];
      skipped.push({ id: entry.id, name: entry.name, from });
      continue;
    }
    if (candidate !== from) {
      undo.adjustments[entry.id] = Number.isFinite(log.adjustments[entry.id]) ? log.adjustments[entry.id] : null;
      next.adjustments[entry.id] = candidate;
      adjustments.push({ id: entry.id, name: entry.name, from, to: candidate });
    }
    previous = candidate;
  }

  return {
    ok: true,
    dayLog: next,
    undo,
    kind: check.kind,
    advanceMinutes: check.advanceMinutes || 0,
    lateMinutes: check.lateMinutes || 0,
    delta,
    adjustments,
    skipped,
  };
}

function restoreKeys(target, previous) {
  for (const [id, value] of Object.entries(previous)) {
    if (value === null) delete target[id];
    else target[id] = value;
  }
}

export function undoEatMeal(dayLog, undo) {
  const next = cloneDayLog(dayLog);
  const entry = next.meals[undo.mealId];
  if (!entry || entry.eatenAt !== undo.eatenAt) return { ok: false, dayLog: next };
  delete next.meals[undo.mealId];
  if (next.windowShift === undo.appliedWindowShift) next.windowShift = undo.previousWindowShift;
  restoreKeys(next.adjustments, undo.adjustments);
  restoreKeys(next.skips, undo.skips);
  return { ok: true, dayLog: next };
}

export function skipMeal(dayLog, mealId) {
  const next = cloneDayLog(dayLog);
  next.skips[mealId] = 'user';
  return next;
}

export function undoSkipMeal(dayLog, mealId) {
  const next = cloneDayLog(dayLog);
  if (next.skips[mealId] !== 'user') return { ok: false, dayLog: next };
  delete next.skips[mealId];
  return { ok: true, dayLog: next };
}

export function resetDayPlan(dayLog) {
  const next = cloneDayLog(dayLog);
  next.windowShift = 0;
  next.adjustments = {};
  for (const [id, reason] of Object.entries(next.skips)) {
    if (reason === 'noFit') delete next.skips[id];
  }
  return next;
}

export function mealsOutsideWindow(meals, fasting, dateKey) {
  if (fasting.mode !== 'intermittent') return [];
  const plan = classifyDay(fasting, dateKey);
  return mealsForDay(meals, plan)
    .filter((entry) => !isInsideWindow(plan.window, entry.plannedMinutes))
    .map((entry) => entry.id);
}

export function sanitizeMealName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const characters = Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim());
  const cleaned = characters.slice(0, MAX_MEAL_NAME_LENGTH).join('').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function createSnackId(at) {
  return `s-${Math.round(at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function logSnack(dayLog, now, minute) {
  const next = cloneDayLog(dayLog);
  const at = now.getTime();
  const snack = { id: createSnackId(at), at, minute: Math.floor(Number.isFinite(minute) ? minute : minutesOfDay(now)) };
  next.snacks.push(snack);
  return { dayLog: next, snack };
}

export function removeSnack(dayLog, id) {
  const next = cloneDayLog(dayLog);
  const index = next.snacks.findIndex((snack) => snack.id === id);
  if (index === -1) return { ok: false, dayLog: next };
  next.snacks.splice(index, 1);
  return { ok: true, dayLog: next };
}

export function eatMealKeepSchedule({ meals, plan, dayLog, mealId, now, minute: contextMinute }) {
  const log = dayLog || emptyDayLog();
  const minute = Math.floor(Number.isFinite(contextMinute) ? contextMinute : minutesOfDay(now));
  const target = mealsForDay(meals, plan).find((entry) => entry.id === mealId);
  if (!target) return { ok: false, reason: 'unknownMeal' };
  if (log.meals[mealId]) return { ok: false, reason: 'alreadyDone' };
  if (isBlockedByFastingDay(target, plan)) return { ok: false, reason: 'fastingDay' };
  const next = cloneDayLog(log);
  const eatenAt = now.getTime();
  next.meals[mealId] = { eatenAt, minute };
  delete next.skips[mealId];
  return {
    ok: true,
    dayLog: next,
    undo: { mealId, eatenAt, previousWindowShift: log.windowShift || 0, appliedWindowShift: next.windowShift, adjustments: {}, skips: { [mealId]: log.skips[mealId] || null } },
  };
}

export function planChanges(result) {
  if (!result || !result.ok) return false;
  return result.adjustments.length > 0 || result.skipped.length > 0 || result.kind === 'advance';
}

export function eatingChoices({ meals, plan, dayLog, minute, toleranceMinutes, now, lastEatingAt, minGapMinutes }) {
  const log = dayLog || emptyDayLog();
  const check = checkEatAt(plan, log, minute, toleranceMinutes);
  const timeline = buildTimeline(meals, plan, log, minute, toleranceMinutes);
  const eligible = check.allowed
    ? timeline.filter((item) => ['allowedNow', 'upcoming', 'missed'].includes(item.status) && item.canEatNow)
    : [];
  const choices = eligible.map((item) => ({
    mealId: item.id,
    name: item.name,
    isModified: item.isModified,
    kcal: item.kcal,
    scheduledMinutes: item.scheduledMinutes,
    kind: item.scheduledMinutes > minute ? 'advance' : 'onTime',
  }));
  const recommended = choices.find((choice) => choice.kind === 'onTime' && minute - choice.scheduledMinutes <= toleranceMinutes)
    || choices.find((choice) => choice.kind === 'advance')
    || null;
  const nowMs = now instanceof Date ? now.getTime() : null;
  const recentMinutes = nowMs !== null && Number.isFinite(lastEatingAt) && Number.isFinite(minGapMinutes) && nowMs - lastEatingAt < minGapMinutes * 60000
    ? Math.max(0, Math.floor((nowMs - lastEatingAt) / 60000))
    : null;
  return { choices, recommendedMealId: recommended ? recommended.mealId : null, recentMinutes };
}

export function proposalSignature(result) {
  if (!result || !result.ok) return JSON.stringify({ ok: false, reason: result ? result.reason : null });
  return JSON.stringify({
    kind: result.kind,
    windowShift: result.dayLog.windowShift,
    adjustments: result.adjustments.map((item) => [item.id, item.from, item.to]),
    skipped: result.skipped.map((item) => item.id),
  });
}
