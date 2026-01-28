import React, { useState, useEffect } from 'react';
import { Modal, Button, Stack } from 'react-bootstrap';
// eslint-disable-next-line
import { Download, X, Smartphone, Monitor } from 'lucide-react';

const InstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        // Check if already installed
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone ||
            document.referrer.includes('android-app://');
        setIsStandalone(standalone);

        // Check if iOS
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        setIsIOS(ios);

        // Listen for beforeinstallprompt event
        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);

            // Check if user has dismissed before
            const dismissed = localStorage.getItem('pwaInstallDismissed');
            const dismissedTime = dismissed ? parseInt(dismissed, 10) : 0;
            const oneWeek = 7 * 24 * 60 * 60 * 1000;

            // Show prompt if not dismissed or dismissed more than a week ago
            if (!dismissed || Date.now() - dismissedTime > oneWeek) {
                // Delay showing prompt to not interrupt user
                setTimeout(() => setShowPrompt(true), 30000); // 30 seconds
            }
        };

        window.addEventListener('beforeinstallprompt', handler);

        // Listen for successful installation
        window.addEventListener('appinstalled', () => {
            setDeferredPrompt(null);
            setShowPrompt(false);
            console.log('PWA was installed');
        });

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            console.log('User accepted the install prompt');
        } else {
            console.log('User dismissed the install prompt');
        }

        setDeferredPrompt(null);
        setShowPrompt(false);
    };

    const handleDismiss = () => {
        localStorage.setItem('pwaInstallDismissed', Date.now().toString());
        setShowPrompt(false);
    };

    // Don't show if already installed
    if (isStandalone) return null;

    // iOS-specific instructions
    if (isIOS && showPrompt) {
        return (
            <Modal show={showPrompt} onHide={handleDismiss} centered>
                <Modal.Header closeButton>
                    <Modal.Title className="d-flex align-items-center gap-2">
                        <Smartphone size={24} className="text-primary" />
                        Install MyKitchenHub
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>To install this app on your iPhone/iPad:</p>
                    <ol className="mb-0">
                        <li>Tap the <strong>Share</strong> button <span style={{ fontSize: '1.2em' }}>⎙</span> at the bottom of Safari</li>
                        <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                        <li>Tap <strong>"Add"</strong> in the top right corner</li>
                    </ol>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={handleDismiss}>
                        Maybe Later
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }

    // Standard install prompt for Android/Desktop
    if (!deferredPrompt || !showPrompt) return null;

    return (
        <Modal show={showPrompt} onHide={handleDismiss} centered>
            <Modal.Header closeButton>
                <Modal.Title className="d-flex align-items-center gap-2">
                    <Download size={24} className="text-primary" />
                    Install MyKitchenHub
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Stack gap={3}>
                    <p className="mb-0">
                        Install MyKitchenHub for a better experience:
                    </p>
                    <ul className="mb-0">
                        <li>📱 Works offline</li>
                        <li>⚡ Faster loading</li>
                        <li>🔔 Push notifications for expiring items</li>
                        <li>🏠 Quick access from home screen</li>
                    </ul>
                </Stack>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-secondary" onClick={handleDismiss}>
                    <X size={18} className="me-1" />
                    Not Now
                </Button>
                <Button variant="primary" onClick={handleInstall}>
                    <Download size={18} className="me-1" />
                    Install App
                </Button>
            </Modal.Footer>
        </Modal>
    );
};

export default InstallPrompt;