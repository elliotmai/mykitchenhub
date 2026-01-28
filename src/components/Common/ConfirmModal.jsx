import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import { AlertTriangle, Info, CheckCircle, HelpCircle, Trash2, X } from 'lucide-react';
import { ButtonLoader } from './LoadingSpinner';
import './ConfirmModal.css';

/**
 * ConfirmModal Component
 * 
 * A reusable confirmation dialog for destructive actions, important decisions,
 * or any action that requires user confirmation.
 * 
 * @param {boolean} show - Controls modal visibility
 * @param {function} onHide - Called when modal should close
 * @param {function} onConfirm - Called when user confirms action
 * @param {string} title - Modal title
 * @param {string|ReactNode} message - Confirmation message
 * @param {string} confirmText - Text for confirm button (default: 'Confirm')
 * @param {string} cancelText - Text for cancel button (default: 'Cancel')
 * @param {string} variant - 'danger' | 'warning' | 'info' | 'success' (default: 'danger')
 * @param {boolean} loading - Shows loading state on confirm button
 * @param {boolean} centered - Centers modal vertically (default: true)
 * @param {string} size - 'sm' | 'lg' | 'xl' (default: none/medium)
 */
const ConfirmModal = ({
  show,
  onHide,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
  centered = true,
  size,
  children,
  ...props
}) => {
  const iconMap = {
    danger: <Trash2 size={24} />,
    warning: <AlertTriangle size={24} />,
    info: <Info size={24} />,
    success: <CheckCircle size={24} />,
    question: <HelpCircle size={24} />
  };

  const variantButtonMap = {
    danger: 'danger',
    warning: 'warning',
    info: 'info',
    success: 'success',
    question: 'primary'
  };

  const handleConfirm = () => {
    if (!loading && onConfirm) {
      onConfirm();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) {
      handleConfirm();
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered={centered}
      size={size}
      className="confirm-modal"
      onKeyDown={handleKeyDown}
      {...props}
    >
      <Modal.Header closeButton className="confirm-modal__header">
        <Modal.Title className="confirm-modal__title">
          <span className={`confirm-modal__icon confirm-modal__icon--${variant}`}>
            {iconMap[variant] || iconMap.question}
          </span>
          {title}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="confirm-modal__body">
        {typeof message === 'string' ? (
          <p className="confirm-modal__message">{message}</p>
        ) : (
          message
        )}
        {children}
      </Modal.Body>

      <Modal.Footer className="confirm-modal__footer">
        <Button
          variant="outline-secondary"
          onClick={onHide}
          disabled={loading}
          className="confirm-modal__btn confirm-modal__btn--cancel"
        >
          <X size={18} />
          {cancelText}
        </Button>
        <Button
          variant={variantButtonMap[variant]}
          onClick={handleConfirm}
          disabled={loading}
          className="confirm-modal__btn confirm-modal__btn--confirm"
        >
          {loading && <ButtonLoader />}
          {confirmText}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

/**
 * DeleteConfirmModal
 * 
 * A pre-configured ConfirmModal specifically for delete actions.
 */
export const DeleteConfirmModal = ({
  show,
  onHide,
  onConfirm,
  itemName = 'this item',
  loading = false,
  ...props
}) => (
  <ConfirmModal
    show={show}
    onHide={onHide}
    onConfirm={onConfirm}
    title="Delete Item"
    message={
      <>
        Are you sure you want to delete <strong>{itemName}</strong>? 
        This action cannot be undone.
      </>
    }
    confirmText="Delete"
    cancelText="Cancel"
    variant="danger"
    loading={loading}
    {...props}
  />
);

/**
 * UnsavedChangesModal
 * 
 * A pre-configured ConfirmModal for unsaved changes warnings.
 */
export const UnsavedChangesModal = ({
  show,
  onHide,
  onConfirm,
  loading = false,
  ...props
}) => (
  <ConfirmModal
    show={show}
    onHide={onHide}
    onConfirm={onConfirm}
    title="Unsaved Changes"
    message="You have unsaved changes. Are you sure you want to leave? Your changes will be lost."
    confirmText="Leave"
    cancelText="Stay"
    variant="warning"
    loading={loading}
    {...props}
  />
);

/**
 * ActionConfirmModal
 * 
 * A general-purpose confirmation for important actions.
 */
export const ActionConfirmModal = ({
  show,
  onHide,
  onConfirm,
  action = 'proceed',
  loading = false,
  ...props
}) => (
  <ConfirmModal
    show={show}
    onHide={onHide}
    onConfirm={onConfirm}
    title="Confirm Action"
    message={`Are you sure you want to ${action}?`}
    confirmText="Yes, Continue"
    cancelText="Cancel"
    variant="question"
    loading={loading}
    {...props}
  />
);

export default ConfirmModal;
