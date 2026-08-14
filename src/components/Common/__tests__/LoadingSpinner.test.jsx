// Loading states are announced to screen readers, so these tests check the
// accessibility surface rather than the visual one.

import React from 'react';
import { render, screen } from '@testing-library/react';

import LoadingSpinner, { PageLoader, ButtonLoader, CardLoader } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
  it('exposes a polite live region so screen readers announce loading', () => {
    render(<LoadingSpinner />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/loading/i);
  });

  it('includes the loading text in the announcement', () => {
    render(<LoadingSpinner text="Syncing recipes" />);

    expect(screen.getByText('Syncing recipes')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Loading: Syncing recipes/i);
  });

  it.each(['sm', 'md', 'lg', 'xl'])('renders the %s size', (size) => {
    const { container } = render(<LoadingSpinner size={size} />);
    expect(container.querySelector(`.loading-spinner--${size}`)).toBeInTheDocument();
  });

  it('falls back to the medium size for an unknown size', () => {
    const { container } = render(<LoadingSpinner size="enormous" />);
    expect(container.querySelector('.loading-spinner')).toBeInTheDocument();
  });

  it('renders as an overlay when asked', () => {
    const { container } = render(<LoadingSpinner overlay text="Please wait" />);

    expect(container.querySelector('.loading-spinner__overlay')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Please wait/);
  });

  it('applies inline and custom classes', () => {
    const { container } = render(<LoadingSpinner inline className="my-class" />);

    expect(container.querySelector('.loading-spinner--inline')).toBeInTheDocument();
    expect(container.querySelector('.my-class')).toBeInTheDocument();
  });
});

describe('loader variants', () => {
  it('PageLoader shows a default message', () => {
    render(<PageLoader />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('ButtonLoader is decorative and hidden from assistive tech', () => {
    const { container } = render(<ButtonLoader />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('CardLoader renders one skeleton line per requested line', () => {
    const { container } = render(<CardLoader lines={5} />);
    expect(container.querySelectorAll('.card-loader__line')).toHaveLength(5);
  });

  it('CardLoader labels itself for assistive tech', () => {
    render(<CardLoader />);
    expect(screen.getByLabelText('Loading content')).toBeInTheDocument();
  });
});
