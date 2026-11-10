import { t } from '../i18n/index.js';
import {
  HEALTH_LOOKBACK_HOURS,
  awakeNightEntry,
  currentNightKey,
  recordActivity,
  removeHealthEntries,
  removeNightEntries,
  restoreNightEntries,
  sameDetail,
  sessionFromHealthSamples,
  sleepEntryForDay,
  upsertSleepEntry,
  vitalsInWindow,
} from '../core/sleep.js';
import { MS_PER_HOUR, addDaysToKey } from '../core/time.js';
import { showToast } from './feedback.js';
import { bumpHealthEpoch, currentHealthEpoch, trackHealthSync } from './healthEpoch.js';
import { nativePlugin } from './platform.js';

const HEALTH_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const NIGHT_VITALS = [
  { dataType: 'heartRate', field: 'hr', decimals: 0 },
  { dataType: 'heartRateVariability', field: 'hrv', decimals: 0 },
  { dataType: 'respiratoryRate', field: 'resp', decimals: 1 },
];

export function createSleepActions(store) {
  let lastHealthSync = 0;

  function healthPlugin() {
    return nativePlugin('Health');
  }

  function saveSleep(entry, reason = 'sleep') {
    const state = store.state;
    const log = upsertSleepEntry(state.sleep.log, state.profile, entry, Date.now());
    store.replace({ ...state, sleep: { ...state.sleep, log, nightAwakeAt: null } }, reason);
  }

  async function nightVitals(plugin, session) {
    const vitals = {};
    for (const item of NIGHT_VITALS) {
      try {
        const result = await plugin.readSamples({ dataType: item.dataType, startDate: new Date(session.sleptAt).toISOString(), endDate: new Date(session.wokeAt).toISOString(), limit: 2000, ascending: true });
        const value = vitalsInWindow(result && Array.isArray(result.samples) ? result.samples : [], session.sleptAt, session.wokeAt, item.decimals);
        if (value !== null) vitals[item.field] = value;
      } catch {
        continue;
      }
    }
    return vitals;
  }

  async function syncHealth(force = false, notifyEmpty = false) {
    const plugin = healthPlugin();
    if (!plugin || !store.state.sleep.healthEnabled) return false;
    const now = new Date();
    if (!force && now.getTime() - lastHealthSync < HEALTH_SYNC_INTERVAL_MS) return false;
    lastHealthSync = now.getTime();
    return trackHealthSync(() => runSync(plugin, now, notifyEmpty));
  }

  async function runSync(plugin, now, notifyEmpty) {
    const epoch = currentHealthEpoch();
    let samples = [];
    try {
      const result = await plugin.readSamples({
        dataType: 'sleep',
        startDate: new Date(now.getTime() - HEALTH_LOOKBACK_HOURS * MS_PER_HOUR).toISOString(),
        endDate: now.toISOString(),
        limit: 1000,
        ascending: false,
      });
      samples = result && Array.isArray(result.samples) ? result.samples : [];
    } catch {
      lastHealthSync = 0;
      if (notifyEmpty) showToast(t('toast.healthEmpty'), { tone: 'warning', duration: 8000 });
      return false;
    }
    const profile = store.state.profile;
    const currentKey = currentNightKey(profile, now);
    const sessions = [currentKey, addDaysToKey(currentKey, -1)].map((key) => sessionFromHealthSamples(samples, now, profile, key)).filter(Boolean);
    if (sessions.length === 0) {
      if (notifyEmpty && samples.length === 0) showToast(t('toast.healthEmpty'), { tone: 'warning', duration: 8000 });
      return false;
    }
    let changed = false;
    for (const session of sessions) {
      if (store.state.health.heart) {
        const vitals = await nightVitals(plugin, session);
        if (session.detail && Object.keys(vitals).length > 0) session.detail = { ...session.detail, ...vitals };
      }
      if (epoch !== currentHealthEpoch() || !store.state.sleep.healthEnabled) return false;
      const current = sleepEntryForDay(store.state.sleep.log, store.state.profile, session.wakeKey);
      if (current && current.source === 'health' && current.sleptAt === session.sleptAt && current.wokeAt === session.wokeAt && sameDetail(current.detail, session.detail)) continue;
      saveSleep(session);
      changed = true;
    }
    return changed;
  }

  return {
    healthAvailable() {
      return Boolean(healthPlugin());
    },
    confirmSleep(sleptAt, wokeAt, wakeKey) {
      saveSleep({ wakeKey, sleptAt, wokeAt, source: 'confirmed', kind: 'night' });
      showToast(t('toast.sleepSaved'), { tone: 'success' });
    },
    markNoSleep(wakeKey) {
      saveSleep(awakeNightEntry(store.state.profile, wakeKey));
      showToast(t('toast.sleepSaved'), { tone: 'success' });
    },
    deleteNight(wakeKey) {
      const state = store.state;
      const previous = state.sleep.log;
      const log = removeNightEntries(previous, state.profile, wakeKey);
      if (log.length === previous.length) return false;
      const removed = previous.filter((entry) => !log.includes(entry));
      store.replace({ ...state, sleep: { ...state.sleep, log } }, 'sleep');
      showToast(t('toast.sleepDeleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            const current = store.state;
            store.replace({ ...current, sleep: { ...current.sleep, log: restoreNightEntries(current.sleep.log, current.profile, wakeKey, removed) } }, 'sleep');
          },
        },
      });
      return true;
    },
    markAwakeAtNight() {
      const state = store.state;
      store.replace({ ...state, sleep: { ...state.sleep, nightAwakeAt: Date.now() } }, 'sleep');
    },
    recordActivity(now = new Date()) {
      const state = store.state;
      const next = recordActivity(state.activity, now.getTime());
      const previous = state.activity || [];
      if (next.length === previous.length && next[next.length - 1] === previous[previous.length - 1]) return;
      store.replace({ ...state, activity: next }, 'activity');
    },
    clearSleepData() {
      bumpHealthEpoch();
      const state = store.state;
      store.replace({ ...state, activity: [], sleep: { ...state.sleep, log: [], nightAwakeAt: null } }, 'sleep');
    },
    syncHealth,
    async setHealthEnabled(enabled) {
      const state = store.state;
      if (!enabled) {
        bumpHealthEpoch();
        store.replace({ ...state, sleep: { ...state.sleep, healthEnabled: false, log: removeHealthEntries(state.sleep.log), nightAwakeAt: null } }, 'sleep');
        return false;
      }
      const plugin = healthPlugin();
      if (!plugin) return false;
      try {
        await plugin.requestAuthorization({ read: ['sleep'], write: [] });
      } catch {
        showToast(t('toast.healthDenied'), { tone: 'warning' });
        return false;
      }
      store.replace({ ...store.state, sleep: { ...store.state.sleep, healthEnabled: true } }, 'sleep');
      await syncHealth(true, true);
      return true;
    },
  };
}
