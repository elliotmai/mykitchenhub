// src/test-utils/mocks/functions.js
// Manual mock for `firebase/functions`.
//
// `httpsCallable(fns, 'name')` returns a jest.fn per function name — stable
// across calls, so a test can stub one callable and assert on it:
//
//   __callable('generateMealPlan').mockResolvedValue({ data: { days: [] } });
//   expect(__callable('generateMealPlan')).toHaveBeenCalledWith({ week: 1 });

const callables = new Map();

/** The jest.fn backing `httpsCallable(_, name)`. Created on first access. */
export const __callable = (name) => {
  if (!callables.has(name)) {
    callables.set(
      name,
      jest.fn(async () => ({ data: {} }))
    );
  }
  return callables.get(name);
};

/** Make a named callable reject, for error-path tests. */
export const __failCallable = (name, error = new Error('functions/internal')) => {
  __callable(name).mockRejectedValue(error);
};

export const getFunctions = jest.fn(() => ({ __functions: true }));
export const connectFunctionsEmulator = jest.fn();
export const httpsCallable = jest.fn((_functions, name) => __callable(name));
export const httpsCallableFromURL = jest.fn((_functions, url) => __callable(url));

export const __reset = () => {
  callables.clear();
};
