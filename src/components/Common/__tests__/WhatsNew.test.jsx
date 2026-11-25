// The What's New popup must show each update at most once per device. Inside
// Hive (an iframe that remounts the app on every open) people go home without
// tapping close, so "seen" is recorded the moment it shows — and inside a frame
// it doesn't show at all, because Hive has its own What's New.

import React from 'react';
import { render, screen } from '@testing-library/react';

import WhatsNew from '../WhatsNew';
import { WHATS_NEW } from '../../../config/whatsNew';

// Must match STORAGE_KEY in ../WhatsNew.jsx.
const KEY = 'mykitchenhub.whatsNewSeen';

const setTop = (value) => Object.defineProperty(window, 'top', { configurable: true, get: value });
const realTop = Object.getOwnPropertyDescriptor(window, 'top');

afterEach(() => {
  localStorage.clear();
  if (realTop) Object.defineProperty(window, 'top', realTop);
});

describe('WhatsNew', () => {
  it('shows the latest entry and records it as seen without being dismissed', async () => {
    render(<WhatsNew />);

    expect(await screen.findByRole('button', { name: 'Got it' })).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(WHATS_NEW[0].version);
  });

  it('does not come back on the next open once shown', () => {
    localStorage.setItem(KEY, WHATS_NEW[0].version);
    render(<WhatsNew />);

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
  });

  it('stays hidden inside a frame but still marks the update seen', () => {
    setTop(() => ({}));
    render(<WhatsNew />);

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(WHATS_NEW[0].version);
  });

  it('treats a cross-origin parent that throws as a frame', () => {
    setTop(() => {
      throw new Error('SecurityError');
    });
    render(<WhatsNew />);

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(WHATS_NEW[0].version);
  });
});
