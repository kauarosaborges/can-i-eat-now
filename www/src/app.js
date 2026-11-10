import { t } from './i18n/index.js';
import { dueReminder, hydrationDayContext } from './core/hydration.js';
import { nightMode, waterScheduleFor } from './core/sleep.js';
import { resolveNotificationsEnabled } from './core/storage.js';
import { toDateKey } from './core/time.js';
import { createActions } from './ui/actions.js';
import { closeReminderPrompt, showReminderPrompt } from './ui/components/reminderPrompt.js';
import { h, icon, pressable, prefersReducedMotion } from './ui/dom.js';
import { showToast } from './ui/feedback.js';
import { formatMl } from './ui/format.js';
import { createNativeNotifications } from './ui/nativeNotifications.js';
import { permissionState, setNativeBackend, showSystemNotification } from './ui/notifications.js';
import { isNative } from './ui/platform.js';
import { createBodyActions } from './ui/bodyActions.js';
import { createSleepActions } from './ui/sleepActions.js';
import { createBodyView } from './ui/views/bodyView.js';
import { createStore } from './ui/store.js';
import { createHistoryView } from './ui/views/historyView.js';
import { openOnboarding } from './ui/views/onboarding.js';
import { createSettingsView } from './ui/views/settingsView.js';
import { createTodayView } from './ui/views/todayView.js';
import { createWaterView } from './ui/views/waterView.js';

const ROUTES = [
  { id: 'today', icon: 'today', create: createTodayView },
  { id: 'water', icon: 'water', create: createWaterView },
  { id: 'body', icon: 'body', create: createBodyView },
  { id: 'history', icon: 'history', create: createHistoryView },
  { id: 'settings', icon: 'settings', create: createSettingsView },
];

const store = createStore();
const actions = createActions(store);
const sleepActions = createSleepActions(store);
const bodyActions = createBodyActions(store);
const nativeNotifications = isNative()
  ? createNativeNotifications({
      store,
      onDrink: (ml) => {
        closeReminderPrompt();
        actions.addWater(ml);
      },
      onOpen: (route) => {
        location.hash = `#/${route}`;
      },
    })
  : null;
if (nativeNotifications) setNativeBackend(nativeNotifications);
if (isNative()) document.documentElement.classList.add('is-native');
const outlet = document.getElementById('view-outlet');
const tabBar = document.getElementById('tab-bar');
let activeRoute = null;
let activeView = null;
let onboardingOpen = false;
let lastDateKey = toDateKey(new Date());
let lastReminderCheck = '';

document.title = t('app.name');
const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
if (appleTitle) appleTitle.setAttribute('content', t('app.name'));
document.documentElement.lang = 'pt-BR';

const indicator = h('span', { class: 'tab-indicator', 'aria-hidden': 'true' });
const tabButtons = ROUTES.map((route) =>
  pressable(
    h(
      'a',
      { class: 'tab', href: `#/${route.id}`, 'data-route': route.id },
      h('span', { class: 'tab-icon' }, icon(route.icon)),
      h('span', { class: 'tab-label', text: t(`nav.${route.id}`) }),
    ),
  ),
);
tabBar.setAttribute('aria-label', t('nav.label'));
tabBar.append(indicator, ...tabButtons);

function routeFromHash() {
  const id = (location.hash || '').replace(/^#\/?/, '');
  return ROUTES.find((route) => route.id === id) || ROUTES[0];
}

function showRoute(route) {
  if (activeRoute && activeRoute.id === route.id) return;
  const previousIndex = activeRoute ? ROUTES.indexOf(activeRoute) : -1;
  const nextIndex = ROUTES.indexOf(route);
  const previousView = activeView;
  activeRoute = route;
  activeView = route.create({ store, actions, sleepActions, bodyActions, openOnboarding: startOnboarding });
  const element = activeView.element;
  const reduced = prefersReducedMotion();
  if (previousView) {
    const leaving = previousView.element;
    leaving.classList.add('view-leave');
    leaving.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      leaving.remove();
      previousView.destroy();
    }, reduced ? 0 : 240);
  }
  if (!reduced && previousIndex !== -1) element.classList.add(nextIndex > previousIndex ? 'view-enter-right' : 'view-enter-left');
  outlet.append(element);
  if (activeView.mounted) activeView.mounted();
  activeView.tick(new Date());
  tabButtons.forEach((button, index) => {
    if (index === nextIndex) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  tabBar.style.setProperty('--tab-index', String(nextIndex));
  window.scrollTo(0, 0);
}

function checkReminders(now) {
  const state = store.state;
  if (!state.onboarded || onboardingOpen) return;
  const context = hydrationDayContext(state.profile, now);
  const minute = Math.floor(context.minute);
  const checkKey = `${context.key}:${minute}`;
  if (checkKey === lastReminderCheck) return;
  lastReminderCheck = checkKey;
  if (nightMode(state, now).active) return;
  const schedule = waterScheduleFor(state, context.key);
  const dayLog = store.dayLog(context.key);
  const due = dueReminder(schedule.times, minute, dayLog.lastReminder);
  if (due === null) return;
  dayLog.lastReminder = due;
  store.setDayLog(context.key, dayLog, 'reminder');
  const ml = schedule.mlPerReminder;
  const systemEnabled = resolveNotificationsEnabled(state.notifications.enabled, permissionState()) && state.notifications.kinds.water !== false;
  if (systemEnabled && !nativeNotifications) showSystemNotification(t('reminder.notificationBody', { amount: formatMl(ml) }));
  if (document.visibilityState !== 'visible') return;
  showReminderPrompt({
    ml,
    onDrink: (amount) => {
      actions.addWater(amount);
      if (nativeNotifications) nativeNotifications.clearDelivered('water');
    },
  });
}

function markRemindersHandled() {
  const context = hydrationDayContext(store.state.profile, new Date());
  const dayLog = store.dayLog(context.key);
  dayLog.lastReminder = Math.floor(context.minute);
  store.setDayLog(context.key, dayLog, 'reminder');
}

function tick() {
  const now = new Date();
  const key = toDateKey(now);
  if (key !== lastDateKey) {
    lastDateKey = key;
    if (activeView) activeView.refresh('rollover');
  }
  if (activeView) activeView.tick(now);
  checkReminders(now);
}

function startOnboarding() {
  if (onboardingOpen) return;
  onboardingOpen = true;
  openOnboarding({
    store,
    canCancel: store.state.onboarded,
    onDone: () => {
      onboardingOpen = false;
      markRemindersHandled();
      location.hash = '#/today';
    },
    onCancel: () => {
      onboardingOpen = false;
    },
  });
}

store.subscribe((state, reason) => {
  if (reason === 'reset' || (reason === 'external' && !state.onboarded)) {
    if (activeView) activeView.refresh(reason);
    startOnboarding();
    return;
  }
  if (reason === 'activity') return;
  if (reason === 'external') showToast(t('toast.syncedFromOtherTab'));
  refreshUnlessEditing(reason);
});

let deferredRefresh = null;

function isEditingField() {
  const element = document.activeElement;
  return Boolean(element && element.matches && element.matches('input:not([type=checkbox]), select, textarea'));
}

function refreshUnlessEditing(reason) {
  if (!activeView) return;
  if (isEditingField()) {
    deferredRefresh = reason;
    return;
  }
  activeView.refresh(reason);
}

document.addEventListener('focusout', () => {
  if (deferredRefresh === null) return;
  setTimeout(() => {
    if (deferredRefresh === null || isEditingField()) return;
    const reason = deferredRefresh;
    deferredRefresh = null;
    if (activeView) activeView.refresh(reason);
  }, 0);
});

if (nativeNotifications) {
  store.subscribe((state, reason) => {
    if (reason !== 'reminder' && reason !== 'activity') nativeNotifications.schedule();
  });
  nativeNotifications.refreshPermission().then(() => nativeNotifications.schedule());
}

window.addEventListener('hashchange', () => showRoute(routeFromHash()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  sleepActions.recordActivity();
  sleepActions.syncHealth();
  bodyActions.syncHealth();
  tick();
  if (nativeNotifications) nativeNotifications.refreshPermission().then(() => nativeNotifications.schedule());
});

document.addEventListener('pointerdown', () => sleepActions.recordActivity(), { passive: true });

sleepActions.recordActivity();
sleepActions.syncHealth(true);
bodyActions.syncHealth(true);
showRoute(routeFromHash());
setInterval(tick, 1000);
if (!store.state.onboarded) startOnboarding();

function offerUpdate(worker) {
  showToast(t('toast.updateAvailable'), {
    tone: 'info',
    duration: null,
    action: { label: t('toast.updateAction'), onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
  });
}

if (!isNative() && 'serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
          });
        });
      })
      .catch(() => {});
  });
}
