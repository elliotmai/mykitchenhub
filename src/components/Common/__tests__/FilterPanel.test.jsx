// src/components/Common/__tests__/FilterPanel.test.jsx

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FilterPanel from '../FilterPanel';

const setViewport = (narrow) => {
  window.matchMedia = (query) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  });
};

describe('FilterPanel', () => {
  afterEach(() => setViewport(false));

  it('starts open on anything wider than a phone', () => {
    setViewport(false);
    render(
      <FilterPanel>
        <button type="button">a control</button>
      </FilterPanel>
    );
    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('starts folded away on a phone, where the space is worth more', () => {
    setViewport(true);
    render(
      <FilterPanel>
        <button type="button">a control</button>
      </FilterPanel>
    );
    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('opens and closes on the toggle', async () => {
    const user = userEvent.setup();
    setViewport(true);
    render(
      <FilterPanel>
        <button type="button">a control</button>
      </FilterPanel>
    );

    const toggle = screen.getByRole('button', { name: /filters/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('says how many filters are on, so a folded panel never hides one silently', () => {
    render(
      <FilterPanel activeCount={3}>
        <button type="button">a control</button>
      </FilterPanel>
    );
    expect(screen.getByLabelText('3 filters applied')).toHaveTextContent('3');
  });

  it('shows no count when nothing is filtered', () => {
    render(
      <FilterPanel activeCount={0}>
        <button type="button">a control</button>
      </FilterPanel>
    );
    expect(screen.queryByLabelText(/filters applied/)).not.toBeInTheDocument();
  });

  it('points the toggle at the region it controls', () => {
    render(
      <FilterPanel>
        <button type="button">a control</button>
      </FilterPanel>
    );
    const controls = screen.getByRole('button', { name: /filters/i }).getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls)).toBeInTheDocument();
  });
});
