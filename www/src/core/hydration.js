import { cloneDayLog } from './meals.js';
import { MINUTES_PER_DAY, addDaysToKey, clamp, minutesOfDay, timeToMinutes, toDateKey } from './time.js';

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'intense'];
export const ACTIVITY_MULTIPLIERS = { sedentary: 1, light: 1.05, moderate: 1.1, intense: 1.15 };
export const EXERCISE_ML_PER_HOUR = 500;
export const HOT_CLIMATE_EXTRA_ML = 500;
export const MIN_DAILY_GOAL_ML = 1500;
export const MAX_DAILY_GOAL_ML = 5000;
export const GOAL_ROUNDING_ML = 50;
export const MIN_REMINDER_INTERVAL = 60;
export const MAX_REMINDER_INTERVAL = 90;
export const REMINDER_DUE_WINDOW_MINUTES = 30;
export const QUICK_AMOUNTS_ML = [150, 250, 500];
export const QUIET_BEFORE_SLEEP_MINUTES = 30;
export const CUSTOM_WATER_LIMITS = { min: 50, max: 2000 };

export function baseMlPerKgForAge(age) {
  if (age > 55) return 30;
  if (age < 30) return 40;
  return 35;
}

export function exerciseExtraMl(exerciseMinutes) {
  return (Math.max(0, exerciseMinutes) / 60) * EXERCISE_ML_PER_HOUR;
}

export function activityMultiplier(level) {
  return ACTIVITY_MULTIPLIERS[level] || 1;
}

export function climateExtraMl(hotClimate) {
  return hotClimate ? HOT_CLIMATE_EXTRA_ML : 0;
}

export function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

export function computeDailyGoal(profile) {
  const mlPerKg = baseMlPerKgForAge(profile.age);
  const baseMl = profile.weightKg * mlPerKg;
  const multiplier = activityMultiplier(profile.activity);
  const activityBonusMl = baseMl * (multiplier - 1);
  const exerciseMl = exerciseExtraMl(profile.exerciseMinutes);
  const climateMl = climateExtraMl(profile.hotClimate);
  const rawMl = baseMl + activityBonusMl + exerciseMl + climateMl;
  const goalMl = roundToStep(clamp(rawMl, MIN_DAILY_GOAL_ML, MAX_DAILY_GOAL_ML), GOAL_ROUNDING_ML);
  return {
    goalMl,
    breakdown: {
      mlPerKg,
      baseMl: Math.round(baseMl),
      activityBonusMl: Math.round(activityBonusMl),
      exerciseMl: Math.round(exerciseMl),
      climateMl,
      rawMl: Math.round(rawMl),
      clamped: rawMl < MIN_DAILY_GOAL_ML || rawMl > MAX_DAILY_GOAL_ML,
    },
  };
}

export function awakeSpan(wakeTime, sleepTime) {
  const wake = timeToMinutes(wakeTime);
  let sleep = timeToMinutes(sleepTime);
  if (sleep <= wake) sleep += MINUTES_PER_DAY;
  return { wake, sleep, minutes: sleep - wake };
}

export function buildReminderSchedule({ goalMl, glassMl, wakeTime, sleepTime, wakeMinute }) {
  const planned = awakeSpan(wakeTime, sleepTime);
  const wake = Number.isFinite(wakeMinute) ? Math.min(Math.max(wakeMinute, planned.wake - MINUTES_PER_DAY / 2), planned.sleep - QUIET_BEFORE_SLEEP_MINUTES) : planned.wake;
  const span = { wake, sleep: planned.sleep, minutes: Math.max(0, planned.sleep - wake) };
  const lastAllowed = span.sleep - QUIET_BEFORE_SLEEP_MINUTES;
  const glasses = Math.max(1, Math.ceil(goalMl / glassMl));
  const idealInterval = span.minutes / glasses;
  const intervalMinutes = Math.round(clamp(idealInterval, MIN_REMINDER_INTERVAL, MAX_REMINDER_INTERVAL));
  const times = [];
  for (let at = span.wake + intervalMinutes; at <= lastAllowed; at += intervalMinutes) times.push(at);
  const count = Math.max(1, times.length);
  return {
    intervalMinutes,
    times,
    glasses,
    mlPerReminder: Math.max(GOAL_ROUNDING_ML, roundToStep(goalMl / count, GOAL_ROUNDING_ML)),
  };
}

export function hydrationDayContext(profile, now) {
  const wake = timeToMinutes(profile.wakeTime);
  const sleep = timeToMinutes(profile.sleepTime);
  const minute = minutesOfDay(now);
  const key = toDateKey(now);
  if (sleep < wake && minute < sleep) return { key: addDaysToKey(key, -1), minute: minute + MINUTES_PER_DAY };
  return { key, minute };
}

export function nextReminderMinute(times, minute) {
  const upcoming = times.filter((at) => at > minute).sort((left, right) => left - right);
  return upcoming.length > 0 ? upcoming[0] : null;
}

export function dueReminder(times, minute, lastHandled) {
  const due = times
    .filter((at) => at <= minute && at > lastHandled && minute - at <= REMINDER_DUE_WINDOW_MINUTES)
    .sort((left, right) => right - left);
  return due.length > 0 ? due[0] : null;
}

export function validateWaterAmount(value) {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (text === '' || !/^\d+$/.test(text)) return { ok: false, error: 'invalid' };
  const amount = Number(text);
  if (amount < CUSTOM_WATER_LIMITS.min) return { ok: false, error: 'tooSmall' };
  if (amount > CUSTOM_WATER_LIMITS.max) return { ok: false, error: 'tooLarge' };
  return { ok: true, value: amount };
}

export function createWaterEntryId(at) {
  return `w-${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function addWaterEntry(dayLog, entry) {
  const next = cloneDayLog(dayLog);
  next.water.push({ ...entry });
  return next;
}

export function removeWaterEntry(dayLog, id) {
  const next = cloneDayLog(dayLog);
  const index = next.water.findIndex((entry) => entry.id === id);
  if (index === -1) return { ok: false, dayLog: next };
  next.water.splice(index, 1);
  return { ok: true, dayLog: next };
}

export function totalWaterMl(entries) {
  return (entries || []).reduce((sum, entry) => sum + (Number.isFinite(entry.ml) ? entry.ml : 0), 0);
}

export function hydrationRatio(totalMl, goalMl) {
  if (goalMl <= 0) return 0;
  return clamp(totalMl / goalMl, 0, 1);
}
