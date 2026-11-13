import { BODY_FAT_LIMITS } from './body.js';

export const MEASURE_SEXES = ['female', 'male'];
export const PROTOCOLS = ['jp3', 'jp7', 'tape'];
export const WAIST_SITES = ['navel', 'who'];
export const SKINFOLD_SITES = ['chest', 'midaxillary', 'triceps', 'subscapular', 'abdomen', 'suprailiac', 'thigh', 'calf'];
export const GIRTH_SITES = ['neck', 'chest', 'waist', 'hip', 'armRelaxed', 'armFlexed', 'forearm', 'thigh', 'calf'];
export const SKINFOLD_LIMITS = { min: 2, max: 80 };
export const SKINFOLD_TOLERANCE_MM = 2;
export const MAX_READINGS = 3;
export const GIRTH_LIMITS = {
  neck: { min: 20, max: 70 },
  chest: { min: 50, max: 200 },
  waist: { min: 40, max: 200 },
  hip: { min: 50, max: 200 },
  armRelaxed: { min: 15, max: 70 },
  armFlexed: { min: 15, max: 75 },
  forearm: { min: 12, max: 55 },
  thigh: { min: 25, max: 110 },
  calf: { min: 20, max: 70 },
};
export const JP_AGE_RANGE = { min: 18, max: 61 };

const JP3_SITES = { male: ['chest', 'abdomen', 'thigh'], female: ['triceps', 'suprailiac', 'thigh'] };
const JP7_SITES = ['chest', 'midaxillary', 'triceps', 'subscapular', 'abdomen', 'suprailiac', 'thigh'];
const LEE_SKINFOLDS = ['triceps', 'thigh', 'calf'];

const JP_COEFFICIENTS = {
  jp3: {
    male: { a: 1.10938, b: 0.0008267, c: 0.0000016, d: 0.0002574 },
    female: { a: 1.0994921, b: 0.0009929, c: 0.0000023, d: 0.0001392 },
  },
  jp7: {
    male: { a: 1.112, b: 0.00043499, c: 0.00000055, d: 0.00028826 },
    female: { a: 1.097, b: 0.00046971, c: 0.00000056, d: 0.00012828 },
  },
};

export function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function protocolSites(protocol, sex) {
  if (protocol === 'jp3') return MEASURE_SEXES.includes(sex) ? [...JP3_SITES[sex]] : [];
  if (protocol === 'jp7') return [...JP7_SITES];
  return [];
}

export function optionalSkinfoldSites(protocol, sex) {
  if (protocol === 'tape') return [];
  const required = protocolSites(protocol, sex);
  return LEE_SKINFOLDS.filter((site) => !required.includes(site));
}

export function isValidSkinfold(value) {
  return Number.isFinite(value) && value >= SKINFOLD_LIMITS.min && value <= SKINFOLD_LIMITS.max;
}

export function isValidGirth(site, value) {
  const limits = GIRTH_LIMITS[site];
  return Boolean(limits) && Number.isFinite(value) && value >= limits.min && value <= limits.max;
}

function tenths(value) {
  return Math.round(value * 10);
}

export const FOLD_DIRECTIONS = { chest: 'diagonal', midaxillary: 'vertical', triceps: 'vertical', subscapular: 'diagonal', abdomen: 'vertical', suprailiac: 'diagonal', thigh: 'vertical', calf: 'vertical' };

export function needsThirdReading(readings) {
  const valid = (readings || []).filter(isValidSkinfold);
  return valid.length === 2 && Math.abs(tenths(valid[0]) - tenths(valid[1])) > SKINFOLD_TOLERANCE_MM * 10;
}

export function siteValue(readings) {
  const valid = (readings || []).filter(isValidSkinfold).slice(0, MAX_READINGS);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  if (valid.length === 2) return (valid[0] + valid[1]) / 2;
  const sorted = [...valid].sort((left, right) => left - right);
  const low = tenths(sorted[1]) - tenths(sorted[0]);
  const high = tenths(sorted[2]) - tenths(sorted[1]);
  if (low === high) return sorted[1];
  return low < high ? (sorted[0] + sorted[1]) / 2 : (sorted[1] + sorted[2]) / 2;
}

export function isSiteComplete(readings) {
  const valid = (readings || []).filter(isValidSkinfold);
  if (valid.length < 2) return false;
  return !needsThirdReading(valid);
}

export function jacksonPollockDensity(protocol, sex, sumMm, age) {
  const coefficients = JP_COEFFICIENTS[protocol] && JP_COEFFICIENTS[protocol][sex];
  if (!coefficients || !Number.isFinite(sumMm) || sumMm <= 0 || !Number.isFinite(age)) return null;
  return coefficients.a - coefficients.b * sumMm + coefficients.c * sumMm * sumMm - coefficients.d * age;
}

export function siriBodyFat(density) {
  if (!Number.isFinite(density) || density <= 0) return null;
  return 495 / density - 450;
}

export function skinfoldSum(protocol, sex, skinfolds) {
  const sites = protocolSites(protocol, sex);
  if (sites.length === 0) return null;
  let sum = 0;
  for (const site of sites) {
    const value = siteValue(skinfolds && skinfolds[site]);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

export function skinfoldBodyFat(protocol, sex, skinfolds, age) {
  const sum = skinfoldSum(protocol, sex, skinfolds);
  if (sum === null) return null;
  const fat = siriBodyFat(jacksonPollockDensity(protocol, sex, sum, age));
  if (fat === null || fat < BODY_FAT_LIMITS.min || fat > BODY_FAT_LIMITS.max) return null;
  return { sumMm: round(sum, 1), pct: round(fat, 1) };
}

export function navyBodyFat({ sex, heightCm, neckCm, waistCm, hipCm }) {
  if (!Number.isFinite(heightCm) || !Number.isFinite(neckCm) || !Number.isFinite(waistCm)) return null;
  let fat;
  if (sex === 'male') {
    if (waistCm - neckCm <= 0) return null;
    fat = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
  } else if (sex === 'female') {
    if (!Number.isFinite(hipCm) || waistCm + hipCm - neckCm <= 0) return null;
    fat = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    return null;
  }
  if (!Number.isFinite(fat) || fat < BODY_FAT_LIMITS.min || fat > BODY_FAT_LIMITS.max) return null;
  return round(fat, 1);
}

export function leeMuscleMass({ sex, age, heightCm, armCm, tricepsMm, thighCm, thighMm, calfCm, calfMm }) {
  const values = [age, heightCm, armCm, tricepsMm, thighCm, thighMm, calfCm, calfMm];
  if (!MEASURE_SEXES.includes(sex) || values.some((value) => !Number.isFinite(value))) return null;
  const arm = armCm - Math.PI * (tricepsMm / 10);
  const thigh = thighCm - Math.PI * (thighMm / 10);
  const calf = calfCm - Math.PI * (calfMm / 10);
  if (arm <= 0 || thigh <= 0 || calf <= 0) return null;
  const meters = heightCm / 100;
  const muscle = meters * (0.00744 * arm * arm + 0.00088 * thigh * thigh + 0.00441 * calf * calf) + 2.4 * (sex === 'male' ? 1 : 0) - 0.048 * age + 7.8;
  return muscle > 0 ? round(muscle, 1) : null;
}

export function bodyMassIndex(weightKg, heightCm) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const meters = heightCm / 100;
  return round(weightKg / (meters * meters), 1);
}

export function fatFreeMassIndex(leanKg, heightCm) {
  if (!Number.isFinite(leanKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const meters = heightCm / 100;
  return round(leanKg / (meters * meters), 1);
}

export function ratio(numerator, denominator, decimals = 2) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round(numerator / denominator, decimals);
}

export function sessionResults(session) {
  const sex = session.sex;
  const skinfolds = session.skinfolds || {};
  const girths = session.girths || {};
  const height = session.heightCm;
  const weight = Number.isFinite(session.weightKg) ? session.weightKg : null;
  const skinfold = session.protocol === 'tape' ? null : skinfoldBodyFat(session.protocol, sex, skinfolds, session.age);
  const navy = navyBodyFat({ sex, heightCm: height, neckCm: girths.neck, waistCm: girths.waist, hipCm: girths.hip });
  const fatPct = skinfold ? skinfold.pct : navy;
  const fatSource = skinfold ? session.protocol : navy !== null ? 'navy' : null;
  const fatMassKg = weight !== null && fatPct !== null ? round((weight * fatPct) / 100, 1) : null;
  const leanMassKg = weight !== null && fatMassKg !== null ? round(weight - fatMassKg, 1) : null;
  const muscleKg = leeMuscleMass({
    sex,
    age: session.age,
    heightCm: height,
    armCm: girths.armRelaxed,
    tricepsMm: siteValue(skinfolds.triceps) ?? NaN,
    thighCm: girths.thigh,
    thighMm: siteValue(skinfolds.thigh) ?? NaN,
    calfCm: girths.calf,
    calfMm: siteValue(skinfolds.calf) ?? NaN,
  });
  return {
    protocol: session.protocol,
    sumMm: skinfold ? skinfold.sumMm : null,
    jp3: session.protocol === 'jp3' && skinfold ? skinfold.pct : null,
    jp7: session.protocol === 'jp7' && skinfold ? skinfold.pct : null,
    navy,
    fatPct,
    fatSource,
    fatMassKg,
    leanMassKg,
    muscleKg,
    ffmi: fatFreeMassIndex(leanMassKg, height),
    bmi: bodyMassIndex(weight, height),
    whr: ratio(girths.waist, girths.hip, 2),
    whtr: ratio(girths.waist, height, 2),
    weightKg: weight,
    girths: { ...girths },
    outsideJpAge: session.protocol !== 'tape' && (session.age < JP_AGE_RANGE.min || session.age > JP_AGE_RANGE.max),
  };
}
