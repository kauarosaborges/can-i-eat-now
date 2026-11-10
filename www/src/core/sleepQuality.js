import { plannedNight, sleepEntryForDay } from './sleep.js';
import { MINUTES_PER_DAY, MS_PER_MINUTE, addDaysToKey, clamp, timeToMinutes, toDateKey } from './time.js';

export const SCORE_WEIGHTS = { duration: 0.45, regularity: 0.2, interruptions: 0.2, stages: 0.15 };
export const SCORE_THRESHOLDS = { good: 80, fair: 60 };
export const REGULARITY_NIGHTS = 7;
export const MIN_REGULARITY_NIGHTS = 3;
export const HEART_BASELINE_DAYS = 14;
export const MIN_BASELINE_DAYS = 3;
export const MAX_HEART_POINTS = 5;
export const WEAK_FACTOR_BELOW = 85;
export const DEFAULT_GOAL_MINUTES = 480;
export const GOAL_LIMITS = { min: 300, max: 660 };
export const DEEP_TARGET_SHARE = 0.15;
export const REM_TARGET_SHARE = 0.2;
export const ASLEEP_SHARE_OF_GOAL = 0.9;
export const NEAR_GOAL_SHARE = 0.9;
export const FAR_BELOW_SHARE = 0.75;
const NOON = 720;

function round(value) {
  return Math.round(value);
}

function average(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  const mean = average(values);
  if (mean === null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function sleepGoalMinutes(profile) {
  const sleep = timeToMinutes(profile.sleepTime);
  const wake = timeToMinutes(profile.wakeTime);
  if (!Number.isFinite(sleep) || !Number.isFinite(wake) || sleep === wake) return DEFAULT_GOAL_MINUTES;
  return clamp((wake - sleep + MINUTES_PER_DAY) % MINUTES_PER_DAY, GOAL_LIMITS.min, GOAL_LIMITS.max);
}

export function nightBasis(entry) {
  return entry && entry.detail && entry.detail.asleep > 0 ? 'asleep' : 'inBed';
}

export function targetMinutes(entry, goal) {
  return nightBasis(entry) === 'asleep' ? round(goal * ASLEEP_SHARE_OF_GOAL) : goal;
}

export function nightMinutes(entry) {
  if (!entry || entry.kind === 'awake') return 0;
  if (entry.detail && entry.detail.asleep > 0) return entry.detail.asleep;
  return round((entry.wokeAt - entry.sleptAt) / MS_PER_MINUTE);
}

export function nightEntry(state, key) {
  return sleepEntryForDay(state.sleep && state.sleep.log, state.profile, key);
}

export function noonOffset(ms) {
  const date = new Date(ms);
  return (date.getHours() * 60 + date.getMinutes() - NOON + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function offsetToClock(offset) {
  return (round(offset) + NOON) % MINUTES_PER_DAY;
}

export function durationScore(minutes, goal) {
  const ratio = minutes / Math.max(1, goal);
  if (ratio >= 1) return ratio <= 1.3 ? 100 : round(Math.max(70, 100 - (ratio - 1.3) * 100));
  return round(clamp(((ratio - 0.4) / 0.6) * 100, 0, 100));
}

export function interruptionsScore(detail) {
  if (!detail || detail.awakeKnown !== true) return null;
  return round(clamp(100 - Math.max(0, detail.awake - 10) * 1.5 - Math.max(0, detail.awakenings - 2) * 6, 0, 100));
}

export function stagesScore(detail) {
  if (!detail) return null;
  const staged = detail.deep + detail.rem + detail.core;
  if (staged <= 0) return null;
  const deep = Math.min(1, detail.deep / staged / DEEP_TARGET_SHARE);
  const rem = Math.min(1, detail.rem / staged / REM_TARGET_SHARE);
  return round(((deep + rem) / 2) * 100);
}

export function regularityFor(state, key, nights = REGULARITY_NIGHTS) {
  const entries = [];
  for (let offset = 0; offset < nights; offset += 1) {
    const entry = nightEntry(state, addDaysToKey(key, -offset));
    if (entry && entry.kind !== 'awake') entries.push(entry);
  }
  if (entries.length < MIN_REGULARITY_NIGHTS) return null;
  const bedSd = stdDev(entries.map((entry) => noonOffset(entry.sleptAt)));
  const wakeSd = stdDev(entries.map((entry) => noonOffset(entry.wokeAt)));
  const spread = (bedSd + wakeSd) / 2;
  return { nights: entries.length, bedSd: round(bedSd), wakeSd: round(wakeSd), spread: round(spread), score: round(clamp(100 - (spread - 15) * (100 / 75), 0, 100)) };
}

function nightVital(state, key, field) {
  const entry = nightEntry(state, key);
  const value = entry && entry.kind !== 'awake' && entry.detail ? entry.detail[field] : null;
  return Number.isFinite(value) ? value : null;
}

function baseline(state, key, field) {
  const values = [];
  for (let offset = 1; offset <= HEART_BASELINE_DAYS; offset += 1) {
    const value = nightVital(state, addDaysToKey(key, -offset), field);
    if (value !== null) values.push(value);
  }
  return values.length >= MIN_BASELINE_DAYS ? average(values) : null;
}

export function heartAdjustment(state, key) {
  const effects = [];
  const hr = nightVital(state, key, 'hr');
  const hrBase = baseline(state, key, 'hr');
  if (hr !== null && hrBase !== null) {
    const diff = hr - hrBase;
    if (diff >= 8) effects.push({ metric: 'hr', points: -3 });
    else if (diff >= 5) effects.push({ metric: 'hr', points: -2 });
    else if (diff <= -3) effects.push({ metric: 'hr', points: 1 });
  }
  const hrv = nightVital(state, key, 'hrv');
  const hrvBase = baseline(state, key, 'hrv');
  if (hrv !== null && hrvBase !== null && hrvBase > 0) {
    const ratio = hrv / hrvBase;
    if (ratio <= 0.8) effects.push({ metric: 'hrv', points: -2 });
    else if (ratio >= 1.15) effects.push({ metric: 'hrv', points: 1 });
  }
  const resp = nightVital(state, key, 'resp');
  const respBase = baseline(state, key, 'resp');
  if (resp !== null && respBase !== null && resp - respBase >= 1.5) effects.push({ metric: 'resp', points: -1 });
  if (effects.length === 0) return null;
  const points = clamp(effects.reduce((sum, effect) => sum + effect.points, 0), -MAX_HEART_POINTS, MAX_HEART_POINTS);
  return { points, effects };
}

export function scoreLabel(score) {
  if (score >= SCORE_THRESHOLDS.good) return 'good';
  if (score >= SCORE_THRESHOLDS.fair) return 'fair';
  return 'poor';
}

export function scoreNight(state, key) {
  const entry = nightEntry(state, key);
  if (!entry) return null;
  const goal = sleepGoalMinutes(state.profile);
  if (entry.kind === 'awake') return { key, entry, awake: true, score: null, label: null, minutes: 0, goal, components: {}, weakest: null, heart: null };
  const minutes = nightMinutes(entry);
  const target = targetMinutes(entry, goal);
  const regularity = regularityFor(state, key);
  const components = {
    duration: durationScore(minutes, target),
    regularity: regularity ? regularity.score : null,
    interruptions: interruptionsScore(entry.detail),
    stages: stagesScore(entry.detail),
  };
  let weighted = 0;
  let weights = 0;
  for (const [name, value] of Object.entries(components)) {
    if (value === null) continue;
    weighted += value * SCORE_WEIGHTS[name];
    weights += SCORE_WEIGHTS[name];
  }
  const heart = heartAdjustment(state, key);
  const score = round(clamp(weighted / weights + (heart ? heart.points : 0), 0, 100));
  const available = Object.entries(components).filter(([, value]) => value !== null);
  const lowest = available.reduce((best, item) => (best === null || item[1] < best[1] ? item : best), null);
  let weakest = lowest && lowest[1] < WEAK_FACTOR_BELOW ? lowest[0] : null;
  if (!weakest && heart && heart.points <= -2) weakest = 'heart';
  return { key, entry, awake: false, score, label: scoreLabel(score), minutes, goal, target, basis: nightBasis(entry), components, regularity, weakest, heart, oversleep: minutes > target * 1.3 };
}

export function lastNightKey(state, now) {
  const todayKey = toDateKey(now);
  if (nightEntry(state, todayKey)) return todayKey;
  const night = plannedNight(state.profile, todayKey);
  if (now.getTime() >= night.wakeAt - 3 * 60 * MS_PER_MINUTE) return todayKey;
  return addDaysToKey(todayKey, -1);
}

export function sleepSeries(state, now, days) {
  const todayKey = toDateKey(now);
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = addDaysToKey(todayKey, -offset);
    const entry = nightEntry(state, key);
    const goal = sleepGoalMinutes(state.profile);
    result.push({ key, isToday: key === todayKey, entry, awake: Boolean(entry && entry.kind === 'awake'), minutes: entry ? nightMinutes(entry) : null, target: entry ? targetMinutes(entry, goal) : goal });
  }
  return result;
}

export function sleepOverview(state, now, days = 7) {
  const series = sleepSeries(state, now, days);
  const nights = series.filter((item) => item.entry && !item.awake);
  const goal = sleepGoalMinutes(state.profile);
  const averageMinutes = average(nights.map((item) => item.minutes));
  const bed = average(nights.map((item) => noonOffset(item.entry.sleptAt)));
  const wake = average(nights.map((item) => noonOffset(item.entry.wokeAt)));
  return {
    series,
    goal,
    nights: nights.length,
    averageMinutes: averageMinutes === null ? null : round(averageMinutes),
    averageBedMinute: bed === null ? null : offsetToClock(bed),
    averageWakeMinute: wake === null ? null : offsetToClock(wake),
    onGoal: nights.filter((item) => item.minutes >= item.target * NEAR_GOAL_SHARE).length,
    regularity: regularityFor(state, toDateKey(now)),
  };
}

export function nightTone(item) {
  if (!item.entry) return 'empty';
  if (item.awake) return 'off';
  if (item.minutes >= item.target * NEAR_GOAL_SHARE) return 'sleep';
  if (item.minutes >= item.target * FAR_BELOW_SHARE) return 'sleep-soft';
  return 'off';
}
