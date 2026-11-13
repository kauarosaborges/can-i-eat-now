import { t } from '../i18n/index.js';
import { BODY_FAT_LIMITS, createBodyEntryId, mergeWeights, roundKg } from '../core/body.js';
import {
  HEALTH_GROUPS,
  HEALTH_GROUP_TYPES,
  HEALTH_WRITE_FLAGS,
  addIgnored,
  dailyFromSamples,
  dayChunks,
  healthWriteTypes,
  mergeHealthSync,
  missingHealthTypes,
  removeIgnored,
  requiredHealthTypes,
  stripHealthGroup,
  syncStartDate,
  validWeight,
  withLatestWeight,
  withRequestedTypes,
} from '../core/healthMerge.js';
import { weightNeedsConfirmation } from '../core/energy.js';
import { validateReading } from '../core/bloodPressure.js';
import { createDefaultMeasurements } from '../core/storage.js';
import { MS_PER_HOUR, isValidDateKey, toDateKey } from '../core/time.js';
import { showToast } from './feedback.js';
import { bumpHealthEpoch, currentHealthEpoch, trackHealthSync } from './healthEpoch.js';
import { formatKg } from './format.js';
import { nativePlugin } from './platform.js';

export { HEALTH_GROUP_TYPES };
const SYNC_DAYS = 30;
const SAMPLE_LIMIT = 10000;
const CHUNK_DAYS = 5;
const AUTH_RETRY_MS = 6 * 60 * 60 * 1000;
const WORKOUT_LIMITS = { kcal: 20000, minutes: 1440 };
const WEIGHT_HISTORY_DAYS = 365;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const AGGREGATES = [
  { dataType: 'basalCalories', field: 'basal', group: 'activity', aggregation: 'sum', fallback: true },
  { dataType: 'calories', field: 'active', group: 'activity', aggregation: 'sum' },
  { dataType: 'totalCalories', field: 'total', group: 'activity', aggregation: 'sum' },
  { dataType: 'steps', field: 'steps', group: 'activity', aggregation: 'sum' },
  { dataType: 'exerciseTime', field: 'exerciseMinutes', group: 'activity', aggregation: 'sum', fallback: true },
  { dataType: 'distance', field: 'distanceM', group: 'activity', aggregation: 'sum' },
  { dataType: 'flightsClimbed', field: 'flights', group: 'activity', aggregation: 'sum', fallback: true },
  { dataType: 'dietaryEnergyConsumed', field: 'intake', group: 'nutrition', aggregation: 'sum' },
  { dataType: 'restingHeartRate', field: 'restingHr', group: 'heart', aggregation: 'average' },
  { dataType: 'heartRate', field: 'avgHr', group: 'heart', aggregation: 'average' },
  { dataType: 'heartRateVariability', field: 'hrv', group: 'heart', aggregation: 'average', samplesOnly: true, keyBy: 'end' },
  { dataType: 'respiratoryRate', field: 'respiratory', group: 'heart', aggregation: 'average', samplesOnly: true, decimals: 1, keyBy: 'end' },
];

export function createBodyActions(store) {
  let lastSync = 0;
  let registering = false;
  let authRetryAt = 0;

  function health() {
    return nativePlugin('Health');
  }

  async function writeWeightToHealth(entry) {
    const plugin = health();
    if (!plugin || !store.state.health.writeWeight) return false;
    try {
      const iso = new Date(entry.at).toISOString();
      await plugin.saveSample({ dataType: 'weight', value: entry.kg, unit: 'kilogram', startDate: iso, endDate: iso });
      const state = store.state;
      store.replace({ ...state, body: { ...state.body, weights: state.body.weights.map((item) => (item.id === entry.id ? { ...item, healthWritten: true } : item)) } }, 'body');
      return true;
    } catch {
      showToast(t('toast.healthWriteFailed'), { tone: 'warning' });
      return false;
    }
  }

  function removeWeightEntry(entry) {
    const state = store.state;
    let body = { ...state.body, weights: state.body.weights.filter((item) => item.id !== entry.id) };
    const current = state.body.weights.find((item) => item.id === entry.id) || entry;
    if (current.source === 'health' || current.healthWritten) body = addIgnored(body, current);
    store.replace(withLatestWeight(state, body), 'body');
  }

  async function aggregate(plugin, item, startDate, endDate) {
    try {
      const result = await plugin.queryAggregated({ dataType: item.dataType, startDate, endDate, bucket: 'day', aggregation: item.aggregation });
      const samples = result && Array.isArray(result.samples) ? result.samples : [];
      const days = {};
      for (const sample of samples) {
        const key = toDateKey(new Date(sample.startDate));
        const raw = sample.values && Number.isFinite(sample.values[item.aggregation]) ? sample.values[item.aggregation] : sample.value;
        if (Number.isFinite(raw) && raw >= 0) days[key] = raw;
      }
      return days;
    } catch {
      return null;
    }
  }

  async function readSamples(plugin, dataType, days, limit = 1000) {
    try {
      const now = new Date();
      const result = await plugin.readSamples({ dataType, startDate: new Date(now.getTime() - days * 24 * MS_PER_HOUR).toISOString(), endDate: now.toISOString(), limit, ascending: false });
      return result && Array.isArray(result.samples) ? result.samples : [];
    } catch {
      return [];
    }
  }

  async function readRange(plugin, dataType, start, end) {
    try {
      const result = await plugin.readSamples({ dataType, startDate: start.toISOString(), endDate: end.toISOString(), limit: SAMPLE_LIMIT, ascending: false });
      return result && Array.isArray(result.samples) ? result.samples : [];
    } catch {
      return [];
    }
  }

  async function dailyValues(plugin, item, startDate, endDate, now) {
    const aggregated = item.samplesOnly ? null : await aggregate(plugin, item, startDate, endDate);
    if (aggregated !== null || !(item.fallback || item.samplesOnly)) return aggregated || {};
    const result = {};
    for (const chunk of dayChunks(now, SYNC_DAYS, CHUNK_DAYS)) {
      const samples = await readRange(plugin, item.dataType, chunk.start, chunk.end);
      Object.assign(result, dailyFromSamples(samples, item.aggregation, { truncated: samples.length >= SAMPLE_LIMIT, decimals: item.decimals || 0, keyBy: item.keyBy || 'start' }));
    }
    return result;
  }

  async function ensureAuthorization(plugin) {
    const health = store.state.health;
    const missing = missingHealthTypes(health);
    if (missing.length === 0 || Date.now() < authRetryAt) return;
    try {
      await plugin.requestAuthorization({ read: requiredHealthTypes(health), write: healthWriteTypes(health) });
    } catch {
      authRetryAt = Date.now() + AUTH_RETRY_MS;
      return;
    }
    store.replace({ ...store.state, health: withRequestedTypes(store.state.health, missing) }, 'healthSync');
  }

  async function syncHealth(force = false) {
    const plugin = health();
    if (!plugin || !HEALTH_GROUPS.some((group) => store.state.health[group])) return false;
    const now = new Date();
    if (!force && now.getTime() - lastSync < SYNC_INTERVAL_MS) return false;
    lastSync = now.getTime();
    return trackHealthSync(() => runSync(plugin, now));
  }

  async function runSync(plugin, now) {
    const epoch = currentHealthEpoch();
    await ensureAuthorization(plugin);
    const groups = store.state.health;
    const startDate = syncStartDate(now, SYNC_DAYS).toISOString();
    const endDate = now.toISOString();
    const snapshot = { body: null, days: {}, bloodPressure: null };
    if (groups.body) {
      const weights = (await readSamples(plugin, 'weight', WEIGHT_HISTORY_DAYS))
        .map((sample) => ({ at: Date.parse(sample.endDate || sample.startDate), kg: roundKg(sample.value) }))
        .filter((entry) => Number.isFinite(entry.at) && validWeight(entry.kg))
        .map((entry) => ({ id: createBodyEntryId('kg', entry.at), ...entry, source: 'health' }));
      const fat = (await readSamples(plugin, 'bodyFat', WEIGHT_HISTORY_DAYS))
        .map((sample) => ({ at: Date.parse(sample.endDate || sample.startDate), pct: roundKg(sample.value <= 1 ? sample.value * 100 : sample.value) }))
        .filter((entry) => Number.isFinite(entry.at) && entry.pct >= BODY_FAT_LIMITS.min && entry.pct <= BODY_FAT_LIMITS.max)
        .map((entry) => ({ id: createBodyEntryId('bf', entry.at), ...entry, source: 'health' }));
      const heights = await readSamples(plugin, 'height', WEIGHT_HISTORY_DAYS * 5);
      let heightCm = null;
      if (heights.length > 0) {
        const value = heights[0].value <= 3 ? heights[0].value * 100 : heights[0].value;
        if (value >= 100 && value <= 250) heightCm = Math.round(value);
      }
      snapshot.body = { weights, fat, heightCm };
    }
    if (groups.heart) {
      snapshot.bloodPressure = (await readSamples(plugin, 'bloodPressure', WEIGHT_HISTORY_DAYS))
        .map((sample) => ({ at: Date.parse(sample.endDate || sample.startDate), systolic: Math.round(sample.systolic), diastolic: Math.round(sample.diastolic), pulse: null }))
        .filter((entry) => Number.isFinite(entry.at) && validateReading(entry) === null)
        .map((entry) => ({ id: createBodyEntryId('bp', entry.at), ...entry, count: 1, source: 'health' }));
    }
    const touch = (key) => {
      if (!isValidDateKey(key)) return null;
      snapshot.days[key] = snapshot.days[key] || {};
      return snapshot.days[key];
    };
    for (const item of AGGREGATES) {
      if (!groups[item.group]) continue;
      const factor = 10 ** (item.decimals || 0);
      for (const [key, value] of Object.entries(await dailyValues(plugin, item, startDate, endDate, now))) {
        const day = touch(key);
        const rounded = Math.round(value * factor) / factor;
        if (day && Number.isFinite(rounded) && rounded >= 0) day[item.field] = rounded;
      }
    }
    if (groups.activity) {
      try {
        const result = await plugin.queryWorkouts({ startDate, endDate, limit: 200, ascending: false });
        const byDay = {};
        for (const workout of result && Array.isArray(result.workouts) ? result.workouts : []) {
          const start = Date.parse(workout && workout.startDate);
          if (!Number.isFinite(start)) continue;
          const key = toDateKey(new Date(start));
          const kcal = Number.isFinite(workout.totalEnergyBurned) && workout.totalEnergyBurned >= 0 && workout.totalEnergyBurned <= WORKOUT_LIMITS.kcal ? Math.round(workout.totalEnergyBurned) : null;
          const minutes = Number.isFinite(workout.duration) && workout.duration >= 0 ? Math.min(WORKOUT_LIMITS.minutes, Math.round(workout.duration / 60)) : 0;
          const type = typeof workout.workoutType === 'string' ? workout.workoutType.replace(/[^A-Za-z]/g, '').slice(0, 40) || 'other' : 'other';
          (byDay[key] = byDay[key] || []).push({ type, kcal, minutes });
        }
        for (const [key, workouts] of Object.entries(byDay)) {
          const day = touch(key);
          if (day) day.workouts = workouts;
        }
      } catch {
        lastSync = 0;
      }
    }
    if (epoch !== currentHealthEpoch()) return false;
    store.replace(mergeHealthSync(store.state, snapshot), 'healthSync');
    return true;
  }

  return {
    healthAvailable() {
      return Boolean(health());
    },
    needsConfirmation(kg) {
      return weightNeedsConfirmation(store.state, kg);
    },
    addWeight(kg, { at = Date.now(), confirmed = false } = {}) {
      if (!validWeight(kg)) return { ok: false, reason: 'invalid' };
      if (!confirmed && weightNeedsConfirmation(store.state, kg, at)) return { ok: false, reason: 'confirm' };
      if (registering) return { ok: false, reason: 'busy' };
      registering = true;
      setTimeout(() => {
        registering = false;
      }, 800);
      const state = store.state;
      const entry = { id: createBodyEntryId('kg', at), at, kg: roundKg(kg), source: 'manual' };
      store.replace(withLatestWeight(state, { ...state.body, weights: mergeWeights(state.body.weights, [entry]) }), 'body');
      showToast(t('toast.weightLogged', { kg: formatKg(entry.kg) }), { tone: 'success', action: { label: t('common.undo'), onClick: () => removeWeightEntry(entry) } });
      writeWeightToHealth(entry);
      return { ok: true, entry };
    },
    updateWeight(id, kg) {
      if (!validWeight(kg)) return { ok: false, reason: 'invalid' };
      const state = store.state;
      const old = state.body.weights.find((entry) => entry.id === id && entry.source === 'manual');
      if (!old) return { ok: false, reason: 'missing' };
      const updated = { ...old, kg: roundKg(kg), healthWritten: false };
      let body = { ...state.body, weights: state.body.weights.map((entry) => (entry.id === id ? updated : entry)) };
      if (old.healthWritten) body = addIgnored(body, old);
      store.replace(withLatestWeight(state, body), 'body');
      if (old.healthWritten) writeWeightToHealth(updated);
      return { ok: true };
    },
    isInHealth(entry) {
      return entry.source === 'health' || entry.healthWritten === true;
    },
    deleteWeight(id) {
      const state = store.state;
      const removed = state.body.weights.find((entry) => entry.id === id);
      if (!removed) return;
      removeWeightEntry(removed);
      showToast(t('toast.weightDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            const current = store.state;
            store.replace(withLatestWeight(current, removeIgnored({ ...current.body, weights: mergeWeights(current.body.weights, [removed]) }, removed)), 'body');
          },
        },
      });
    },
    setGoal(kg) {
      const state = store.state;
      const goalKg = validWeight(kg) ? roundKg(kg) : null;
      store.replace({ ...state, body: { ...state.body, goalKg } }, 'body');
    },
    setBodyFat(pct) {
      if (!Number.isFinite(pct) || pct < BODY_FAT_LIMITS.min || pct > BODY_FAT_LIMITS.max) return false;
      const state = store.state;
      const at = Date.now();
      store.replace({ ...state, body: { ...state.body, fat: [...state.body.fat, { id: createBodyEntryId('bf', at), at, pct: roundKg(pct), source: 'manual' }] } }, 'body');
      return true;
    },
    updateProfile(changes) {
      const state = store.state;
      const profile = { ...state.profile, ...changes };
      if (Object.prototype.hasOwnProperty.call(changes, 'heightCm')) profile.heightSource = 'manual';
      store.replace({ ...state, profile }, 'body');
    },
    syncHealth,
    async setHealthGroup(group, enabled) {
      const state = store.state;
      const plugin = health();
      const nextGroups = { ...state.health, [group]: enabled };
      if (enabled) {
        if (!plugin) return false;
        const read = requiredHealthTypes(nextGroups);
        try {
          await plugin.requestAuthorization({ read, write: healthWriteTypes(nextGroups) });
        } catch {
          showToast(t('toast.healthDenied'), { tone: 'warning' });
          return false;
        }
        store.replace({ ...store.state, health: withRequestedTypes({ ...store.state.health, [group]: true }, read) }, 'body');
        await syncHealth(true);
        return true;
      }
      store.replace(stripHealthGroup({ ...state, health: nextGroups }, group), 'body');
      return false;
    },
    async setHealthWrite(flag, enabled) {
      const plugin = health();
      const type = HEALTH_WRITE_FLAGS[flag];
      if (!type) return false;
      if (enabled) {
        if (!plugin) return false;
        try {
          await plugin.requestAuthorization({ read: [], write: [type] });
        } catch {
          showToast(t('toast.healthDenied'), { tone: 'warning' });
          return false;
        }
      }
      store.replace({ ...store.state, health: { ...store.state.health, [flag]: enabled } }, 'body');
      return enabled;
    },
    async saveHealthSample(flag, options) {
      const plugin = health();
      if (!plugin || !store.state.health[flag]) return false;
      try {
        await plugin.saveSample(options);
        return true;
      } catch {
        showToast(t('toast.healthWriteFailed'), { tone: 'warning' });
        return false;
      }
    },
    clearBodyAndActivity() {
      bumpHealthEpoch();
      const state = store.state;
      const body = { ...state.body, weights: state.body.weights.filter((entry) => entry.source !== 'health'), fat: state.body.fat.filter((entry) => entry.source !== 'health'), healthHeightCm: null, ignoredHealthFat: [] };
      const measurements = { ...state.measurements, bloodPressure: state.measurements.bloodPressure.filter((entry) => entry.source !== 'health'), ignoredHealthPressure: [] };
      store.replace(withLatestWeight({ ...state, energy: { days: {} }, measurements }, body), 'body');
      lastSync = 0;
    },
    clearAllHealthData(defaults) {
      bumpHealthEpoch();
      const state = store.state;
      store.replace(
        {
          ...state,
          body: { weights: [], fat: [], goalKg: null, healthHeightCm: null, ignoredHealth: [], ignoredHealthFat: [] },
          health: { body: false, activity: false, nutrition: false, heart: false, writeWeight: false, writeBodyFat: false, writeBloodPressure: false, requested: [] },
          energy: { days: {} },
          measurements: createDefaultMeasurements(),
          activity: [],
          sleep: { log: [], healthEnabled: false, nightAwakeAt: null },
          profile: { ...state.profile, heightCm: defaults.heightCm, heightSource: null, birthDate: null, sex: defaults.sex, weightKg: defaults.weightKg },
        },
        'body',
      );
      store.clearBackups();
      lastSync = 0;
    },
  };
}
