export function capacitor() {
  return typeof window !== 'undefined' && window.Capacitor ? window.Capacitor : null;
}

export function isNative() {
  const cap = capacitor();
  return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export function nativePlugin(name) {
  const cap = capacitor();
  if (!isNative() || !cap.Plugins) return null;
  return cap.Plugins[name] || null;
}

export function nativeHaptic(style = 'LIGHT') {
  const haptics = nativePlugin('Haptics');
  if (!haptics || typeof haptics.impact !== 'function') return false;
  haptics.impact({ style }).catch(() => {});
  return true;
}
