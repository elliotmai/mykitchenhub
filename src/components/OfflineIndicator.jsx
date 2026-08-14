import React, { useState, useEffect } from 'react';
import { Alert } from 'react-bootstrap';
import { WifiOff, Wifi } from 'lucide-react';

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
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1050,
      }}
    >
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
