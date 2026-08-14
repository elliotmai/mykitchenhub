import React, { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button, Card } from 'react-bootstrap';
import './ErrorBoundary.css';

/**
 * ErrorBoundary Component
 *
 * A React error boundary that catches JavaScript errors anywhere in the
 * child component tree and displays a fallback UI instead of crashing.
 *
 * Usage:
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 *
 * Or with custom fallback:
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({ errorInfo });

    // You can also log the error to an error reporting service here
    // Example: logErrorToService(error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, showDetails = false } = this.props;

    if (hasError) {
      // If a custom fallback is provided, use it
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="error-boundary">
          <Card className="error-boundary__card">
            <Card.Body className="error-boundary__body">
              <div className="error-boundary__icon">
                <AlertTriangle size={48} />
              </div>

              <h2 className="error-boundary__title">Something went wrong</h2>

              <p className="error-boundary__message">
                We're sorry, but something unexpected happened. Please try refreshing the page or go
                back to the home page.
              </p>

              {showDetails && error && (
                <details className="error-boundary__details">
                  <summary>Error Details</summary>
                  <pre className="error-boundary__stack">
                    {error.toString()}
                    {errorInfo && errorInfo.componentStack}
                  </pre>
                </details>
              )}

              <div className="error-boundary__actions">
                <Button
                  variant="primary"
                  onClick={this.handleRetry}
                  className="error-boundary__btn"
                >
                  <RefreshCw size={18} />
                  Try Again
                </Button>

                <Button
                  variant="outline-primary"
                  onClick={this.handleGoHome}
                  className="error-boundary__btn"
                >
                  <Home size={18} />
                  Go Home
                </Button>
              </div>
            </Card.Body>
          </Card>
        </div>
      );
    }

    return children;
  }
}

/**
 * withErrorBoundary HOC
 *
 * A higher-order component that wraps a component with an ErrorBoundary.
 *
 * Usage:
 * export default withErrorBoundary(MyComponent);
 */
export const withErrorBoundary = (WrappedComponent, errorBoundaryProps = {}) => {
  const WithErrorBoundary = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `WithErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithErrorBoundary;
};

/**
 * ErrorFallback Component
 *
 * A simple functional component for use as a custom fallback.
 * Can be used with the fallback prop of ErrorBoundary.
 */
export const ErrorFallback = ({
  title = 'Something went wrong',
  message = 'Please try again later.',
  onRetry,
}) => (
  <div className="error-fallback">
    <AlertTriangle size={32} className="error-fallback__icon" />
    <h3 className="error-fallback__title">{title}</h3>
    <p className="error-fallback__message">{message}</p>
    {onRetry && (
      <Button variant="primary" size="sm" onClick={onRetry}>
        <RefreshCw size={16} />
        Try Again
      </Button>
    )}
  </div>
);

export default ErrorBoundary;
