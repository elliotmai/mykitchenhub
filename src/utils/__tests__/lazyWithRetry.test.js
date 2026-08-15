// src/utils/__tests__/lazyWithRetry.test.js

import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { lazyWithRetry, isStaleChunkError, clearChunkReloadGuard } from '../lazyWithRetry';

const Page = () => <div>the page</div>;
const chunkModule = { default: Page };

const renderLazy = (factory) => {
  const Lazy = lazyWithRetry(factory, 'Test');
  return render(
    <Suspense fallback={<div>loading</div>}>
      <Lazy />
    </Suspense>
  );
};

const staleChunkError = () => new Error('Loading chunk 42 failed. (missing: /static/js/42.js)');

let reload;

beforeEach(() => {
  sessionStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});

  reload = jest.fn();
  delete window.location;
  window.location = { reload, href: 'http://localhost/' };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('isStaleChunkError', () => {
  it.each([
    'Loading chunk 42 failed.',
    'Loading CSS chunk 7 failed',
    'error loading dynamically imported module: /assets/Recipes.js',
    'Importing a module script failed.',
  ])('recognises %s as a stale build', (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('does not mistake an ordinary network blip for a stale build', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('lazyWithRetry', () => {
  it('renders the page when the chunk arrives first time', async () => {
    renderLazy(async () => chunkModule);
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  it('renders the page after a dropped connection, without troubling the cook', async () => {
    const factory = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(chunkModule);

    renderLazy(factory);

    expect(await screen.findByText('the page')).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once for a chunk a new deploy renamed, rather than retrying a file that is gone', async () => {
    const factory = jest.fn().mockRejectedValue(staleChunkError());

    renderLazy(factory);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // Asking again for a file the deploy deleted can only fail.
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not reload twice — a second failure is a real error, not a stale build', async () => {
    sessionStorage.setItem('mykitchenhub.chunkReload', '1');
    const factory = jest.fn().mockRejectedValue(staleChunkError());

    renderLazy(factory);

    await waitFor(() => expect(factory).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it('re-arms the guard when a chunk actually arrives, so the next deploy gets its reload', async () => {
    sessionStorage.setItem('mykitchenhub.chunkReload', '1');

    renderLazy(async () => chunkModule);

    expect(await screen.findByText('the page')).toBeInTheDocument();
    expect(sessionStorage.getItem('mykitchenhub.chunkReload')).toBeNull();
  });

  it('can still be re-armed by hand', () => {
    sessionStorage.setItem('mykitchenhub.chunkReload', '1');
    clearChunkReloadGuard();
    expect(sessionStorage.getItem('mykitchenhub.chunkReload')).toBeNull();
  });

  it('lets a working page clear the guard a broken one set', async () => {
    // The other half of the same rule: once anything loads, the next deploy is
    // entitled to its own single reload.
    renderLazy(jest.fn().mockRejectedValue(staleChunkError()));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('mykitchenhub.chunkReload')).toBe('1');

    renderLazy(async () => chunkModule);
    expect(await screen.findByText('the page')).toBeInTheDocument();

    expect(sessionStorage.getItem('mykitchenhub.chunkReload')).toBeNull();
  });
});
