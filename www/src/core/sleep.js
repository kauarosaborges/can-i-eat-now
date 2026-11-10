import { buildReminderSchedule, computeDailyGoal } from './hydration.js';
import { MS_PER_HOUR, MS_PER_MINUTE, addDaysToKey, dateAtMinutes, isValidDateKey, timeToMinutes, toDateKey } from './time.js';

export const SLEEP_SOURCES = ['inferred', 'confirmed', 'health'];
export const SLEEP_KINDS = ['night', 'awake'];
export const SOURCE_PRIORITY = { health: 3, confirmed: 2, inferred: 1 };
export const MIN_SLEEP_GAP_MS = 3 * MS_PER_HOUR;
export const MIN_COUNTED_GAP_MS = 60 * MS_PER_MINUTE;
export const ACTIVITY_RETENTION_MS = 3 * 24 * MS_PER_HOUR;
export const ACTIVITY_RESOLUTION_MS = 5 * MS_PER_MINUTE;
export const MAX_ACTIVITY_ENTRIES = 1000;
export const CONFIRM_LEAD_MINUTES = 120;
export const HEALTH_LOOKBACK_HOURS = 36;
export const HEALTH_SESSION_GAP_MS = 90 * MS_PER_MINUTE;
export const HEALTH_SETTLE_MS = 20 * MS_PER_MINUTE;
export const WAKE_EARLY_MS = 3 * MS_PER_HOUR;
export const WAKE_LATE_MS = 6 * MS_PER_HOUR;
export const SLEEP_RETENTION_DAYS = 30;
const ASLEEP_STATES = ['asleep', 'light', 'deep', 'rem'];

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

export function plannedNight(profile, wakeKey) {
  const wake = timeToMinutes(profile.wakeTime);
  const sleep = timeToMinutes(profile.sleepTime);
  const sleepKey = sleep > wake ? addDaysToKey(wakeKey, -1) : wakeKey;
  return { sleepAt: dateAtMinutes(sleepKey, sleep).getTime(), wakeAt: dateAtMinutes(wakeKey, wake).getTime() };
}

export function isValidDayWake(profile, wakeKey, wokeAt) {
  const night = plannedNight(profile, wakeKey);
  return wokeAt > night.sleepAt && wokeAt >= night.wakeAt - WAKE_EARLY_MS && wokeAt <= night.wakeAt + WAKE_LATE_MS;
}

export function nightKeyForWake(profile, wokeAt) {
  const key = toDateKey(new Date(wokeAt));
  for (const candidate of [key, addDaysToKey(key, 1), addDaysToKey(key, -1)]) {
    if (isValidDayWake(profile, candidate, wokeAt)) return candidate;
  }
  return null;
}

export function currentNightKey(profile, now) {
  if (isAsleepAt(profile, now)) return toDateKey(nextWakeAfter(profile, now));
  return toDateKey(now);
}

function entryKey(entry, profile) {
  if (isValidDateKey(entry.wakeKey)) return entry.wakeKey;
  return nightKeyForWake(profile, entry.wokeAt);
}

export function sleepEntryForDay(sleepLog, profile, wakeKey) {
  const night = plannedNight(profile, wakeKey);
  const candidates = (sleepLog || []).filter((entry) => {
    if (entryKey(entry, profile) !== wakeKey) return false;
    if (entry.wokeAt <= night.sleepAt) return false;
    if (entry.kind === 'awake') return true;
    return isValidDayWake(profile, wakeKey, entry.wokeAt);
  });
  candidates.sort((left, right) => (SOURCE_PRIORITY[right.source] || 0) - (SOURCE_PRIORITY[left.source] || 0) || right.wokeAt - left.wokeAt);
  return candidates[0] || null;
}

export function actualWakeMinute(state, wakeKey) {
  const entry = sleepEntryForDay(state.sleep && state.sleep.log, state.profile, wakeKey);
  if (!entry || entry.source === 'inferred' || entry.kind === 'awake') return null;
  const dayStart = dateAtMinutes(wakeKey, 0).getTime();
  return Math.round((entry.wokeAt - dayStart) / MS_PER_MINUTE);
}

export function nightMode(state, now) {
  const nowMs = now.getTime();
  const profile = state.profile;
  if (!isAsleepAt(profile, now)) return { active: false, awake: false };
  const key = currentNightKey(profile, now);
  const night = plannedNight(profile, key);
  const entry = sleepEntryForDay(state.sleep && state.sleep.log, profile, key);
  if (entry && entry.source !== 'inferred' && entry.wokeAt <= nowMs) return { active: false, awake: false };
  const nightAwakeAt = state.sleep && Number.isFinite(state.sleep.nightAwakeAt) ? state.sleep.nightAwakeAt : null;
  const awake = nightAwakeAt !== null && nightAwakeAt <= nowMs && nightAwakeAt >= night.sleepAt - 2 * MS_PER_HOUR && nightAwakeAt < night.wakeAt;
  return { active: true, awake };
}

export function roundActivity(ms) {
  return Math.floor(ms / ACTIVITY_RESOLUTION_MS) * ACTIVITY_RESOLUTION_MS;
}

export function recordActivity(activity, nowMs) {
  const rounded = roundActivity(nowMs);
  const kept = (activity || []).filter((at) => Number.isFinite(at) && nowMs - at <= ACTIVITY_RETENTION_MS && at <= nowMs);
  if (kept.includes(rounded)) return kept;
  return [...kept, rounded].sort((left, right) => left - right).slice(-MAX_ACTIVITY_ENTRIES);
}

export function inferSleep(activity, profile, wakeKey, now) {
  const night = plannedNight(profile, wakeKey);
  const rangeStart = night.sleepAt - MS_PER_HOUR;
  const rangeEnd = Math.min(night.wakeAt + 3 * MS_PER_HOUR, now.getTime());
  const fallback = { wakeKey, sleptAt: night.sleepAt, wokeAt: night.wakeAt, source: 'inferred', kind: 'night' };
  const points = (activity || []).filter((at) => at >= rangeStart && at <= rangeEnd).sort((left, right) => left - right);
  const gaps = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = points[index + 1] - points[index];
    if (length >= MIN_COUNTED_GAP_MS) gaps.push({ start: points[index], end: points[index + 1], length });
  }
  if (gaps.length === 0) return fallback;
  const main = gaps.reduce((best, gap) => (gap.length > best.length ? gap : best), gaps[0]);
  const total = gaps.reduce((sum, gap) => sum + gap.length, 0);
  let candidate = null;
  if (main.length >= MIN_SLEEP_GAP_MS) candidate = { sleptAt: main.start, wokeAt: main.end };
  else if (total >= MIN_SLEEP_GAP_MS) candidate = { sleptAt: gaps[0].start, wokeAt: gaps[gaps.length - 1].end };
  if (!candidate) return fallback;
  const wokeAt = isValidDayWake(profile, wakeKey, candidate.wokeAt) ? candidate.wokeAt : night.wakeAt;
  return { wakeKey, sleptAt: Math.min(candidate.sleptAt, wokeAt - MS_PER_HOUR), wokeAt, source: 'inferred', kind: 'night' };
}

export function shouldOfferSleepConfirm(state, now) {
  const key = toDateKey(now);
  const night = plannedNight(state.profile, key);
  const nowMs = now.getTime();
  if (nowMs < night.wakeAt - CONFIRM_LEAD_MINUTES * MS_PER_MINUTE) return false;
  if (nowMs > night.wakeAt + 12 * MS_PER_HOUR) return false;
  if (isAsleepAt(state.profile, now)) return false;
  const entry = sleepEntryForDay(state.sleep && state.sleep.log, state.profile, key);
  return !entry || entry.source === 'inferred';
}

export function pruneSleepLog(sleepLog, nowMs) {
  const limit = SLEEP_RETENTION_DAYS * 24 * MS_PER_HOUR;
  return (sleepLog || []).filter((entry) => Number.isFinite(entry.wokeAt) && nowMs - entry.wokeAt <= limit);
}

export function upsertSleepEntry(sleepLog, profile, entry, nowMs = entry.wokeAt) {
  const kind = entry.kind === 'awake' ? 'awake' : 'night';
  const wakeKey = isValidDateKey(entry.wakeKey) ? entry.wakeKey : nightKeyForWake(profile, entry.wokeAt);
  if (!wakeKey) return pruneSleepLog(sleepLog, nowMs);
  if (kind === 'night' && !isValidDayWake(profile, wakeKey, entry.wokeAt)) return pruneSleepLog(sleepLog, nowMs);
  const others = (sleepLog || []).filter((item) => !(entryKey(item, profile) === wakeKey && item.source === entry.source));
  const saved = { wakeKey, sleptAt: entry.sleptAt, wokeAt: entry.wokeAt, source: entry.source, kind };
  return pruneSleepLog([...others, saved], nowMs).sort((left, right) => left.wokeAt - right.wokeAt);
}

export function removeHealthEntries(sleepLog) {
  return (sleepLog || []).filter((entry) => entry.source !== 'health');
}

export function awakeNightEntry(profile, wakeKey) {
  const night = plannedNight(profile, wakeKey);
  return { wakeKey, sleptAt: night.sleepAt, wokeAt: night.wakeAt, source: 'confirmed', kind: 'awake' };
}

export function sessionFromHealthSamples(samples, now, profile, wakeKey = currentNightKey(profile, now)) {
  const nowMs = now.getTime();
  const from = nowMs - HEALTH_LOOKBACK_HOURS * MS_PER_HOUR;
  const parsed = (samples || [])
    .map((sample) => ({ start: Date.parse(sample.startDate), end: Date.parse(sample.endDate), state: sample.sleepState }))
    .filter((sample) => Number.isFinite(sample.start) && Number.isFinite(sample.end) && sample.end > sample.start && sample.end > from);
  const asleep = parsed.filter((sample) => ASLEEP_STATES.includes(sample.state));
  const usable = (asleep.length > 0 ? asleep : parsed.filter((sample) => sample.state === 'inBed')).sort((left, right) => left.start - right.start);
  const sessions = [];
  for (const sample of usable) {
    const last = sessions[sessions.length - 1];
    if (last && sample.start - last.wokeAt <= HEALTH_SESSION_GAP_MS) last.wokeAt = Math.max(last.wokeAt, sample.end);
    else sessions.push({ sleptAt: sample.start, wokeAt: sample.end });
  }
  const valid = sessions.filter((session) => nowMs - session.wokeAt >= HEALTH_SETTLE_MS && session.wokeAt - session.sleptAt >= MS_PER_HOUR && isValidDayWake(profile, wakeKey, session.wokeAt));
  if (valid.length === 0) return null;
  const longest = valid.reduce((best, session) => (session.wokeAt - session.sleptAt > best.wokeAt - best.sleptAt ? session : best), valid[0]);
  return { wakeKey, sleptAt: longest.sleptAt, wokeAt: longest.wokeAt, source: 'health', kind: 'night' };
}

export function waterScheduleFor(state, key) {
  const profile = state.profile;
  const wakeMinute = actualWakeMinute(state, key);
  return buildReminderSchedule({
    goalMl: computeDailyGoal(profile).goalMl,
    glassMl: profile.glassMl,
    wakeTime: profile.wakeTime,
    sleepTime: profile.sleepTime,
    wakeMinute: wakeMinute === null ? undefined : wakeMinute,
  });
}
