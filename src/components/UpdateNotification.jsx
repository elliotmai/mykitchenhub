import React from 'react';
import { RefreshCw, X } from 'lucide-react';

import { UPDATE_STAGES } from '../utils/appUpdate';
import { isKioskDevice } from '../utils/kioskMode';

/**
 * UpdateNotification Component
 *
 * Shows a notification when a new version of the app is available, and then
 * shows the update actually happening.
 *
 * That second half is the point. Tapping "Update Now" used to hide the card
 * immediately and leave the page exactly as it was for however long the
 * service worker took — which on the fridge tablet is indistinguishable from a
 * button that does nothing. Now the card stays up, the icon spins, the bar
 * fills, and the stage is named. If the reload takes four seconds, four
 * seconds of visible progress is what you get.
 *
 * Uses inline styles to guarantee proper positioning on all devices.
 */

/** Fraction of the bar filled at each stage, so it only ever moves forwards. */
const STAGE_PROGRESS = {
  activating: 0.35,
  clearing: 0.7,
  reloading: 1,
};

const UpdateNotification = ({ show, updating = false, stage = null, onUpdate, onDismiss }) => {
  if (!show) return null;

  // The fridge tablet sits at arm's length across a room, not six inches from
  // your face. Everything scales up on the device that told us it is a kiosk.
  const kiosk = isKioskDevice();
  const scale = kiosk ? 1.35 : 1;
  const px = (n) => `${Math.round(n * scale)}px`;

  const progress = STAGE_PROGRESS[stage] ?? 0;

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
      alignItems: kiosk ? 'center' : 'flex-end',
      padding: '16px',
      paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      zIndex: 99999,
      // While updating the card owns the screen: nothing behind it is going to
      // survive the reload, and a stray tap on the kiosk should not start a
      // navigation half way through a cache clear.
      pointerEvents: updating ? 'auto' : 'none',
      backgroundColor: updating ? 'rgba(15, 23, 42, 0.45)' : 'transparent',
      transition: 'background-color 0.25s ease-out',
    },
    card: {
      backgroundColor: '#ffffff',
      borderRadius: px(12),
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
      width: '100%',
      maxWidth: px(340),
      overflow: 'hidden',
      pointerEvents: 'auto',
      animation: 'slideUp 0.3s ease-out',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: px(10),
      padding: px(16),
      paddingBottom: px(8),
    },
    icon: {
      color: '#2E7D32',
      flexShrink: 0,
      animation: updating ? 'mkhSpin 1s linear infinite' : 'none',
    },
    title: {
      fontSize: px(16),
      fontWeight: 600,
      color: '#1a1a2e',
      flex: 1,
      margin: 0,
    },
    closeBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: px(32),
      height: px(32),
      background: 'none',
      border: 'none',
      borderRadius: px(8),
      color: '#6c757d',
      cursor: 'pointer',
      flexShrink: 0,
    },
    body: {
      padding: `0 ${px(16)} ${px(8)} ${px(16)}`,
    },
    bodyText: {
      margin: 0,
      fontSize: px(14),
      color: '#64748b',
      lineHeight: 1.5,
    },
    track: {
      marginTop: px(12),
      height: px(6),
      borderRadius: px(3),
      backgroundColor: '#e2e8f0',
      overflow: 'hidden',
    },
    bar: {
      height: '100%',
      width: `${progress * 100}%`,
      backgroundColor: '#2E7D32',
      borderRadius: px(3),
      // Long enough that the bar is visibly travelling rather than jumping,
      // short enough that it has arrived before the next stage begins.
      transition: 'width 0.4s ease-out',
    },
    actions: {
      display: 'flex',
      gap: px(8),
      padding: px(16),
      paddingTop: px(8),
    },
    btnPrimary: {
      flex: 1,
      padding: `${px(10)} ${px(16)}`,
      fontSize: px(14),
      fontWeight: 500,
      color: '#ffffff',
      backgroundColor: '#2E7D32',
      border: 'none',
      borderRadius: px(8),
      cursor: 'pointer',
      // 44px is the project's touch floor; the kiosk scale only ever raises it.
      minHeight: px(44),
    },
    btnSecondary: {
      flex: 1,
      padding: `${px(10)} ${px(16)}`,
      fontSize: px(14),
      fontWeight: 500,
      color: '#64748b',
      backgroundColor: 'transparent',
      border: '1px solid #e2e8f0',
      borderRadius: px(8),
      cursor: 'pointer',
      minHeight: px(44),
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
          @keyframes mkhSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes mkhSpin {
              from { transform: none; }
              to { transform: none; }
            }
          }
        `}
      </style>

      <div style={styles.overlay}>
        <div
          style={styles.card}
          role={updating ? 'alert' : undefined}
          aria-busy={updating || undefined}
        >
          <div style={styles.header}>
            <RefreshCw size={Math.round(20 * scale)} style={styles.icon} aria-hidden="true" />
            <span style={styles.title}>{updating ? 'Updating' : 'Update Available'}</span>
            {!updating && (
              <button style={styles.closeBtn} onClick={onDismiss} aria-label="Dismiss">
                <X size={Math.round(18 * scale)} />
              </button>
            )}
          </div>

          <div style={styles.body}>
            <p style={styles.bodyText}>
              {updating
                ? (UPDATE_STAGES[stage] ?? 'Starting…')
                : 'A new version of MyKitchenHub is available!'}
            </p>

            {updating && (
              <div
                style={styles.track}
                role="progressbar"
                aria-label="Update progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div style={styles.bar} />
              </div>
            )}
          </div>

          {!updating && (
            <div style={styles.actions}>
              <button style={styles.btnPrimary} onClick={onUpdate}>
                Update Now
              </button>
              <button style={styles.btnSecondary} onClick={onDismiss}>
                Later
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default UpdateNotification;
