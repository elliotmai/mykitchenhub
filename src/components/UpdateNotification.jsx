import React from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * UpdateNotification Component
 *
 * Shows a notification when a new version of the app is available.
 * Uses inline styles to guarantee proper positioning on all devices.
 */
const UpdateNotification = ({ show, onUpdate, onDismiss }) => {
  if (!show) return null;

  // Inline styles to guarantee centering regardless of other CSS
  const styles = {
    overlay: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      padding: '16px',
      paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      zIndex: 99999,
      pointerEvents: 'none',
    },
    card: {
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
      width: '100%',
      maxWidth: '340px',
      overflow: 'hidden',
      pointerEvents: 'auto',
      animation: 'slideUp 0.3s ease-out',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '16px',
      paddingBottom: '8px',
    },
    icon: {
      color: '#2E7D32',
      flexShrink: 0,
    },
    title: {
      fontSize: '16px',
      fontWeight: 600,
      color: '#1a1a2e',
      flex: 1,
      margin: 0,
    },
    closeBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      background: 'none',
      border: 'none',
      borderRadius: '8px',
      color: '#6c757d',
      cursor: 'pointer',
      flexShrink: 0,
    },
    body: {
      padding: '0 16px 8px 16px',
    },
    bodyText: {
      margin: 0,
      fontSize: '14px',
      color: '#64748b',
      lineHeight: 1.5,
    },
    actions: {
      display: 'flex',
      gap: '8px',
      padding: '16px',
      paddingTop: '8px',
    },
    btnPrimary: {
      flex: 1,
      padding: '10px 16px',
      fontSize: '14px',
      fontWeight: 500,
      color: '#ffffff',
      backgroundColor: '#2E7D32',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
    },
    btnSecondary: {
      flex: 1,
      padding: '10px 16px',
      fontSize: '14px',
      fontWeight: 500,
      color: '#64748b',
      backgroundColor: 'transparent',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
      cursor: 'pointer',
    },
  };

  return (
    <>
      {/* Keyframes for animation */}
      <style>
        {`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>

      <div style={styles.overlay}>
        <div style={styles.card}>
          <div style={styles.header}>
            <RefreshCw size={20} style={styles.icon} />
            <span style={styles.title}>Update Available</span>
            <button style={styles.closeBtn} onClick={onDismiss} aria-label="Dismiss">
              <X size={18} />
            </button>
          </div>
          <div style={styles.body}>
            <p style={styles.bodyText}>A new version of MyKitchenHub is available!</p>
          </div>
          <div style={styles.actions}>
            <button style={styles.btnPrimary} onClick={onUpdate}>
              Update Now
            </button>
            <button style={styles.btnSecondary} onClick={onDismiss}>
              Later
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default UpdateNotification;
