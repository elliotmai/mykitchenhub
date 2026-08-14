// functions/src/wasteAlerts/smsClient.js
// SMS delivery for the daily waste alert — roadmap 6.2.
//
// There is deliberately no SMS provider key configured for this project yet.
// That is not an error state: with no credential this module logs and returns
// a "skipped" result so the caller falls back to an in-app notification. It
// never throws, and it never logs the credential itself.
//
// Configure it by setting SMS_PROVIDER plus the matching key — see the
// "Environment variables" section of README.md.

const axios = require('axios');

/** Provider adapters. Add a provider here, not at the call site. */
const PROVIDERS = {
  textbelt: {
    keyVar: 'TEXTBELT_API_KEY',
    urlVar: 'TEXTBELT_API_URL',
    defaultUrl: 'https://textbelt.com/text',
    body: (phone, message, apiKey) => ({ phone, message, key: apiKey }),
    // Textbelt answers { success: true, textId, quotaRemaining }.
    succeeded: (data) => Boolean(data && data.success),
    failureReason: (data) => data?.error || 'provider rejected the message',
  },
  zixlow: {
    keyVar: 'ZIXLOW_API_KEY',
    urlVar: 'ZIXLOW_API_URL',
    defaultUrl: 'https://api.zixlow.com/v1/sms/send',
    body: (phone, message, apiKey, env) => ({
      to: phone,
      message,
      apiKey,
      sender: env.ZIXLOW_SENDER_ID || 'MyKitchenHub',
    }),
    succeeded: (data) => Boolean(data && (data.success || data.status === 'sent')),
    failureReason: (data) => data?.error || data?.message || 'provider rejected the message',
  },
};

const DEFAULT_PROVIDER = 'textbelt';

/** How long to wait on the provider before giving up, in milliseconds. */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Read the SMS configuration from the environment.
 *
 * `configured` being false is the normal state today and must never be treated
 * as a failure by callers.
 */
function getSmsConfig(env = process.env) {
  const name = String(env.SMS_PROVIDER || DEFAULT_PROVIDER)
    .toLowerCase()
    .trim();
  const provider = PROVIDERS[name];

  if (!provider) {
    return { provider: name, known: false, configured: false, apiKey: null, url: null };
  }

  const apiKey = env[provider.keyVar];

  return {
    provider: name,
    known: true,
    configured: Boolean(apiKey),
    apiKey: apiKey || null,
    url: env[provider.urlVar] || provider.defaultUrl,
  };
}

/**
 * Send one SMS, degrading gracefully when there is nothing to send it with.
 *
 * Always resolves — a texting problem must never take down the nightly job or
 * cost a user their in-app alert.
 *
 * @returns {Promise<{sent: boolean, skipped: boolean, reason: string|null, provider: string}>}
 */
async function sendSms(phoneNumber, message, options = {}) {
  const { env = process.env, http = axios } = options;
  const config = getSmsConfig(env);
  const result = { sent: false, skipped: true, reason: null, provider: config.provider };

  if (!config.known) {
    console.warn(
      `SMS provider "${config.provider}" is not one this app knows about — falling back to in-app notification`
    );
    return { ...result, reason: 'unknown-provider' };
  }

  if (!config.configured) {
    console.log(
      `No ${PROVIDERS[config.provider].keyVar} configured — skipping SMS and falling back to in-app notification`
    );
    return { ...result, reason: 'not-configured' };
  }

  if (!phoneNumber) {
    console.log('No phone number on file — skipping SMS');
    return { ...result, reason: 'no-phone-number' };
  }

  if (!message) {
    return { ...result, reason: 'empty-message' };
  }

  const provider = PROVIDERS[config.provider];

  try {
    const response = await http.post(
      config.url,
      provider.body(phoneNumber, message, config.apiKey, env),
      { timeout: REQUEST_TIMEOUT_MS }
    );

    if (provider.succeeded(response?.data)) {
      return { sent: true, skipped: false, reason: null, provider: config.provider };
    }

    // Log the provider's complaint, never the credential we sent with it.
    console.warn(`SMS not delivered: ${provider.failureReason(response?.data)}`);
    return { sent: false, skipped: false, reason: 'rejected', provider: config.provider };
  } catch (error) {
    console.error(`SMS request to ${config.provider} failed: ${error.message}`);
    return { sent: false, skipped: false, reason: 'request-failed', provider: config.provider };
  }
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  getSmsConfig,
  sendSms,
};
