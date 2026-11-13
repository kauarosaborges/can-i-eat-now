const CACHE_VERSION = 'v15';
const CACHE_NAME = `can-i-eat-now-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'sound-water.wav',
  'sound-chime.wav',
  'sound-soft.wav',
  'styles/tokens.css',
  'styles/base.css',
  'styles/components.css',
  'styles/views.css',
  'src/app.js',
  'src/i18n/index.js',
  'src/i18n/pt-BR.js',
  'src/core/time.js',
  'src/core/body.js',
  'src/core/bloodPressure.js',
  'src/core/bodyComposition.js',
  'src/core/bodyReferences.js',
  'src/core/csv.js',
  'src/core/measurementReminder.js',
  'src/core/measurementReport.js',
  'src/core/dayRepair.js',
  'src/core/energy.js',
  'src/core/healthMerge.js',
  'src/core/fasting.js',
  'src/core/meals.js',
  'src/core/navigation.js',
  'src/core/hydration.js',
  'src/core/history.js',
  'src/core/storage.js',
  'src/core/notificationPlan.js',
  'src/core/notificationSounds.js',
  'src/core/sleep.js',
  'src/core/sleepQuality.js',
  'src/core/summary.js',
  'src/core/verdict.js',
  'src/ui/actions.js',
  'src/ui/bodyActions.js',
  'src/ui/exportFile.js',
  'src/ui/measureActions.js',
  'src/ui/animation.js',
  'src/ui/dom.js',
  'src/ui/feedback.js',
  'src/ui/format.js',
  'src/ui/healthEpoch.js',
  'src/ui/forms.js',
  'src/ui/nativeNotifications.js',
  'src/ui/notifications.js',
  'src/ui/platform.js',
  'src/ui/sound.js',
  'src/ui/sleepActions.js',
  'src/ui/store.js',
  'src/ui/components/barChart.js',
  'src/ui/components/bodySilhouette.js',
  'src/ui/components/measureParts.js',
  'src/ui/components/pinchDiagram.js',
  'src/ui/components/subpageHeader.js',
  'src/ui/components/charts.js',
  'src/ui/components/eatSheet.js',
  'src/ui/components/fastRing.js',
  'src/ui/components/mealTimeSheet.js',
  'src/ui/components/reminderPrompt.js',
  'src/ui/components/sleepConfirmCard.js',
  'src/ui/components/sleepEntrySheet.js',
  'src/ui/components/summaryGrid.js',
  'src/ui/components/waveVessel.js',
  'src/ui/views/guidesView.js',
  'src/ui/views/historyView.js',
  'src/ui/views/measureView.js',
  'src/ui/views/pressureView.js',
  'src/ui/views/reportView.js',
  'src/ui/views/bodyView.js',
  'src/ui/views/onboarding.js',
  'src/ui/views/settingsView.js',
  'src/ui/views/sleepView.js',
  'src/ui/views/todayView.js',
  'src/ui/views/waterView.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' })))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('can-i-eat-now-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function cachedShell() {
  return caches.open(CACHE_NAME).then((cache) => cache.match('index.html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => (response.ok && !response.redirected ? response : cachedShell().then((shell) => shell || response)))
        .catch(() => cachedShell().then((shell) => shell || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(request)),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./#/water');
    }),
  );
});
