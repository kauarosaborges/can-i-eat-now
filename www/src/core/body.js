import { MS_PER_MINUTE, isValidDateKey, toDateKey } from './time.js';

export const SEX_OPTIONS = ['unspecified', 'female', 'male'];
export const WEIGHT_LIMITS = { min: 30, max: 300 };
export const BODY_FAT_LIMITS = { min: 3, max: 70 };
export const MAX_WEIGHT_ENTRIES = 5000;
export const DEDUPE_WINDOW_MS = MS_PER_MINUTE;
export const DEDUPE_KG = 0.05;

export function createBodyEntryId(prefix, at) {
  return `${prefix}-${Math.round(at).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function roundKg(value) {
  return Math.round(value * 10) / 10;
}

function measurementRank(entry) {
  if (entry.source !== 'manual') return 2;
  return entry.sessionId ? 0 : 1;
}

function compareMeasurements(left, right) {
  if (left.at !== right.at) return left.at - right.at;
  const leftRank = measurementRank(left);
  const rightRank = measurementRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.id || '').localeCompare(String(right.id || ''));
}

export function dedupeMeasurements(entries, valueKey, tolerance) {
  const sorted = [...(entries || [])].sort(compareMeasurements);
  const kept = [];
  for (const entry of sorted) {
    let duplicateIndex = -1;
    for (let index = kept.length - 1; index >= 0 && entry.at - kept[index].at <= DEDUPE_WINDOW_MS; index -= 1) {
      if (Math.abs(kept[index][valueKey] - entry[valueKey]) <= tolerance) {
        duplicateIndex = index;
        break;
      }
    }
    if (duplicateIndex === -1) {
      kept.push({ ...entry });
    } else if (measurementRank(entry) < measurementRank(kept[duplicateIndex])) {
      kept[duplicateIndex] = { ...entry };
    }
  }
  return kept;
}

export function isIgnoredHealthFat(ignored, entry) {
  return (ignored || []).some((item) => Math.abs(item.at - entry.at) <= DEDUPE_WINDOW_MS && Math.abs(item.pct - entry.pct) <= 0.1);
}

export function isIgnoredHealthWeight(ignored, entry) {
  return (ignored || []).some((item) => Math.abs(item.at - entry.at) <= DEDUPE_WINDOW_MS && Math.abs(item.kg - entry.kg) <= DEDUPE_KG);
}

export function mergeWeights(existing, incoming) {
  return dedupeMeasurements([...(existing || []), ...(incoming || [])], 'kg', DEDUPE_KG).slice(-MAX_WEIGHT_ENTRIES);
}

export function latestWeightKg(state) {
  const weights = state.body && state.body.weights ? state.body.weights : [];
  if (weights.length === 0) return state.profile.weightKg;
  return weights.reduce((latest, entry) => (entry.at > latest.at ? entry : latest), weights[0]).kg;
}

export function latestBodyFat(state) {
  const fat = state.body && state.body.fat ? state.body.fat : [];
  if (fat.length === 0) return null;
  return fat.reduce((latest, entry) => (entry.at > latest.at ? entry : latest), fat[0]).pct;
}

export const BIRTH_AGE_LIMITS = { min: 10, max: 110 };

function shiftYears(now, years) {
  const shifted = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  return toDateKey(shifted);
}

export function birthDateRange(now) {
  return { min: shiftYears(now, BIRTH_AGE_LIMITS.max), max: shiftYears(now, BIRTH_AGE_LIMITS.min) };
}

export function isPlausibleBirthDate(value, now) {
  if (!isValidDateKey(value)) return false;
  const range = birthDateRange(now);
  return value >= range.min && value <= range.max;
}

export function ageOn(profile, now) {
  if (isPlausibleBirthDate(profile.birthDate, now)) {
    const [year, month, day] = profile.birthDate.split('-').map(Number);
    let age = now.getFullYear() - year;
    if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
    return Math.max(10, Math.min(110, age));
  }
  return profile.age;
}

export function dailyWeights(weights) {
  const byDay = new Map();
  for (const entry of [...(weights || [])].sort((left, right) => left.at - right.at)) {
    byDay.set(toDateKey(new Date(entry.at)), entry);
  }
  return [...byDay.entries()].map(([key, entry]) => ({ key, at: entry.at, kg: entry.kg }));
}
