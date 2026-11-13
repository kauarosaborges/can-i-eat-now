import { latestWeightKg } from './body.js';
import { sessionResults } from './bodyComposition.js';
import { classify } from './bodyReferences.js';
import { categoryStatus, classifyBloodPressure } from './bloodPressure.js';
import { emaTrend } from './energy.js';
import { buildHistory } from './history.js';
import { computeDailyGoal, totalWaterMl } from './hydration.js';
import { lastNightKey, scoreNight, sleepSeries } from './sleepQuality.js';
import { MS_PER_DAY, addDaysToKey, toDateKey } from './time.js';

export const SUMMARY_DAYS = 7;
export const WEIGHT_SPARK_DAYS = 30;
export const MEASURE_SUMMARY_DAYS = 120;

function dayValue(state, key, field) {
  const day = state.energy && state.energy.days ? state.energy.days[key] : null;
  return day && Number.isFinite(day[field]) ? day[field] : null;
}

export function dailyMetric(state, now, field, days = SUMMARY_DAYS) {
  const todayKey = toDateKey(now);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = addDaysToKey(todayKey, -offset);
    series.push({ key, isToday: key === todayKey, value: dayValue(state, key, field) });
  }
  const withValue = series.filter((item) => item.value !== null);
  if (withValue.length === 0) return null;
  const latest = withValue[withValue.length - 1];
  const previous = withValue.filter((item) => !item.isToday);
  const average = previous.length > 0 ? previous.reduce((sum, item) => sum + item.value, 0) / previous.length : null;
  return { series, latest: { key: latest.key, value: latest.value, daysAgo: series.length - 1 - series.indexOf(latest) }, average };
}

function weightSummary(state, now) {
  const weights = state.body && Array.isArray(state.body.weights) ? state.body.weights : [];
  const since = now.getTime() - WEIGHT_SPARK_DAYS * MS_PER_DAY;
  const points = weights.filter((entry) => entry.at >= since && entry.at <= now.getTime()).sort((left, right) => left.at - right.at).map((entry) => ({ at: entry.at, kg: entry.kg }));
  const trend = emaTrend(weights);
  const trendNow = trend.length > 0 ? trend[trend.length - 1].trend : null;
  const weekAgo = [...trend].reverse().find((point) => now.getTime() - point.at >= 6.5 * MS_PER_DAY);
  const latestEntry = weights.reduce((latest, entry) => (!latest || entry.at > latest.at ? entry : latest), null);
  return {
    kg: latestWeightKg(state),
    at: latestEntry ? latestEntry.at : null,
    logged: weights.length > 0,
    weekChange: trendNow !== null && weekAgo ? Math.round((trendNow - weekAgo.trend) * 10) / 10 : null,
    points,
  };
}

function waterSummary(state, now) {
  const todayKey = toDateKey(now);
  const goalMl = computeDailyGoal(state.profile).goalMl;
  const series = [];
  for (let offset = SUMMARY_DAYS - 1; offset >= 0; offset -= 1) {
    const key = addDaysToKey(todayKey, -offset);
    series.push({ key, isToday: key === todayKey, value: totalWaterMl(state.days[key] ? state.days[key].water : []) });
  }
  return { ml: series[series.length - 1].value, goalMl, ratio: goalMl > 0 ? series[series.length - 1].value / goalMl : 0, series };
}

function sleepSummary(state, now) {
  const key = lastNightKey(state, now);
  const series = sleepSeries(state, now, SUMMARY_DAYS);
  return { key, night: scoreNight(state, key), series, hasAny: series.some((item) => item.entry) };
}

function historySummary(state, now) {
  const history = buildHistory(state, now, SUMMARY_DAYS);
  return { streak: history.streak, averageHours: history.averageHours, entries: history.entries };
}

export function pressureSummary(state, now) {
  const entries = state.measurements ? state.measurements.bloodPressure : [];
  const since = now.getTime() - MEASURE_SUMMARY_DAYS * MS_PER_DAY;
  const recent = entries.filter((entry) => entry.at >= since && entry.at <= now.getTime() + 60000);
  if (recent.length === 0) return null;
  const latest = recent[recent.length - 1];
  const category = classifyBloodPressure(latest.systolic, latest.diastolic);
  return { systolic: latest.systolic, diastolic: latest.diastolic, at: latest.at, category, status: categoryStatus(category) };
}

export function bodyFatSummary(state, now) {
  const sessions = state.measurements ? state.measurements.sessions : [];
  const since = now.getTime() - MEASURE_SUMMARY_DAYS * MS_PER_DAY;
  for (let index = sessions.length - 1; index >= 0 && sessions[index].at >= since; index -= 1) {
    const session = sessions[index];
    const result = sessionResults(session);
    if (Number.isFinite(result.fatPct)) return { pct: result.fatPct, at: session.at, source: result.fatSource, status: classify('fat', result.fatPct, { sex: session.sex, age: session.age }) };
  }
  return null;
}

export function buildSummary(state, now) {
  return {
    sleep: sleepSummary(state, now),
    water: waterSummary(state, now),
    weight: weightSummary(state, now),
    steps: dailyMetric(state, now, 'steps'),
    active: dailyMetric(state, now, 'active'),
    exercise: dailyMetric(state, now, 'exerciseMinutes'),
    distance: dailyMetric(state, now, 'distanceM'),
    flights: dailyMetric(state, now, 'flights'),
    restingHr: dailyMetric(state, now, 'restingHr'),
    avgHr: dailyMetric(state, now, 'avgHr'),
    hrv: dailyMetric(state, now, 'hrv'),
    respiratory: dailyMetric(state, now, 'respiratory'),
    history: historySummary(state, now),
    pressure: pressureSummary(state, now),
    bodyFat: bodyFatSummary(state, now),
  };
}
