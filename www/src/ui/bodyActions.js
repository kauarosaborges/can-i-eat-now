import { t } from '../i18n/index.js';
import { BODY_FAT_LIMITS, createBodyEntryId, mergeWeights, roundKg } from '../core/body.js';
import { addIgnored, mergeHealthSync, removeIgnored, stripHealthGroup, validWeight, withLatestWeight } from '../core/healthMerge.js';
import { weightNeedsConfirmation } from '../core/energy.js';
import { MS_PER_HOUR, isValidDateKey, toDateKey } from '../core/time.js';
import { showToast } from './feedback.js';
import { formatKg } from './format.js';
import { nativePlugin } from './platform.js';

export const HEALTH_GROUP_TYPES = {
  body: ['weight', 'height', 'bodyFat'],
  activity: ['calories', 'basalCalories', 'totalCalories', 'steps', 'exerciseTime', 'workouts'],
  nutrition: ['dietaryEnergyConsumed'],
};
const SYNC_DAYS = 30;
const WEIGHT_HISTORY_DAYS = 365;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const AGGREGATES = [
  { dataType: 'basalCalories', field: 'basal', group: 'activity' },
  { dataType: 'calories', field: 'active', group: 'activity' },
  { dataType: 'totalCalories', field: 'total', group: 'activity' },
  { dataType: 'steps', field: 'steps', group: 'activity' },
  { dataType: 'exerciseTime', field: 'exerciseMinutes', group: 'activity' },
  { dataType: 'dietaryEnergyConsumed', field: 'intake', group: 'nutrition' },
];

export function createBodyActions(store) {
  let lastSync = 0;
  let registering = false;

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

  async function aggregate(plugin, dataType, startDate, endDate) {
    try {
      const result = await plugin.queryAggregated({ dataType, startDate, endDate, bucket: 'day', aggregation: 'sum' });
      return result && Array.isArray(result.samples) ? result.samples : [];
    } catch {
      return [];
    }
  }

  async function readSamples(plugin, dataType, days) {
    try {
      const now = new Date();
      const result = await plugin.readSamples({ dataType, startDate: new Date(now.getTime() - days * 24 * MS_PER_HOUR).toISOString(), endDate: now.toISOString(), limit: 1000, ascending: false });
      return result && Array.isArray(result.samples) ? result.samples : [];
    } catch {
      return [];
    }
  }

  async function syncHealth(force = false) {
    const plugin = health();
    const groups = store.state.health;
    if (!plugin || !(groups.body || groups.activity || groups.nutrition)) return false;
    const now = new Date();
    if (!force && now.getTime() - lastSync < SYNC_INTERVAL_MS) return false;
    lastSync = now.getTime();
    const startDate = new Date(now.getTime() - SYNC_DAYS * 24 * MS_PER_HOUR).toISOString();
    const endDate = now.toISOString();
    const snapshot = { body: null, days: {} };
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
    const touch = (key) => {
      if (!isValidDateKey(key)) return null;
      snapshot.days[key] = snapshot.days[key] || {};
      return snapshot.days[key];
    };
    for (const item of AGGREGATES) {
      if (!groups[item.group]) continue;
      for (const sample of await aggregate(plugin, item.dataType, startDate, endDate)) {
        const day = touch(toDateKey(new Date(sample.startDate)));
        const value = sample.values && Number.isFinite(sample.values.sum) ? sample.values.sum : sample.value;
        if (day && Number.isFinite(value) && value >= 0) day[item.field] = Math.round(value);
      }
    }
    if (groups.activity) {
      try {
        const result = await plugin.queryWorkouts({ startDate, endDate, limit: 200, ascending: false });
        const byDay = {};
        for (const workout of result && Array.isArray(result.workouts) ? result.workouts : []) {
          const key = toDateKey(new Date(workout.startDate));
          (byDay[key] = byDay[key] || []).push({ type: workout.workoutType, kcal: workout.totalEnergyBurned, minutes: Math.round((workout.duration || 0) / 60) });
        }
        for (const [key, workouts] of Object.entries(byDay)) {
          const day = touch(key);
          if (day) day.workouts = workouts;
        }
      } catch {
        lastSync = 0;
      }
    }
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
        const read = Object.entries(HEALTH_GROUP_TYPES).filter(([name]) => nextGroups[name]).flatMap(([, types]) => types);
        try {
          await plugin.requestAuthorization({ read, write: nextGroups.writeWeight ? ['weight'] : [] });
        } catch {
          showToast(t('toast.healthDenied'), { tone: 'warning' });
          return false;
        }
        store.replace({ ...store.state, health: { ...store.state.health, [group]: true } }, 'body');
        await syncHealth(true);
        return true;
      }
      store.replace(stripHealthGroup({ ...state, health: nextGroups }, group), 'body');
      return false;
    },
    async setWriteWeight(enabled) {
      const plugin = health();
      if (enabled) {
        if (!plugin) return false;
        try {
          await plugin.requestAuthorization({ read: [], write: ['weight'] });
        } catch {
          showToast(t('toast.healthDenied'), { tone: 'warning' });
          return false;
        }
      }
      store.replace({ ...store.state, health: { ...store.state.health, writeWeight: enabled } }, 'body');
      return enabled;
    },
    clearBodyAndActivity() {
      const state = store.state;
      const body = { ...state.body, weights: state.body.weights.filter((entry) => entry.source !== 'health'), fat: state.body.fat.filter((entry) => entry.source !== 'health'), healthHeightCm: null };
      store.replace(withLatestWeight({ ...state, energy: { days: {} } }, body), 'body');
      lastSync = 0;
    },
    clearAllHealthData(defaults) {
      const state = store.state;
      store.replace(
        {
          ...state,
          body: { weights: [], fat: [], goalKg: null, healthHeightCm: null, ignoredHealth: [] },
          health: { body: false, activity: false, nutrition: false, writeWeight: false },
          energy: { days: {} },
          activity: [],
          sleep: { log: [], healthEnabled: false, nightAwakeAt: null },
          profile: { ...state.profile, heightCm: defaults.heightCm, heightSource: null, birthDate: null, sex: defaults.sex, weightKg: defaults.weightKg },
        },
        'body',
      );
      lastSync = 0;
    },
  };
}
