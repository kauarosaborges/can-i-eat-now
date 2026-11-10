let epoch = 0;
let syncing = 0;
const listeners = new Set();

export function currentHealthEpoch() {
  return epoch;
}

export function bumpHealthEpoch() {
  epoch += 1;
  return epoch;
}

export function isHealthSyncing() {
  return syncing > 0;
}

export function onHealthSyncChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function trackHealthSync(task) {
  syncing += 1;
  if (syncing === 1) for (const listener of listeners) listener(true);
  try {
    return await task();
  } finally {
    syncing -= 1;
    if (syncing === 0) for (const listener of listeners) listener(false);
  }
}
