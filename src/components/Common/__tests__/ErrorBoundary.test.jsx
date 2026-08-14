// The error boundary is the app's last line of defence — if it fails, the user
// gets a blank screen. These tests deliberately throw from a child.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ErrorBoundary, { withErrorBoundary, ErrorFallback } from '../ErrorBoundary';

const Boom = ({ message = 'kaboom' }) => {
  throw new Error(message);
};

// React logs caught render errors to console.error; silence it so a passing
// suite stays readable.
let consoleError;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>Inventory</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('Inventory')).toBeInTheDocument();
  });

  it('catches a child error and shows a recovery screen instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
  });

  it('hides the stack trace by default', () => {
    render(
      <ErrorBoundary>
        <Boom message="secret internals" />
      </ErrorBoundary>
    );

    expect(screen.queryByText(/secret internals/)).not.toBeInTheDocument();
  });

  it('shows the stack trace when details are enabled, for local debugging', () => {
    render(
      <ErrorBoundary showDetails>
        <Boom message="secret internals" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/secret internals/)).toBeInTheDocument();
    expect(screen.getByText('Error Details')).toBeInTheDocument();
  });

  it('renders a custom fallback when one is supplied', () => {
    render(
      <ErrorBoundary fallback={<p>Recipes are unavailable right now.</p>}>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recipes are unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('recovers when the user retries and the child no longer throws', async () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <p>Recovered</p>;
    };

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });
});

describe('withErrorBoundary', () => {
  it('wraps a component so its errors are contained', () => {
    const Guarded = withErrorBoundary(Boom);
    render(<Guarded />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('passes props through to the wrapped component', () => {
    const Greet = ({ name }) => <p>Hello {name}</p>;
    const Guarded = withErrorBoundary(Greet);

    render(<Guarded name="Cook" />);

    expect(screen.getByText('Hello Cook')).toBeInTheDocument();
  });
});

describe('ErrorFallback', () => {
  it('renders as a standalone error message', () => {
    const { container } = render(<ErrorFallback error={new Error('nope')} />);
    expect(container).not.toBeEmptyDOMElement();
  });
});
