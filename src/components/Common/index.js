/**
 * Common Components
 *
 * This barrel file exports all common/shared components for easy importing.
 *
 * Usage:
 * import { LoadingSpinner, ErrorBoundary, ConfirmModal, useToast } from '@/components/Common';
 */

// Loading Spinner and variants
export { default as LoadingSpinner, PageLoader, ButtonLoader, CardLoader } from './LoadingSpinner';

// Error Boundary and utilities
export { default as ErrorBoundary, withErrorBoundary, ErrorFallback } from './ErrorBoundary';

// Confirmation Modals
export {
  default as ConfirmModal,
  DeleteConfirmModal,
  UnsavedChangesModal,
  ActionConfirmModal,
} from './ConfirmModal';

// Toast Notifications
export { default as Toast, ToastProvider, useToast, toast, setToastRef } from './Toast';

// What's New Popup
export { default as WhatsNew } from './WhatsNew';

// Collapsible filter section and its chip row
export { default as FilterPanel } from './FilterPanel';
export { default as ChipFilter, DEFAULT_VISIBLE_CHIPS } from './ChipFilter';
