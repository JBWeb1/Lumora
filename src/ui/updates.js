// Keeps the app up to date by talking to the service worker (sw.js).
//
//  - Checks for a new version on start, every 30 minutes and whenever the tab becomes visible.
//  - When one is downloaded, calls onReady(apply). The app decides when to call apply():
//    straight away if nothing is open, or after asking if the user has work in progress.
//  - apply() activates the new version and reloads the page once.

const CHECK_EVERY_MS = 30 * 60 * 1000;

/** The service worker is off on localhost (so edits show up instantly) unless ?sw is in the URL. */
export function updatesEnabled(loc = location) {
  if (!('serviceWorker' in navigator)) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname);
  return !local || new URLSearchParams(loc.search).has('sw');
}

export async function initUpdates({ onReady }) {
  if (!updatesEnabled()) return null;
  let registration;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
  } catch {
    return null; // e.g. opened from file:// or blocked by browser settings; the app still works.
  }

  let applying = false;
  const apply = (worker) => () => {
    applying = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
  // The first install also takes control of the page; only reload when we asked for an update.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });

  const watch = (worker) => {
    if (!worker) return;
    const done = () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) onReady(apply(worker));
    };
    worker.addEventListener('statechange', done);
    done();
  };
  if (registration.waiting && navigator.serviceWorker.controller) onReady(apply(registration.waiting));
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));

  const check = () => registration.update().catch(() => {});
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  return {
    /** Ask the server for a new version. Resolves to 'found' or 'latest'. */
    async check() {
      await registration.update();
      return registration.installing || registration.waiting ? 'found' : 'latest';
    },
  };
}

/** Lets the app offer an "Install app" button where the browser supports it. */
export function watchInstallPrompt(onAvailable) {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    onAvailable(async () => {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      onAvailable(null);
    });
  });
  window.addEventListener('appinstalled', () => onAvailable(null));
}

/** Compare "1.2.10" and "1.2.9" correctly. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
