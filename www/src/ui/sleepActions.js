import { t } from '../i18n/index.js';
import {
  HEALTH_LOOKBACK_HOURS,
  awakeNightEntry,
  currentNightKey,
  recordActivity,
  removeHealthEntries,
  sessionFromHealthSamples,
  sleepEntryForDay,
  upsertSleepEntry,
} from '../core/sleep.js';
import { MS_PER_HOUR } from '../core/time.js';
import { showToast } from './feedback.js';
import { nativePlugin } from './platform.js';

const HEALTH_SYNC_INTERVAL_MS = 10 * 60 * 1000;

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

  async function syncHealth(force = false, notifyEmpty = false) {
    const state = store.state;
    const plugin = healthPlugin();
    if (!plugin || !state.sleep.healthEnabled) return false;
    const now = new Date();
    if (!force && now.getTime() - lastHealthSync < HEALTH_SYNC_INTERVAL_MS) return false;
    lastHealthSync = now.getTime();
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
    const session = sessionFromHealthSamples(samples, now, profile, currentNightKey(profile, now));
    if (!session) {
      if (notifyEmpty && samples.length === 0) showToast(t('toast.healthEmpty'), { tone: 'warning', duration: 8000 });
      return false;
    }
    const current = sleepEntryForDay(store.state.sleep.log, profile, session.wakeKey);
    if (current && current.source === 'health' && current.sleptAt === session.sleptAt && current.wokeAt === session.wokeAt) return false;
    saveSleep(session);
    return true;
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
      const state = store.state;
      store.replace({ ...state, activity: [], sleep: { ...state.sleep, log: [], nightAwakeAt: null } }, 'sleep');
    },
    syncHealth,
    async setHealthEnabled(enabled) {
      const state = store.state;
      if (!enabled) {
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
