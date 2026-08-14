import React from 'react';
import { renderWithProviders, screen } from '../../../test-utils';
import QuickActions, { QUICK_ACTIONS } from '../QuickActions';

describe('QuickActions', () => {
  it('offers every action as a working link', () => {
    renderWithProviders(<QuickActions />);

    QUICK_ACTIONS.forEach(({ to, label }) => {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', to);
    });
  });

  it('leads with adding an item — the thing people open the app to do', () => {
    renderWithProviders(<QuickActions />);

    expect(screen.getAllByRole('link')[0]).toHaveTextContent('Add an item');
  });

  it('points at routes the app actually has', () => {
    const routes = ['/inventory', '/meal-plan', '/recipes', '/analytics'];
    expect(QUICK_ACTIONS.map((a) => a.to)).toEqual(routes);
  });
});
