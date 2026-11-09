const subscribers = new Set();
let frameId = null;
let lastTime = 0;

function frame(time) {
  frameId = null;
  const delta = lastTime ? Math.min(64, time - lastTime) : 16;
  lastTime = time;
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(time, delta);
    } catch (error) {
      subscribers.delete(subscriber);
      reportError(error);
    }
  }
  if (subscribers.size > 0 && !document.hidden) frameId = requestAnimationFrame(frame);
}

function reportError(error) {
  if (typeof console !== 'undefined') console.error(error);
}

function start() {
  if (frameId !== null || subscribers.size === 0 || document.hidden) return;
  lastTime = 0;
  frameId = requestAnimationFrame(frame);
}

function stop() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else start();
});

export function onFrame(subscriber) {
  subscribers.add(subscriber);
  start();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stop();
  };
}

export function tween({ from, to, duration, onUpdate, easing = easeOutCubic }) {
  const startTime = performance.now();
  let cancel = null;
  cancel = onFrame((time) => {
    const progress = Math.min(1, (time - startTime) / duration);
    onUpdate(from + (to - from) * easing(progress));
    if (progress >= 1) cancel();
  });
  return () => cancel();
}

export function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}
