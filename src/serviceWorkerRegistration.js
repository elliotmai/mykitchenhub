import { Workbox } from 'workbox-window';

export function register(config) {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
        const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
        if (publicUrl.origin !== window.location.origin) {
            return;
        }

        window.addEventListener('load', () => {
            const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

            const wb = new Workbox(swUrl);

            // Show update prompt when new service worker is available
            wb.addEventListener('waiting', () => {
                if (config && config.onUpdate) {
                    config.onUpdate(wb);
                }
            });

            // Notify when service worker is installed for first time
            wb.addEventListener('installed', (event) => {
                if (!event.isUpdate) {
                    if (config && config.onSuccess) {
                        config.onSuccess(wb);
                    }
                }
            });

            // Handle registration errors
            wb.register().catch((error) => {
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