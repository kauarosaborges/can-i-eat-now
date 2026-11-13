import { t } from '../i18n/index.js';
import { MEASUREMENT_KIND, buildNotificationPlan } from '../core/notificationPlan.js';
import { soundFor } from '../core/notificationSounds.js';
import { formatMl } from './format.js';
import { nativePlugin } from './platform.js';

export const PERMISSION_EVENT = 'native-notification-permission';
const WATER_ACTION_TYPE = 'WATER_REMINDER';
const DRINK_ACTION = 'drink';
const RESCHEDULE_DELAY_MS = 800;
const RETRY_DELAY_MS = 30000;

function mapPermission(display) {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'default';
}

export function toNativeNotification(item) {
  const params = item.kind === 'water' ? { amount: formatMl(item.params.ml) } : item.params;
  const notification = {
    id: item.id,
    title: t(item.titleKey, params),
    body: t(item.bodyKey, params),
    schedule: { at: item.at, allowWhileIdle: true },
    threadIdentifier: item.kind,
    extra: { kind: item.kind },
  };
  const sound = soundFor(item.kind);
  if (sound) notification.sound = sound;
  if (item.kind === 'water') notification.actionTypeId = WATER_ACTION_TYPE;
  return notification;
}

export function createNativeNotifications({ store, onDrink, onOpen }) {
  const plugin = nativePlugin('LocalNotifications');
  if (!plugin) return null;
  let permission = 'default';
  let timer = null;
  let queue = Promise.resolve();
  let registeredGlass = null;
  let scheduledCount = 0;
  let lastError = null;
  let retryTimer = null;
  let retried = false;

  function announce() {
    document.dispatchEvent(new CustomEvent(PERMISSION_EVENT, { detail: { permission, scheduledCount, failed: lastError !== null } }));
  }

  async function refreshPermission() {
    try {
      const result = await plugin.checkPermissions();
      permission = mapPermission(result && result.display);
    } catch {
      permission = 'unsupported';
    }
    announce();
    return permission;
  }

  async function request() {
    try {
      const result = await plugin.requestPermissions();
      permission = mapPermission(result && result.display);
    } catch {
      await refreshPermission();
    }
    announce();
    schedule();
    return permission;
  }

  async function registerActions(glassMl) {
    if (registeredGlass === glassMl) return;
    await plugin.registerActionTypes({
      types: [
        {
          id: WATER_ACTION_TYPE,
          actions: [{ id: DRINK_ACTION, title: t('notificationPlan.drinkAction', { amount: formatMl(glassMl) }), foreground: true }],
        },
      ],
    });
    registeredGlass = glassMl;
  }

  async function cancelPending() {
    const pending = await plugin.getPending();
    const list = pending && Array.isArray(pending.notifications) ? pending.notifications : [];
    if (list.length > 0) await plugin.cancel({ notifications: list.map((item) => ({ id: Number(item.id) })) });
  }

  async function apply() {
    const state = store.state;
    await cancelPending();
    scheduledCount = 0;
    if (permission === 'granted' && state.notifications.enabled) {
      await registerActions(state.profile.glassMl);
      const plan = buildNotificationPlan(state, new Date());
      if (plan.length > 0) {
        await plugin.schedule({ notifications: plan.map(toNativeNotification) });
        scheduledCount = plan.length;
      }
    }
  }

  function handleFailure(error) {
    scheduledCount = 0;
    lastError = error;
    if (typeof console !== 'undefined') console.error(error);
    announce();
    if (retried) return;
    retried = true;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(run, RETRY_DELAY_MS);
  }

  function run() {
    queue = queue
      .then(apply)
      .then(() => {
        lastError = null;
        retried = false;
        announce();
      })
      .catch(handleFailure);
  }

  function schedule() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    retried = false;
    timer = setTimeout(run, RESCHEDULE_DELAY_MS);
  }

  async function clearDelivered(kind) {
    try {
      const delivered = await plugin.getDeliveredNotifications();
      const list = delivered && Array.isArray(delivered.notifications) ? delivered.notifications : [];
      const matching = list.filter((item) => item && item.extra && item.extra.kind === kind).map((item) => ({ id: Number(item.id) }));
      if (matching.length > 0) await plugin.removeDeliveredNotifications({ notifications: matching });
    } catch (error) {
      if (typeof console !== 'undefined') console.error(error);
    }
  }

  plugin.addListener('localNotificationActionPerformed', (event) => {
    const extra = event && event.notification && event.notification.extra ? event.notification.extra : {};
    if (event && event.actionId === DRINK_ACTION) {
      onDrink(store.state.profile.glassMl, 'notification');
      onOpen('water');
      return;
    }
    if (event && event.actionId === 'tap') onOpen(extra.kind === 'water' ? 'water' : extra.kind === MEASUREMENT_KIND ? 'measure' : 'today');
  });

  return {
    refreshPermission,
    request,
    schedule,
    clearDelivered,
    get failed() {
      return lastError !== null;
    },
    get permission() {
      return permission;
    },
    get scheduledCount() {
      return scheduledCount;
    },
  };
}
