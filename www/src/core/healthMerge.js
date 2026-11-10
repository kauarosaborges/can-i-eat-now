import { WEIGHT_LIMITS, dedupeMeasurements, isIgnoredHealthWeight, latestWeightKg, mergeWeights } from './body.js';
import { addDaysToKey, clampNumber, dateAtMinutes, isValidDateKey, toDateKey } from './time.js';

export const HEALTH_GROUPS = ['body', 'activity', 'nutrition', 'heart'];
export const HEALTH_GROUP_TYPES = {
  body: ['weight', 'height', 'bodyFat'],
  activity: ['calories', 'basalCalories', 'totalCalories', 'steps', 'exerciseTime', 'workouts', 'distance', 'flightsClimbed'],
  nutrition: ['dietaryEnergyConsumed'],
  heart: ['restingHeartRate', 'heartRate', 'heartRateVariability', 'respiratoryRate'],
};
export const LEGACY_GROUP_TYPES = {
  body: ['weight', 'height', 'bodyFat'],
  activity: ['calories', 'basalCalories', 'totalCalories', 'steps', 'exerciseTime', 'workouts'],
  nutrition: ['dietaryEnergyConsumed'],
  heart: [],
};
export const KNOWN_HEALTH_TYPES = [...new Set(Object.values(HEALTH_GROUP_TYPES).flat())];
export const DAY_FIELD_GROUPS = {
  basal: 'activity',
  active: 'activity',
  total: 'activity',
  steps: 'activity',
  exerciseMinutes: 'activity',
  distanceM: 'activity',
  flights: 'activity',
  workouts: 'activity',
  intake: 'nutrition',
  restingHr: 'heart',
  avgHr: 'heart',
  hrv: 'heart',
  respiratory: 'heart',
};
export const ACTIVITY_FIELDS = ['basal', 'active', 'total', 'steps', 'exerciseMinutes', 'distanceM', 'flights'];
export const HEART_FIELDS = ['restingHr', 'avgHr', 'hrv', 'respiratory'];
export const MAX_IGNORED = 5000;

export function emptyEnergyDay() {
  return {
    basal: null,
    active: null,
    total: null,
    intake: null,
    steps: null,
    exerciseMinutes: null,
    distanceM: null,
    flights: null,
    restingHr: null,
    avgHr: null,
    hrv: null,
    respiratory: null,
    workouts: [],
  };
}

export function validWeight(kg) {
  return Number.isFinite(kg) && kg >= WEIGHT_LIMITS.min && kg <= WEIGHT_LIMITS.max;
}

export function withLatestWeight(state, body) {
  const next = { ...state, body };
  return { ...next, profile: { ...state.profile, weightKg: clampNumber(latestWeightKg(next), WEIGHT_LIMITS.min, WEIGHT_LIMITS.max, state.profile.weightKg) } };
}

export function addIgnored(body, entry) {
  return { ...body, ignoredHealth: [...(body.ignoredHealth || []), { at: entry.at, kg: entry.kg }].slice(-MAX_IGNORED) };
}

export function removeIgnored(body, entry) {
  return { ...body, ignoredHealth: (body.ignoredHealth || []).filter((item) => !(item.at === entry.at && item.kg === entry.kg)) };
}

export function requiredHealthTypes(health, groupTypes = HEALTH_GROUP_TYPES) {
  return [...new Set(HEALTH_GROUPS.filter((group) => health && health[group]).flatMap((group) => groupTypes[group] || []))];
}

export function missingHealthTypes(health) {
  const requested = new Set(Array.isArray(health && health.requested) ? health.requested : []);
  return requiredHealthTypes(health).filter((type) => !requested.has(type));
}

export function withRequestedTypes(health, types) {
  const requested = [...new Set([...(Array.isArray(health.requested) ? health.requested : []), ...types])].filter((type) => KNOWN_HEALTH_TYPES.includes(type));
  return { ...health, requested };
}

export function stripHealthGroup(state, group) {
  if (group === 'body') {
    const body = { ...state.body, weights: state.body.weights.filter((entry) => entry.source !== 'health'), fat: state.body.fat.filter((entry) => entry.source !== 'health'), healthHeightCm: null };
    return withLatestWeight(state, body);
  }
  const fields = Object.keys(DAY_FIELD_GROUPS).filter((field) => DAY_FIELD_GROUPS[field] === group);
  const days = {};
  for (const [key, day] of Object.entries(state.energy.days)) {
    const next = { ...day };
    for (const field of fields) next[field] = field === 'workouts' ? [] : null;
    days[key] = next;
  }
  return { ...state, energy: { days } };
}

export function mergeHealthSync(state, snapshot) {
  const groups = state.health;
  let next = state;
  if (groups.body && snapshot.body) {
    const weights = snapshot.body.weights.filter((entry) => !isIgnoredHealthWeight(state.body.ignoredHealth, entry));
    const body = {
      ...state.body,
      weights: mergeWeights(state.body.weights, weights),
      fat: dedupeMeasurements([...state.body.fat, ...snapshot.body.fat], 'pct', 0.1),
      healthHeightCm: Number.isFinite(snapshot.body.heightCm) ? snapshot.body.heightCm : state.body.healthHeightCm,
    };
    next = withLatestWeight(next, body);
  }
  const days = { ...next.energy.days };
  for (const [key, incoming] of Object.entries(snapshot.days || {})) {
    if (!isValidDateKey(key)) continue;
    const day = { ...emptyEnergyDay(), ...(days[key] || {}) };
    for (const [field, value] of Object.entries(incoming)) {
      const group = DAY_FIELD_GROUPS[field];
      if (!group || !groups[group]) continue;
      day[field] = value;
    }
    days[key] = day;
  }
  return { ...next, energy: { days } };
}

export function dailyFromSamples(samples, mode, { truncated = false, decimals = 0, keyBy = 'start' } = {}) {
  const buckets = {};
  for (const sample of samples || []) {
    const at = Date.parse(sample && (keyBy === 'end' ? sample.endDate || sample.startDate : sample.startDate));
    const value = sample ? sample.value : NaN;
    if (!Number.isFinite(at) || !Number.isFinite(value) || value < 0) continue;
    const key = toDateKey(new Date(at));
    const source = String((sample.sourceId || sample.sourceName || 'unknown')).slice(0, 200);
    const day = buckets[key] || (buckets[key] = {});
    const bucket = day[source] || (day[source] = { sum: 0, count: 0 });
    bucket.sum += value;
    bucket.count += 1;
  }
  const keys = Object.keys(buckets).sort();
  if (truncated && keys.length > 0) delete buckets[keys[0]];
  const factor = 10 ** decimals;
  const result = {};
  for (const [key, sources] of Object.entries(buckets)) {
    const list = Object.values(sources);
    let value;
    if (mode === 'average') {
      const total = list.reduce((sum, bucket) => sum + bucket.sum, 0);
      const count = list.reduce((sum, bucket) => sum + bucket.count, 0);
      value = total / count;
    } else {
      value = Math.max(...list.map((bucket) => bucket.sum));
    }
    const rounded = Math.round(value * factor) / factor;
    if (Number.isFinite(rounded)) result[key] = rounded;
  }
  return result;
}

export function syncStartDate(now, days) {
  return dateAtMinutes(addDaysToKey(toDateKey(now), -days), 0);
}

export function dayChunks(now, days, size) {
  const todayKey = toDateKey(now);
  const chunks = [];
  for (let offset = days; offset >= 0; offset -= size) {
    const startKey = addDaysToKey(todayKey, -offset);
    const endOffset = Math.max(-1, offset - size);
    const end = endOffset < 0 ? now : dateAtMinutes(addDaysToKey(todayKey, -endOffset), 0);
    chunks.push({ start: dateAtMinutes(startKey, 0), end });
  }
  return chunks;
}
