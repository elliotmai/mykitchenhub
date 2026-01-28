import React from 'react';
import { Button } from 'react-bootstrap';
import { RefreshCw, X } from 'lucide-react';
import './UpdateNotification.css';

/**
 * UpdateNotification Component
 * 
 * Shows a notification when a new version of the app is available.
 * Properly centered on all screen sizes including mobile.
 */
const UpdateNotification = ({ show, onUpdate, onDismiss }) => {
    if (!show) return null;

    return (
        <div className="update-notification-overlay">
            <div className="update-notification">
                <div className="update-notification__header">
                    <RefreshCw size={20} className="update-notification__icon" />
                    <span className="update-notification__title">Update Available</span>
                    <button
                        className="update-notification__close"
                        onClick={onDismiss}
                        aria-label="Dismiss"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="update-notification__body">
                    <p>A new version of MyKitchenHub is available!</p>
                </div>
                <div className="update-notification__actions">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onUpdate}
                        className="update-notification__btn"
                    >
                        Update Now
                    </Button>
                    <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={onDismiss}
                        className="update-notification__btn"
                    >
                        Later
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;