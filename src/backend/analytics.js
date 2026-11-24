// src/backend/analytics.js
// Firebase Analytics left with Firebase. services/analytics.js keeps its shape
// (it was off anyway: no measurement id was ever configured), so these answer
// "not supported" and the app carries on exactly as it did.

export const isSupported = async () => false;
export const getAnalytics = () => null;
export const logEvent = () => {};
export const setUserProperties = () => {};
