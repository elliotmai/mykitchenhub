// src/utils/lazyWithRetry.js
// React.lazy that survives a failed chunk download — roadmap 9.2/9.3.
//
// Splitting the routes into chunks (App.jsx) buys a much smaller first load,
// and costs one new failure mode: the page is now a separate network request
// that can fail after the app is already running. Two ways it does, both real:
//
//   1. A tap on "Recipes" the moment the signal drops. Nothing is wrong with
//      the app; the request just needs making again.
//   2. A deploy lands while the tab is open. The running index.html asks for
//      chunk `Recipes.a1b2c3.js`, which the new build renamed. That one never
//      succeeds however many times we ask, and the fix is to reload so the
//      browser picks up the new index.html.
//
// Plain React.lazy turns both into the ErrorBoundary's crash screen, which
// tells a cook their kitchen is broken when it is not.

import { lazy } from 'react';
import { withRetry } from './retry';

/** Session key marking that we already reloaded for this chunk. */
const RELOADED_KEY = 'mykitchenhub.chunkReload';

/**
 * True when a failed dynamic import looks like a stale build rather than a
 * flaky connection. Browsers word this differently, hence the alternation.
 */
export const isStaleChunkError = (err) =>
  /Loading chunk \d+ failed|Loading CSS chunk|ChunkLoadError|error loading dynamically imported module|Importing a module script failed/i.test(
    err?.message ?? ''
  );

/**
 * `React.lazy`, but the import is retried before it is allowed to fail.
 *
 * @param {() => Promise<{default: React.ComponentType}>} factory  what lazy() takes
 * @param {string} name  the page, for the console line if it does fail
 */
export const lazyWithRetry = (factory, name = 'page') =>
  lazy(() =>
    withRetry(factory, {
      backoffMs: 200,
      // A dynamic import rejects with a plain Error carrying no Firebase code,
      // so the default retryable test would not recognise it. Every failure
      // here is worth one more attempt: the module either arrives or it does
      // not, and asking twice costs nothing when it is already cached.
      shouldRetry: (err) => !isStaleChunkError(err),
    }).catch((err) => {
      console.error(`Failed to load the ${name} page:`, err);

      // A stale chunk cannot be fixed by asking again — the file is gone. One
      // reload picks up the index.html that knows the new name. The session
      // flag is what stops that becoming a reload loop when something else is
      // wrong: reload once, and if the next attempt fails too, let the error
      // reach the ErrorBoundary where a person can see it.
      if (isStaleChunkError(err) && !sessionStorage.getItem(RELOADED_KEY)) {
        sessionStorage.setItem(RELOADED_KEY, '1');
        window.location.reload();
        // Never resolves; the reload is already underway.
        return new Promise(() => {});
      }

      throw err;
    })
  );

/** Clears the reload guard once a page has loaded successfully. */
export const clearChunkReloadGuard = () => {
  try {
    sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Private-mode Safari can throw on sessionStorage; the guard is optional.
  }
};

export default lazyWithRetry;
