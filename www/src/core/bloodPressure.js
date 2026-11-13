export const BP_LIMITS = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 30, max: 160 },
  pulse: { min: 30, max: 220 },
};
export const BP_ARMS = ['left', 'right'];
export const BP_CATEGORIES = ['normal', 'prehypertension', 'stage1', 'stage2', 'stage3'];
export const BP_URGENT = { systolic: 180, diastolic: 110 };
export const MAX_BP_READINGS = 3;

const SYSTOLIC_STEPS = [120, 140, 160, 180];
const DIASTOLIC_STEPS = [80, 90, 100, 110];

function stepIndex(value, steps) {
  let index = 0;
  while (index < steps.length && value >= steps[index]) index += 1;
  return index;
}

export function validateReading({ systolic, diastolic, pulse }) {
  if (!Number.isFinite(systolic) || systolic < BP_LIMITS.systolic.min || systolic > BP_LIMITS.systolic.max) return 'systolic';
  if (!Number.isFinite(diastolic) || diastolic < BP_LIMITS.diastolic.min || diastolic > BP_LIMITS.diastolic.max) return 'diastolic';
  if (systolic <= diastolic) return 'order';
  if (pulse !== null && pulse !== undefined && (!Number.isFinite(pulse) || pulse < BP_LIMITS.pulse.min || pulse > BP_LIMITS.pulse.max)) return 'pulse';
  return null;
}

export function classifyBloodPressure(systolic, diastolic) {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
  return BP_CATEGORIES[Math.max(stepIndex(systolic, SYSTOLIC_STEPS), stepIndex(diastolic, DIASTOLIC_STEPS))];
}

export function isUrgent(systolic, diastolic) {
  return systolic >= BP_URGENT.systolic || diastolic >= BP_URGENT.diastolic;
}

export function categoryStatus(category) {
  if (category === 'normal') return 'good';
  if (category === 'prehypertension') return 'borderline';
  return category ? 'out' : null;
}

export function averageReadings(readings) {
  const valid = (readings || []).filter((reading) => validateReading(reading) === null).slice(0, MAX_BP_READINGS);
  if (valid.length === 0) return null;
  const mean = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const pulses = valid.map((reading) => reading.pulse).filter((value) => Number.isFinite(value));
  return {
    systolic: mean(valid.map((reading) => reading.systolic)),
    diastolic: mean(valid.map((reading) => reading.diastolic)),
    pulse: pulses.length > 0 ? mean(pulses) : null,
    count: valid.length,
  };
}

export function sameBloodPressure(left, right, windowMs = 60000) {
  return Math.abs(left.at - right.at) <= windowMs && Math.abs(left.systolic - right.systolic) <= 1 && Math.abs(left.diastolic - right.diastolic) <= 1;
}

export function isIgnoredHealthPressure(ignored, entry) {
  return (ignored || []).some((item) => sameBloodPressure(item, entry));
}

function sourceRank(entry) {
  return entry.source === 'manual' ? 0 : 1;
}

export function mergeBloodPressure(existing, incoming, limit = Infinity) {
  const sorted = [...(existing || []), ...(incoming || [])].sort((left, right) => left.at - right.at || sourceRank(left) - sourceRank(right) || String(left.id || '').localeCompare(String(right.id || '')));
  const kept = [];
  for (const entry of sorted) {
    let duplicate = -1;
    for (let index = kept.length - 1; index >= 0 && entry.at - kept[index].at <= 60000; index -= 1) {
      if (kept[index].source === 'manual' && entry.source === 'manual') continue;
      if (sameBloodPressure(kept[index], entry)) {
        duplicate = index;
        break;
      }
    }
    if (duplicate === -1) kept.push({ ...entry });
    else if (kept[duplicate].source !== 'manual' && entry.source === 'manual') kept[duplicate] = { ...entry };
  }
  if (!Number.isFinite(limit) || kept.length <= limit) return kept;
  let excess = kept.length - limit;
  const trimmed = kept.filter((entry) => {
    if (excess > 0 && entry.source === 'health') {
      excess -= 1;
      return false;
    }
    return true;
  });
  return trimmed.slice(-limit);
}

export function readingsPeak(readings) {
  const valid = (readings || []).filter((reading) => validateReading(reading) === null);
  if (valid.length === 0) return null;
  return { systolic: Math.max(...valid.map((reading) => reading.systolic)), diastolic: Math.max(...valid.map((reading) => reading.diastolic)) };
}

export function entryUrgent(entry) {
  if (!entry) return false;
  if (isUrgent(entry.systolic, entry.diastolic)) return true;
  return Number.isFinite(entry.peakSystolic) && Number.isFinite(entry.peakDiastolic) && isUrgent(entry.peakSystolic, entry.peakDiastolic);
}
