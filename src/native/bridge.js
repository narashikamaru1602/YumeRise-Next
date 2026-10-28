/**
 * Native bridge — the single boundary between web code and Capacitor.
 *
 * Every capability is optional: on plain web (and in the browser during
 * development) the app must keep working, so each function checks availability
 * and degrades gracefully instead of crashing. Nothing here requests
 * permissions at startup; permissions are requested at the moment a feature
 * needs them, and denial is handled without breaking the flow.
 *
 * No Capacitor plugin is imported statically — that keeps the web build free
 * of native-only code and avoids hard failures outside the WebView.
 */

const CAP = () => globalThis.Capacitor || null;
/** Electron desktop shell (optional; present when packaged or run via dev:desktop). */
const DESKTOP = () => globalThis.yumeriseDesktop || null;

export function isNative() {
  const cap = CAP();
  return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export function isDesktop() {
  return Boolean(DESKTOP()?.isDesktop);
}

export function platform() {
  if (isDesktop()) return DESKTOP().platform || 'desktop';
  const cap = CAP();
  if (!cap) return 'web';
  try {
    return cap.getPlatform?.() || 'web';
  } catch {
    return 'web';
  }
}

async function loadPlugin(name) {
  const cap = CAP();
  if (!cap?.Plugins) return null;
  return cap.Plugins[name] || null;
}

/**
 * Notifications — request permission only when the user asks for them.
 * Returns { status: 'granted'|'denied'|'unsupported'|'unavailable', reason? }.
 */
export async function requestNotificationPermission() {
  // Electron desktop: system notifications are available without a browser prompt.
  if (isDesktop() && DESKTOP()?.notify) {
    return { status: 'granted' };
  }
  const plugin = await loadPlugin('LocalNotifications');
  if (plugin?.requestPermissions) {
    try {
      const result = await plugin.requestPermissions();
      const perm = result?.permissions || result;
      if (perm === 'granted' || perm?.display === 'granted') return { status: 'granted' };
      return { status: 'denied' };
    } catch (err) {
      console.warn('native notification permission failed', err);
      return { status: 'unavailable', reason: 'The system prompt could not be shown.' };
    }
  }
  // Web fallback — only ask when the user opted in, never at startup.
  if ('Notification' in window) {
    try {
      const result = await Notification.requestPermission();
      return { status: result === 'granted' ? 'granted' : 'denied' };
    } catch {
      return { status: 'unavailable' };
    }
  }
  return { status: 'unsupported' };
}

/** Schedule a local notification. Silently no-ops when unsupported. */
export async function notify({ title, body, id }) {
  // Prefer Electron system notification when running as desktop app.
  if (isDesktop() && DESKTOP()?.notify) {
    try {
      await DESKTOP().notify({ title: String(title || ''), body: String(body || '') });
      return true;
    } catch (err) {
      console.warn('desktop notify failed', err);
    }
  }
  const plugin = await loadPlugin('LocalNotifications');
  if (plugin?.schedule) {
    try {
      await plugin.schedule({
        notifications: [
          {
            id: id ?? Date.now() % 100000,
            title: String(title || ''),
            body: String(body || ''),
            sound: 'default',
          },
        ],
      });
      return true;
    } catch (err) {
      console.warn('native notify failed', err);
      return false;
    }
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Light haptic tap, when the device supports it. */
export async function haptic(kind = 'light') {
  const plugin = await loadPlugin('Haptics');
  if (plugin?.vibrate) {
    try {
      await plugin.vibrate({ duration: kind === 'medium' ? 20 : 10 });
    } catch { /* ignore */ }
  }
}

/**
 * Back-button handling (Android). Returns an unsubscribe function.
 * handler() should return true when it consumed the event.
 */
export function onBackButton(handler) {
  const plugin = CAP();
  if (!plugin?.addListener) return () => {};
  let subscription;
  try {
    plugin.addListener('backButton', () => {
      try {
        if (!handler()) history.back();
      } catch {
        history.back();
      }
    }).then((sub) => {
      subscription = sub;
    }).catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    try { subscription?.remove?.(); } catch { /* ignore */ }
  };
}

export function initNative() {
  if (!isNative()) return;
  document.documentElement.classList.add('is-native');
  // Prevent the shell from being cut off by system bars; CSS uses these too.
  const cap = CAP();
  try {
    cap.Plugins?.StatusBar?.setStyle?.({ style: getComputedStyle(document.documentElement).getPropertyValue('data-status') || 'DARK' });
  } catch { /* optional */ }
}
