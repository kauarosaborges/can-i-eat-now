import { WEIGHT_LIMITS, dedupeMeasurements, isIgnoredHealthWeight, latestWeightKg, mergeWeights } from './body.js';
import { clampNumber, isValidDateKey } from './time.js';

export const ACTIVITY_FIELDS = ['basal', 'active', 'total', 'steps', 'exerciseMinutes'];
export const MAX_IGNORED = 5000;

export function emptyEnergyDay() {
  return { basal: null, active: null, total: null, intake: null, steps: null, exerciseMinutes: null, workouts: [] };
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

export function stripHealthGroup(state, group) {
  if (group === 'body') {
    const body = { ...state.body, weights: state.body.weights.filter((entry) => entry.source !== 'health'), fat: state.body.fat.filter((entry) => entry.source !== 'health'), healthHeightCm: null };
    return withLatestWeight(state, body);
  }
  const fields = group === 'activity' ? ACTIVITY_FIELDS : ['intake'];
  const days = {};
  for (const [key, day] of Object.entries(state.energy.days)) {
    const next = { ...day };
    for (const field of fields) next[field] = null;
    if (group === 'activity') next.workouts = [];
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
      const group = field === 'intake' ? 'nutrition' : 'activity';
      if (!groups[group]) continue;
      day[field] = value;
    }
    days[key] = day;
  }
  return { ...next, energy: { days } };
}
