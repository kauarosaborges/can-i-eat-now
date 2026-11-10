import {
  MINUTES_PER_DAY,
  MS_PER_HOUR,
  addDaysToKey,
  dateAtMinutes,
  dayNumber,
  minutesOfDay,
  timeToMinutes,
  toDateKey,
  weekdayOfKey,
} from './time.js';

export const FASTING_MODES = ['intermittent', 'weekdays', 'alternate'];
export const FASTING_DAY_TYPES = ['zero', 'modified'];

export const INTERMITTENT_PRESETS = [
  { id: '16:8', eatingHours: 8 },
  { id: '18:6', eatingHours: 6 },
  { id: '20:4', eatingHours: 4 },
  { id: 'omad', eatingHours: 1 },
  { id: 'custom', eatingHours: null },
];

export const FASTING_STAGES = [
  { hours: 12, key: 'glycogenLow' },
  { hours: 16, key: 'ketosisLight' },
  { hours: 18, key: 'fatBurn' },
  { hours: 24, key: 'autophagy' },
];

export const MODIFIED_MEAL_ID = 'modifiedMeal';
export const MODIFIED_WINDOW_MINUTES = 60;
export const LOOKAROUND_DAYS = 8;

export function presetEatingHours(presetId, customHours) {
  const preset = INTERMITTENT_PRESETS.find((item) => item.id === presetId);
  if (preset && preset.eatingHours !== null) return preset.eatingHours;
  return customHours;
}

export function isAlternateFastingDay(cycleStartKey, dateKey) {
  const diff = dayNumber(dateKey) - dayNumber(cycleStartKey);
  if (diff < 0) return false;
  return diff % 2 === 1;
}

export function classifyDay(fasting, dateKey) {
  const base = { dateKey, isFastingDay: false, fastingType: null, window: null, modifiedMeal: null };
  if (fasting.mode === 'intermittent') {
    const hours = presetEatingHours(fasting.intermittent.preset, fasting.intermittent.eatingHours);
    const start = timeToMinutes(fasting.intermittent.windowStart);
    return { ...base, window: { start, end: start + hours * 60 } };
  }
  if (fasting.mode === 'weekdays') {
    const isFasting = fasting.weekdays.fastingDays.includes(weekdayOfKey(dateKey));
    if (isFasting) return { ...base, isFastingDay: true, fastingType: 'zero' };
    return { ...base, window: { start: 0, end: MINUTES_PER_DAY } };
  }
  if (fasting.mode === 'alternate') {
    if (!isAlternateFastingDay(fasting.alternate.cycleStart, dateKey)) {
      return { ...base, window: { start: 0, end: MINUTES_PER_DAY } };
    }
    if (fasting.alternate.fastingDayType === 'modified') {
      const start = timeToMinutes(fasting.alternate.modifiedMealTime);
      return {
        ...base,
        isFastingDay: true,
        fastingType: 'modified',
        window: { start, end: start + MODIFIED_WINDOW_MINUTES },
        modifiedMeal: { minutes: start, kcal: fasting.alternate.modifiedMealKcal },
      };
    }
    return { ...base, isFastingDay: true, fastingType: 'zero' };
  }
  return base;
}

export function effectiveWindow(plan, dayLog) {
  if (!plan.window) return null;
  const shift = dayLog && Number.isFinite(dayLog.windowShift) ? dayLog.windowShift : 0;
  return { start: plan.window.start + shift, end: plan.window.end + shift };
}

export function isInsideWindow(window, minute) {
  return Boolean(window) && minute >= window.start && minute < window.end;
}

export function dayContext(fasting, days, now) {
  const todayKey = toDateKey(now);
  const minute = minutesOfDay(now);
  const todayPlan = classifyDay(fasting, todayKey);
  const previousKey = addDaysToKey(todayKey, -1);
  const previousPlan = classifyDay(fasting, previousKey);
  const previousWindow = effectiveWindow(previousPlan, days[previousKey]);
  const shifted = minute + MINUTES_PER_DAY;
  if (previousWindow && previousWindow.end > MINUTES_PER_DAY) {
    if (shifted < previousWindow.end) return { key: previousKey, plan: previousPlan, minute: shifted };
    const todayWindow = effectiveWindow(todayPlan, days[todayKey]);
    const todayClaims = todayWindow && minute >= todayWindow.start - fasting.toleranceMinutes;
    if (shifted < previousWindow.end + fasting.toleranceMinutes && !todayClaims) {
      return { key: previousKey, plan: previousPlan, minute: shifted };
    }
  }
  return { key: todayKey, plan: todayPlan, minute };
}

export function checkEatAt(plan, dayLog, minute, toleranceMinutes) {
  if (!plan.window) return { allowed: false, reason: 'fastingDay' };
  if (plan.fastingType === 'modified' && dayLog && dayLog.meals && dayLog.meals[MODIFIED_MEAL_ID]) {
    return { allowed: false, reason: 'modifiedUsed' };
  }
  const current = effectiveWindow(plan, dayLog);
  const currentShift = current.start - plan.window.start;
  if (isInsideWindow(current, minute)) return { allowed: true, kind: 'inside', windowShift: currentShift };
  if (minute < current.start) {
    const earliest = plan.window.start - toleranceMinutes;
    if (minute >= earliest) {
      return {
        allowed: true,
        kind: 'advance',
        windowShift: Math.min(currentShift, Math.floor(minute) - plan.window.start),
        advanceMinutes: Math.ceil(current.start - minute),
      };
    }
    return { allowed: false, reason: 'tooEarly', minutesUntilAllowed: Math.ceil(earliest - minute) };
  }
  if (minute < current.end + toleranceMinutes) {
    return { allowed: true, kind: 'late', windowShift: currentShift, lateMinutes: Math.ceil(minute - current.end) };
  }
  return { allowed: false, reason: 'tooLate' };
}

function closedWindowFor(plan, dayLog, window) {
  if (plan.fastingType !== 'modified') return window;
  const meal = dayLog && dayLog.meals ? dayLog.meals[MODIFIED_MEAL_ID] : null;
  if (!meal || !Number.isFinite(meal.minute)) return window;
  return { start: window.start, end: Math.max(window.start, Math.min(window.end, meal.minute)) };
}

export function absoluteWindows(fasting, days, fromKey, count) {
  const windows = [];
  for (let index = 0; index < count; index += 1) {
    const key = addDaysToKey(fromKey, index);
    const plan = classifyDay(fasting, key);
    const effective = effectiveWindow(plan, days[key]);
    if (!effective) continue;
    const window = closedWindowFor(plan, days[key], effective);
    if (window.end <= window.start) continue;
    windows.push({
      start: dateAtMinutes(key, window.start).getTime(),
      end: dateAtMinutes(key, window.end).getTime(),
    });
  }
  windows.sort((left, right) => left.start - right.start);
  const merged = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

export function lastMealTimestamp(days, nowMs) {
  let latest = null;
  for (const key of Object.keys(days)) {
    const meals = days[key] && days[key].meals ? days[key].meals : {};
    for (const id of Object.keys(meals)) {
      const at = meals[id].eatenAt;
      if (Number.isFinite(at) && at <= nowMs && (latest === null || at > latest)) latest = at;
    }
    const snacks = days[key] && Array.isArray(days[key].snacks) ? days[key].snacks : [];
    for (const snack of snacks) {
      if (Number.isFinite(snack.at) && snack.at <= nowMs && (latest === null || snack.at > latest)) latest = snack.at;
    }
  }
  return latest;
}

export function fastState(state, now) {
  const nowMs = now.getTime();
  const todayKey = toDateKey(now);
  const windows = absoluteWindows(state.fasting, state.days, addDaysToKey(todayKey, -LOOKAROUND_DAYS), LOOKAROUND_DAYS * 2 + 1);
  const lastMealAt = lastMealTimestamp(state.days, nowMs);
  const current = windows.find((window) => window.start <= nowMs && nowMs < window.end);
  if (current) {
    return {
      phase: 'eating',
      windowStart: current.start,
      windowEnd: current.end,
      lastMealAt,
      startedAt: null,
      targetEnd: null,
    };
  }
  const previous = windows.filter((window) => window.end <= nowMs).pop() || null;
  const next = windows.find((window) => window.start > nowMs) || null;
  let startedAt = null;
  if (previous) {
    startedAt = lastMealAt !== null && lastMealAt >= previous.start ? lastMealAt : previous.end;
  } else if (lastMealAt !== null) {
    startedAt = lastMealAt;
  }
  return {
    phase: 'fasting',
    windowStart: null,
    windowEnd: null,
    lastMealAt,
    startedAt,
    targetEnd: next ? next.start : null,
  };
}

export function fastProgress(fast, now) {
  const nowMs = now.getTime();
  if (fast.phase !== 'fasting' || fast.startedAt === null) {
    return { elapsedMs: 0, remainingMs: 0, targetMs: 0, ratio: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - fast.startedAt);
  const targetMs = fast.targetEnd !== null ? Math.max(0, fast.targetEnd - fast.startedAt) : 24 * MS_PER_HOUR;
  const remainingMs = fast.targetEnd !== null ? Math.max(0, fast.targetEnd - nowMs) : 0;
  const ratio = targetMs > 0 ? Math.min(1, elapsedMs / targetMs) : 0;
  return { elapsedMs, remainingMs, targetMs, ratio };
}

export function currentStage(hoursFasted) {
  let stage = null;
  for (const item of FASTING_STAGES) {
    if (hoursFasted >= item.hours) stage = item;
  }
  return stage;
}

export function nextStage(hoursFasted) {
  return FASTING_STAGES.find((item) => item.hours > hoursFasted) || null;
}

export function targetFastingHours(fasting) {
  if (fasting.mode !== 'intermittent') return null;
  return 24 - presetEatingHours(fasting.intermittent.preset, fasting.intermittent.eatingHours);
}

export function windowCrossesMidnight(window) {
  return Boolean(window) && window.end > MINUTES_PER_DAY;
}
