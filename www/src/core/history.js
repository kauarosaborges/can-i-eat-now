import { classifyDay, targetFastingHours } from './fasting.js';
import { totalWaterMl } from './hydration.js';
import { MS_PER_HOUR, MS_PER_MINUTE, addDaysToKey, dateAtMinutes, toDateKey } from './time.js';

export const HISTORY_DAYS = 14;
export const MEAL_DURATION_MINUTES = 30;
export const ON_TRACK_TOLERANCE_HOURS = 0.5;

function roundTenth(value) {
  return Math.round(value * 10) / 10;
}

function mealTimes(dayLog) {
  const meals = dayLog && dayLog.meals ? Object.values(dayLog.meals) : [];
  return meals.map((meal) => meal.eatenAt).filter((at) => Number.isFinite(at)).sort((left, right) => left - right);
}

function snackTimes(dayLog) {
  const snacks = dayLog && Array.isArray(dayLog.snacks) ? dayLog.snacks : [];
  return snacks.map((snack) => snack.at).filter((at) => Number.isFinite(at));
}

export function eatingIntervals(days) {
  const intervals = [];
  const duration = MEAL_DURATION_MINUTES * MS_PER_MINUTE;
  for (const key of Object.keys(days)) {
    const times = mealTimes(days[key]);
    if (times.length > 0) intervals.push({ start: times[0], end: times[times.length - 1] + duration });
    for (const at of snackTimes(days[key])) intervals.push({ start: at, end: at + duration });
  }
  return intervals;
}

function overlapMs(intervals, start, end) {
  const clipped = intervals
    .map((interval) => ({ start: Math.max(start, interval.start), end: Math.min(end, interval.end) }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let cursor = start;
  for (const interval of clipped) {
    const from = Math.max(cursor, interval.start);
    if (interval.end > from) total += interval.end - from;
    cursor = Math.max(cursor, interval.end);
  }
  return total;
}

export function dayFastingHours(state, dateKey, now) {
  const dayStart = dateAtMinutes(dateKey, 0).getTime();
  const fullEnd = dateAtMinutes(addDaysToKey(dateKey, 1), 0).getTime();
  const isToday = dateKey === toDateKey(now);
  const dayEnd = isToday ? Math.min(fullEnd, now.getTime()) : fullEnd;
  const allMeals = Object.values(state.days).flatMap((dayLog) => [...mealTimes(dayLog), ...snackTimes(dayLog)]);
  const mealsCount = allMeals.filter((at) => at >= dayStart && at < dayEnd).length;
  const plan = classifyDay(state.fasting, dateKey);
  const spanMs = Math.max(0, dayEnd - dayStart);
  const eatingMs = overlapMs(eatingIntervals(state.days), dayStart, dayEnd);
  if (eatingMs === 0 && mealsCount === 0 && !plan.isFastingDay && !isToday) {
    return { hours: null, mealsCount: 0, hasData: false };
  }
  return { hours: roundTenth((spanMs - eatingMs) / MS_PER_HOUR), mealsCount, hasData: true };
}

export function isDayOnTrack(state, dateKey, summary) {
  const plan = classifyDay(state.fasting, dateKey);
  if (state.fasting.mode === 'intermittent') {
    const target = targetFastingHours(state.fasting);
    return summary.hours !== null && summary.hasData && summary.hours < 24 && summary.hours >= target - ON_TRACK_TOLERANCE_HOURS;
  }
  if (plan.isFastingDay && plan.fastingType === 'modified') return summary.mealsCount <= 1;
  if (plan.isFastingDay) return summary.mealsCount === 0;
  return summary.mealsCount > 0;
}

export function computeStreak(entries) {
  let streak = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.onTrack) {
      streak += 1;
      continue;
    }
    if (entry.isToday) continue;
    break;
  }
  return streak;
}

export function buildHistory(state, now, count = HISTORY_DAYS) {
  const todayKey = toDateKey(now);
  const entries = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const key = addDaysToKey(todayKey, -offset);
    const summary = dayFastingHours(state, key, now);
    const plan = classifyDay(state.fasting, key);
    entries.push({
      key,
      isToday: key === todayKey,
      hours: summary.hours,
      mealsCount: summary.mealsCount,
      hasData: summary.hasData,
      isFastingDay: plan.isFastingDay,
      waterMl: totalWaterMl(state.days[key] ? state.days[key].water : []),
      onTrack: isDayOnTrack(state, key, summary),
    });
  }
  const withData = entries.filter((entry) => entry.hours !== null && !entry.isToday);
  const averageHours = withData.length > 0 ? roundTenth(withData.reduce((sum, entry) => sum + entry.hours, 0) / withData.length) : null;
  return { entries, streak: computeStreak(entries), averageHours };
}
