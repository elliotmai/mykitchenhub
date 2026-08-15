import React, { useState, useEffect } from 'react';
import { Alert } from 'react-bootstrap';
import { WifiOff, Wifi } from 'lucide-react';
import './OfflineIndicator.css';

const OfflineIndicator = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  return (
    // Positioned from OfflineIndicator.css rather than inline. An inline
    // `bottom: 0` outranks every stylesheet, and on a phone the thing this
    // banner was landing on top of is the navigation — see that file.
    <div className="offline-indicator">
      {!isOnline && (
        <Alert
          variant="warning"
          className="mb-0 rounded-0 d-flex align-items-center justify-content-center gap-2"
        >
          <WifiOff size={18} />
          <span>You're offline. Some features may be limited.</span>
        </Alert>
      )}
      {showReconnected && (
        <Alert
          variant="success"
          className="mb-0 rounded-0 d-flex align-items-center justify-content-center gap-2"
        >
          <Wifi size={18} />
          <span>You're back online!</span>
        </Alert>
      )}
    </div>
  );
};

export default OfflineIndicator;
