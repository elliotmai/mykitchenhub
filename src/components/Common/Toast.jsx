import React, { createContext, useContext, useState, useCallback } from 'react';
import { Toast as BSToast, ToastContainer } from 'react-bootstrap';
import { CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import './Toast.css';

/**
 * Toast Context
 * Provides toast notification functionality throughout the app
 */
const ToastContext = createContext(null);

/**
 * useToast Hook
 * 
 * Returns functions to show different types of toast notifications.
 * 
 * Usage:
 * const { showSuccess, showError, showWarning, showInfo } = useToast();
 * showSuccess('Item saved successfully!');
 * showError('Failed to save item');
 */
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

/**
 * Toast Configuration
 */
const TOAST_VARIANTS = {
  success: {
    icon: CheckCircle,
    className: 'toast--success',
    defaultTitle: 'Success'
  },
  error: {
    icon: XCircle,
    className: 'toast--error',
    defaultTitle: 'Error'
  },
  warning: {
    icon: AlertTriangle,
    className: 'toast--warning',
    defaultTitle: 'Warning'
  },
  info: {
    icon: Info,
    className: 'toast--info',
    defaultTitle: 'Info'
  }
};

const DEFAULT_DURATION = 5000; // 5 seconds

/**
 * Individual Toast Component
 */
const Toast = ({ 
  id, 
  variant = 'info', 
  title, 
  message, 
  duration = DEFAULT_DURATION,
  onClose 
}) => {
  const config = TOAST_VARIANTS[variant] || TOAST_VARIANTS.info;
  const IconComponent = config.icon;

  return (
    <BSToast
      onClose={() => onClose(id)}
      show={true}
      delay={duration}
      autohide={duration > 0}
      className={`toast-notification ${config.className}`}
    >
      <BSToast.Header closeButton={false} className="toast-notification__header">
        <div className="toast-notification__icon">
          <IconComponent size={18} />
        </div>
        <strong className="toast-notification__title me-auto">
          {title || config.defaultTitle}
        </strong>
        <button 
          type="button" 
          className="toast-notification__close"
          onClick={() => onClose(id)}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </BSToast.Header>
      {message && (
        <BSToast.Body className="toast-notification__body">
          {message}
        </BSToast.Body>
      )}
    </BSToast>
  );
};

/**
 * ToastProvider Component
 * 
 * Wraps the application and provides toast functionality to all children.
 * 
 * Usage:
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 */
export const ToastProvider = ({ children, position = 'top-end', maxToasts = 5 }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(({ variant, title, message, duration }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    setToasts((prev) => {
      // Keep only the most recent toasts
      const newToasts = [...prev, { id, variant, title, message, duration }];
      if (newToasts.length > maxToasts) {
        return newToasts.slice(-maxToasts);
      }
      return newToasts;
    });

    return id;
  }, [maxToasts]);

  const showSuccess = useCallback((message, title, duration) => {
    return addToast({ variant: 'success', title, message, duration });
  }, [addToast]);

  const showError = useCallback((message, title, duration) => {
    return addToast({ variant: 'error', title, message, duration });
  }, [addToast]);

  const showWarning = useCallback((message, title, duration) => {
    return addToast({ variant: 'warning', title, message, duration });
  }, [addToast]);

  const showInfo = useCallback((message, title, duration) => {
    return addToast({ variant: 'info', title, message, duration });
  }, [addToast]);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  const value = {
    showSuccess,
    showError,
    showWarning,
    showInfo,
    addToast,
    removeToast,
    clearAll
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer 
        position={position} 
        className="toast-container"
        containerPosition="fixed"
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onClose={removeToast}
          />
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  );
};

/**
 * Standalone Toast Functions (for use outside React components)
 * 
 * Note: These require the ToastProvider to be mounted.
 * For most cases, prefer using the useToast hook.
 */
let toastRef = null;

export const setToastRef = (ref) => {
  toastRef = ref;
};

export const toast = {
  success: (message, title, duration) => toastRef?.showSuccess(message, title, duration),
  error: (message, title, duration) => toastRef?.showError(message, title, duration),
  warning: (message, title, duration) => toastRef?.showWarning(message, title, duration),
  info: (message, title, duration) => toastRef?.showInfo(message, title, duration),
};

export default Toast;
