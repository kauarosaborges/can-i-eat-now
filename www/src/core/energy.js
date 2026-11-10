import { ageOn, dailyWeights, latestWeightKg } from './body.js';
import { MODIFIED_MEAL_ID, classifyDay, isInsideWindow, effectiveWindow } from './fasting.js';
import { mealsForDay, scheduledMinutes } from './meals.js';
import { MINUTES_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, addDaysToKey, dateAtMinutes, daysBetween, minutesOfDay, toDateKey } from './time.js';

export const KCAL_PER_KG_FAT = 7700;
export const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, intense: 1.725 };
export const EXERCISE_KCAL_PER_MINUTE = 4;
export const PORTION_MULTIPLIERS = { less: 0.7, normal: 1, more: 1.3 };
export const DEFAULT_SNACK_KCAL = 250;
export const GLYCOGEN_MAX_DROP_KG = 1.2;
export const GLYCOGEN_FREE_HOURS = 12;
export const GLYCOGEN_FULL_DROP_HOURS = 36;
export const REFEED_FRACTION = 0.5;
export const FASTED_FRACTION = 0.15;
export const EMA_ALPHA = 0.1;
export const PROJECTION_DAYS = 28;
export const BALANCE_WINDOW_DAYS = 14;
export const MIN_BALANCE_DAYS = 7;
export const MIN_WEIGH_INS = 3;
export const MAX_GOAL_DAYS = 730;
export const ENERGY_RETENTION_DAYS = 180;
export const EMA_RESET_GAP_DAYS = 14;
export const TRUSTED_INTAKE_FRACTION = 0.3;
export const TRUSTED_EXPENDITURE_FRACTION = 0.5;
export const GLYCOGEN_LOOKBACK_DAYS = 7;
export const WEIGHT_JUMP_FRACTION = 0.15;
export const WEIGHT_JUMP_DAYS = 3;

export function bmrMifflinStJeor({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base + (5 - 161) / 2;
}

export function activityFactor(level) {
  return ACTIVITY_FACTORS[level] || ACTIVITY_FACTORS.light;
}

export function effectiveHeightCm(state) {
  const profile = state.profile;
  const healthHeight = state.body && Number.isFinite(state.body.healthHeightCm) ? state.body.healthHeightCm : null;
  if (profile.heightSource === 'manual' || healthHeight === null) return profile.heightCm;
  return healthHeight;
}

export function trendWeightKg(state) {
  const trend = emaTrend(state.body ? state.body.weights : []);
  return trend.length > 0 ? trend[trend.length - 1].trend : latestWeightKg(state);
}

export function estimatedDailyExpenditure(state, now) {
  const profile = state.profile;
  const basal = bmrMifflinStJeor({ sex: profile.sex, weightKg: trendWeightKg(state), heightCm: effectiveHeightCm(state), age: ageOn(profile, now) });
  const total = basal * activityFactor(profile.activity) + profile.exerciseMinutes * EXERCISE_KCAL_PER_MINUTE;
  return { basal: Math.round(basal), active: Math.round(total - basal), total: Math.round(total) };
}

function healthDay(state, key) {
  return state.energy && state.energy.days ? state.energy.days[key] || null : null;
}

function finite(value) {
  return Number.isFinite(value) && value > 0;
}

export function present(value) {
  return Number.isFinite(value) && value >= 0;
}

export function elapsedFraction(key, now) {
  const todayKey = toDateKey(now);
  if (key < todayKey) return 1;
  if (key > todayKey) return 0;
  return Math.min(1, Math.max(0, minutesOfDay(now) / MINUTES_PER_DAY));
}

export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function typicalHealthValue(state, key, field) {
  const values = [];
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = healthDay(state, addDaysToKey(key, -offset));
    if (day && finite(day[field])) values.push(day[field]);
  }
  return median(values);
}

export function typicalActiveKcal(state, key) {
  return typicalHealthValue(state, key, 'active');
}

export function fullDayBasal(state, key, basalSoFar, fraction, estimateBasal) {
  const typical = typicalHealthValue(state, key, 'basal');
  if (typical !== null) return typical;
  if (fraction >= 0.5 && finite(basalSoFar)) return Math.min(estimateBasal * 1.5, Math.max(estimateBasal * 0.6, basalSoFar / fraction));
  return estimateBasal;
}

export function expenditureForDay(state, key, now) {
  const estimate = estimatedDailyExpenditure(state, now);
  const fraction = elapsedFraction(key, now);
  const day = healthDay(state, key);
  const healthTotal = day ? (finite(day.total) ? day.total : finite(day.basal) && present(day.active) ? day.basal + day.active : null) : null;
  const trustworthy = healthTotal !== null && healthTotal >= estimate.total * fraction * TRUSTED_EXPENDITURE_FRACTION;
  if (!trustworthy) {
    return {
      source: 'estimate',
      fallback: healthTotal !== null,
      basal: Math.round(estimate.basal * fraction),
      active: Math.round(estimate.active * fraction),
      total: Math.round(estimate.total * fraction),
      projectedTotal: estimate.total,
    };
  }
  const basal = finite(day.basal) ? day.basal : Math.max(0, healthTotal - (day.active || 0));
  const active = present(day.active) ? day.active : Math.max(0, healthTotal - basal);
  const total = healthTotal;
  if (fraction >= 1) return { source: 'health', basal, active, total, projectedTotal: total };
  const basalFull = Math.max(basal, fullDayBasal(state, key, basal, fraction, estimate.basal));
  const typical = typicalActiveKcal(state, key);
  const remainingActive = (typical === null ? estimate.active : typical) * (1 - fraction);
  return { source: 'health', basal, active, total, projectedTotal: Math.round(basalFull + active + Math.max(0, remainingActive)) };
}

export function portionMultiplier(portion) {
  return PORTION_MULTIPLIERS[portion] || 1;
}

function mealKcal(state, plan, mealId) {
  if (mealId === MODIFIED_MEAL_ID) return plan.modifiedMeal ? plan.modifiedMeal.kcal : 0;
  const meal = state.meals.find((item) => item.id === mealId);
  return meal && Number.isFinite(meal.kcal) ? meal.kcal : 0;
}

export function loggedIntake(state, key) {
  const dayLog = state.days[key];
  const plan = classifyDay(state.fasting, key);
  if (!dayLog) return { kcal: 0, events: 0 };
  let kcal = 0;
  let events = 0;
  for (const [mealId, meal] of Object.entries(dayLog.meals || {})) {
    kcal += mealKcal(state, plan, mealId) * portionMultiplier(meal.portion);
    events += 1;
  }
  const snackKcal = Number.isFinite(state.profile.snackKcal) ? state.profile.snackKcal : DEFAULT_SNACK_KCAL;
  for (const snack of dayLog.snacks || []) {
    kcal += snackKcal * portionMultiplier(snack.portion);
    events += 1;
  }
  return { kcal: Math.round(kcal), events };
}

export function plannedIntake(state, key, fromMinute = -Infinity, toMinute = Infinity) {
  const plan = classifyDay(state.fasting, key);
  const dayLog = state.days[key];
  const window = effectiveWindow(plan, dayLog);
  if (!window) return 0;
  let kcal = 0;
  for (const entry of mealsForDay(state.meals, plan)) {
    if (plan.isFastingDay && !entry.isModified) continue;
    if (dayLog && dayLog.meals && dayLog.meals[entry.id]) continue;
    if (dayLog && dayLog.skips && dayLog.skips[entry.id]) continue;
    const minute = scheduledMinutes(entry, dayLog);
    const manual = dayLog && dayLog.manualTimes && Number.isFinite(dayLog.manualTimes[entry.id]);
    if ((!manual && !isInsideWindow(window, minute)) || minute < fromMinute || minute > toMinute) continue;
    kcal += mealKcal(state, plan, entry.id);
  }
  return Math.round(kcal);
}

function plannedFullDay(state, key) {
  const dayLog = state.days[key];
  const plan = classifyDay(state.fasting, key);
  let kcal = plannedIntake(state, key);
  if (dayLog) for (const mealId of Object.keys(dayLog.meals || {})) kcal += mealKcal(state, plan, mealId);
  return kcal;
}

export function intakeForDay(state, key, now) {
  const day = healthDay(state, key);
  const plan = classifyDay(state.fasting, key);
  const logged = loggedIntake(state, key);
  const fraction = elapsedFraction(key, now);
  const remainingFrom = fraction >= 1 ? Infinity : fraction <= 0 ? -Infinity : minutesOfDay(now);
  const remaining = fraction >= 1 ? 0 : plannedIntake(state, key, remainingFrom);
  const fullPlan = plannedIntake(state, key);
  const expected = plannedFullDay(state, key);
  const tooLow = (kcal) => fraction >= 1 && expected > 0 && kcal < expected * TRUSTED_INTAKE_FRACTION;
  if (state.health && state.health.nutrition && day && present(day.intake)) {
    if (tooLow(day.intake)) return { kcal: expected, source: 'estimated', projectedKcal: expected };
    return { kcal: Math.round(day.intake), source: 'health', projectedKcal: Math.round(day.intake) + remaining };
  }
  if (logged.events > 0 || (plan.isFastingDay && plan.fastingType === 'zero')) {
    if (tooLow(logged.kcal)) return { kcal: expected, source: 'estimated', projectedKcal: expected };
    return { kcal: logged.kcal, source: 'log', projectedKcal: logged.kcal + remaining };
  }
  if (fraction >= 1) return { kcal: fullPlan, source: 'plan', projectedKcal: fullPlan };
  const soFar = fraction <= 0 ? 0 : plannedIntake(state, key, -Infinity, minutesOfDay(now));
  return { kcal: soFar, source: 'plan', projectedKcal: fullPlan };
}

export function balanceToFatKg(balanceKcal) {
  return balanceKcal / KCAL_PER_KG_FAT;
}

export function glycogenDropForFastHours(hours) {
  if (!Number.isFinite(hours) || hours <= GLYCOGEN_FREE_HOURS) return 0;
  const ratio = Math.min(1, (hours - GLYCOGEN_FREE_HOURS) / (GLYCOGEN_FULL_DROP_HOURS - GLYCOGEN_FREE_HOURS));
  return -GLYCOGEN_MAX_DROP_KG * ratio;
}

export function glycogenLevelAfterDay({ intakeKcal, expenditureKcal, hoursFastedByMorning, previousLevel = 0 }) {
  const ratio = expenditureKcal > 0 ? intakeKcal / expenditureKcal : 1;
  let level;
  if (ratio <= FASTED_FRACTION) level = Math.min(previousLevel, glycogenDropForFastHours(hoursFastedByMorning));
  else if (ratio >= REFEED_FRACTION) level = 0;
  else level = previousLevel / 2;
  return Math.max(-GLYCOGEN_MAX_DROP_KG, Math.min(0, level));
}

function lastEatingBefore(state, endMs) {
  let latest = null;
  for (const dayLog of Object.values(state.days)) {
    for (const meal of Object.values(dayLog.meals || {})) if (meal.eatenAt <= endMs && (latest === null || meal.eatenAt > latest)) latest = meal.eatenAt;
    for (const snack of dayLog.snacks || []) if (snack.at <= endMs && (latest === null || snack.at > latest)) latest = snack.at;
  }
  return latest;
}

export function hoursFastedByMorning(state, key) {
  const morning = dateAtMinutes(addDaysToKey(key, 1), 7 * 60).getTime();
  const last = lastEatingBefore(state, dateAtMinutes(addDaysToKey(key, 1), 0).getTime());
  if (last === null) return 36;
  return (morning - last) / MS_PER_HOUR;
}

export function dayEnergy(state, key, now) {
  const expenditure = expenditureForDay(state, key, now);
  const intake = intakeForDay(state, key, now);
  const day = healthDay(state, key);
  return {
    key,
    expenditure,
    intake,
    balance: intake.kcal - expenditure.total,
    projectedBalance: intake.projectedKcal - expenditure.projectedTotal,
    steps: day && Number.isFinite(day.steps) ? day.steps : null,
    workouts: day && Array.isArray(day.workouts) ? day.workouts : [],
    partial: elapsedFraction(key, now) < 1,
  };
}

export function energyHistory(state, now, days = 14) {
  const todayKey = toDateKey(now);
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) result.push(dayEnergy(state, addDaysToKey(todayKey, -offset), now));
  return result;
}

export function emaAlphaForGap(gapDays, alpha = EMA_ALPHA) {
  if (gapDays <= 1) return alpha;
  return 1 - Math.pow(1 - alpha, gapDays);
}

export function emaTrend(weights, alpha = EMA_ALPHA) {
  const series = dailyWeights(weights);
  let trend = null;
  let previousKey = null;
  return series.map((point) => {
    const gap = previousKey === null ? 0 : daysBetween(previousKey, point.key);
    if (trend === null || gap > EMA_RESET_GAP_DAYS) trend = point.kg;
    else trend += emaAlphaForGap(gap, alpha) * (point.kg - trend);
    previousKey = point.key;
    return { ...point, trend };
  });
}

export function distinctWeighInDays(weights, now, days = 30) {
  const limit = days * MINUTES_PER_DAY * MS_PER_MINUTE;
  return new Set((weights || []).filter((entry) => now.getTime() - entry.at <= limit && entry.at <= now.getTime()).map((entry) => toDateKey(new Date(entry.at)))).size;
}

export function weightNeedsConfirmation(state, kg, at = Date.now()) {
  const weights = state.body ? state.body.weights : [];
  const recent = weights.filter((entry) => Math.abs(at - entry.at) <= WEIGHT_JUMP_DAYS * MINUTES_PER_DAY * MS_PER_MINUTE);
  if (recent.length === 0) return false;
  const reference = trendWeightKg(state);
  return Math.abs(kg - reference) / reference > WEIGHT_JUMP_FRACTION;
}

export function glycogenLevelThrough(state, key, now) {
  let level = 0;
  for (let offset = GLYCOGEN_LOOKBACK_DAYS - 1; offset >= 0; offset -= 1) {
    const dayKey = addDaysToKey(key, -offset);
    const energy = dayEnergy(state, dayKey, now);
    level = glycogenLevelAfterDay({
      intakeKcal: energy.intake.projectedKcal,
      expenditureKcal: energy.expenditure.projectedTotal,
      hoursFastedByMorning: hoursFastedByMorning(state, dayKey),
      previousLevel: level,
    });
  }
  return level;
}

export function uncertaintyKg(weighInsLast30) {
  return Math.min(1.2, Math.max(0.35, 0.35 + 0.9 / Math.sqrt(weighInsLast30 + 1)));
}

export function averageBalance(state, now) {
  const todayKey = toDateKey(now);
  const values = [];
  for (let offset = 1; offset <= BALANCE_WINDOW_DAYS; offset += 1) {
    const energy = dayEnergy(state, addDaysToKey(todayKey, -offset), now);
    if (energy.partial || !['health', 'log'].includes(energy.intake.source) || energy.expenditure.fallback) continue;
    values.push(energy.balance);
  }
  if (values.length < MIN_BALANCE_DAYS) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function trendSlope(trend) {
  if (trend.length < MIN_WEIGH_INS) return null;
  const last = trend[trend.length - 1];
  const reference = [...trend].reverse().find((point) => daysBetween(point.key, last.key) >= 7) || trend[0];
  const span = daysBetween(reference.key, last.key);
  if (span <= 0) return null;
  return (last.trend - reference.trend) / span;
}

export function weightProjection(state, now, days = PROJECTION_DAYS) {
  const trend = emaTrend(state.body ? state.body.weights : []);
  const start = trend.length > 0 ? trend[trend.length - 1].trend : latestWeightKg(state);
  const balance = averageBalance(state, now);
  let slope = null;
  let source = 'none';
  if (balance !== null) {
    slope = balanceToFatKg(balance);
    source = 'balance';
  } else {
    const fromTrend = trendSlope(trend);
    if (fromTrend !== null) {
      slope = fromTrend;
      source = 'trend';
    }
  }
  const todayKey = toDateKey(now);
  const points = slope === null ? [] : Array.from({ length: days }, (_, index) => ({ key: addDaysToKey(todayKey, index + 1), kg: start + slope * (index + 1) }));
  return { start, slope, source, points, trend, weighIns: trend.length };
}

export function goalEstimate({ goalKg, currentKg, slope, weighIns, now }) {
  if (!Number.isFinite(goalKg)) return { status: 'noGoal' };
  if (Math.abs(goalKg - currentKg) < 0.2) return { status: 'reached' };
  if (weighIns < MIN_WEIGH_INS || slope === null || slope === 0) return { status: 'insufficient' };
  const needed = goalKg - currentKg;
  if (Math.sign(needed) !== Math.sign(slope)) return { status: 'wrongWay' };
  const days = Math.ceil(needed / slope);
  if (days > MAX_GOAL_DAYS) return { status: 'tooFar' };
  return { status: 'estimated', days, date: toDateKey(new Date(now.getTime() + days * MINUTES_PER_DAY * MS_PER_MINUTE)) };
}

export function forecastTomorrow(state, now) {
  const todayKey = toDateKey(now);
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const trend = emaTrend(state.body ? state.body.weights : []);
  const base = trend.length > 0 ? trend[trend.length - 1].trend : latestWeightKg(state);
  const today = dayEnergy(state, todayKey, now);
  const previousLevel = glycogenLevelThrough(state, yesterdayKey, now);
  const todayLevel = glycogenLevelAfterDay({
    intakeKcal: today.intake.projectedKcal,
    expenditureKcal: today.expenditure.projectedTotal,
    hoursFastedByMorning: hoursFastedByMorning(state, todayKey),
    previousLevel,
  });
  const fat = balanceToFatKg(today.projectedBalance);
  const glycogen = todayLevel - previousLevel;
  const recent = distinctWeighInDays(state.body ? state.body.weights : [], now);
  const spread = uncertaintyKg(recent);
  const kg = base + fat + glycogen;
  return {
    key: addDaysToKey(todayKey, 1),
    kg,
    low: kg - spread,
    high: kg + spread,
    base,
    fatKg: fat,
    glycogenKg: glycogen,
    intake: today.intake,
    expenditure: today.expenditure,
    balance: today.projectedBalance,
    weighIns: recent,
  };
}
