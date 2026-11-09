import { t } from '../i18n/index.js';

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function permissionState() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showSystemNotification(body) {
  if (permissionState() !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    await registration.showNotification(t('reminder.notificationTitle'), {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'water-reminder',
      renotify: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function isIos() {
  const agent = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export function shouldShowIosHint() {
  return isIos() && !isStandalone();
}
