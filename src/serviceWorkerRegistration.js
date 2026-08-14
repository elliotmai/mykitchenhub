import { Workbox } from 'workbox-window';

// How often to check for updates (in milliseconds)
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

export function register(config) {
  if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
    if (publicUrl.origin !== window.location.origin) {
      return;
    }

    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      const wb = new Workbox(swUrl);

      // Store the workbox instance for external access
      window.__WB = wb;

      // Called when a new service worker is waiting to activate
      wb.addEventListener('waiting', (event) => {
        console.log('New service worker waiting to activate');
        if (config && config.onUpdate) {
          config.onUpdate(wb);
        }
      });

      // Called when the service worker is first installed
      wb.addEventListener('installed', (event) => {
        if (!event.isUpdate) {
          console.log('Service worker installed for the first time');
          if (config && config.onSuccess) {
            config.onSuccess(wb);
          }
        } else {
          console.log('Service worker updated');
        }
      });

      // Called when the new service worker takes control
      wb.addEventListener('controlling', (event) => {
        console.log('New service worker controlling the page');
        // Reload to ensure the new version is fully loaded
        window.location.reload();
      });

      // Called when the service worker becomes active
      wb.addEventListener('activated', (event) => {
        console.log('Service worker activated');
        // If this is a new service worker (not a refresh), claim clients
        if (!event.isUpdate) {
          // First time activation
        }
      });

      // Handle registration errors
      wb.register()
        .then((registration) => {
          console.log('Service worker registered:', registration);

          // Check for updates periodically
          setInterval(() => {
            console.log('Checking for service worker updates...');
            registration.update().catch((err) => {
              console.log('Update check failed:', err);
            });
          }, UPDATE_CHECK_INTERVAL);

          // Also check for updates when the app becomes visible
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              console.log('App visible, checking for updates...');
              registration.update().catch((err) => {
                console.log('Update check failed:', err);
              });
            }
          });

          // Check for updates when coming back online
          window.addEventListener('online', () => {
            console.log('Back online, checking for updates...');
            registration.update().catch((err) => {
              console.log('Update check failed:', err);
            });
          });
        })
        .catch((error) => {
          console.error('Service worker registration failed:', error);
        });
    });
  }
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error('Service worker unregistration failed:', error.message);
      });
  }
}

/**
 * Force update the service worker
 * Can be called from anywhere in the app
 */
export function forceUpdate() {
  if (window.__WB) {
    window.__WB.messageSkipWaiting();
  }
}

/**
 * Check for updates manually
 * Returns a promise that resolves when the check is complete
 */
export async function checkForUpdates() {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    return registration.update();
  }
  return Promise.resolve();
}
