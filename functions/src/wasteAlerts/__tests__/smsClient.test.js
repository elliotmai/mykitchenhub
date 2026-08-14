/**
 * The SMS client, tested entirely against a mocked HTTP client — no test in
 * this repo may cost money or send a real text.
 *
 * The most important behaviour is the one that applies today: with no provider
 * key configured, sending must skip quietly rather than throw, so the caller
 * falls back to an in-app notification.
 */

const { getSmsConfig, sendSms, PROVIDERS } = require('../smsClient');

/** An axios-alike that records what it was asked to post. */
const makeHttp = (response = { data: { success: true } }) => ({
  post: jest.fn(async () => response),
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getSmsConfig', () => {
  it('defaults to Textbelt when no provider is named', () => {
    const config = getSmsConfig({});
    expect(config.provider).toBe('textbelt');
    expect(config.known).toBe(true);
    expect(config.configured).toBe(false);
  });

  it('reports itself configured once the key is present', () => {
    const config = getSmsConfig({ TEXTBELT_API_KEY: 'test-key' });
    expect(config.configured).toBe(true);
  });

  it('reads the key belonging to the chosen provider', () => {
    const config = getSmsConfig({ SMS_PROVIDER: 'zixlow', ZIXLOW_API_KEY: 'test-key' });
    expect(config.provider).toBe('zixlow');
    expect(config.configured).toBe(true);
  });

  it('does not treat one provider\'s key as another\'s', () => {
    const config = getSmsConfig({ SMS_PROVIDER: 'zixlow', TEXTBELT_API_KEY: 'test-key' });
    expect(config.configured).toBe(false);
  });

  it('lets the endpoint be overridden, for a sandbox', () => {
    const config = getSmsConfig({ TEXTBELT_API_URL: 'https://example.test/send' });
    expect(config.url).toBe('https://example.test/send');
  });

  it('flags a provider it has never heard of', () => {
    expect(getSmsConfig({ SMS_PROVIDER: 'carrier-pigeon' }).known).toBe(false);
  });

  it('is case- and whitespace-insensitive about the provider name', () => {
    expect(getSmsConfig({ SMS_PROVIDER: '  TextBelt ' }).provider).toBe('textbelt');
  });
});

describe('sendSms with no provider key — the state of this project today', () => {
  it('skips quietly instead of throwing', async () => {
    const http = makeHttp();

    const result = await sendSms('+15551234567', 'Your spinach is going off', { env: {}, http });

    expect(result).toEqual({
      sent: false,
      skipped: true,
      reason: 'not-configured',
      provider: 'textbelt',
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('says which variable would switch it on, so the log is actionable', async () => {
    await sendSms('+15551234567', 'hello', { env: {}, http: makeHttp() });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TEXTBELT_API_KEY'));
  });

  it('skips an unknown provider rather than posting somewhere random', async () => {
    const http = makeHttp();

    const result = await sendSms('+15551234567', 'hello', {
      env: { SMS_PROVIDER: 'carrier-pigeon', TEXTBELT_API_KEY: 'k' },
      http,
    });

    expect(result.reason).toBe('unknown-provider');
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe('sendSms when a provider is configured', () => {
  it('posts to Textbelt in the shape its API expects', async () => {
    const http = makeHttp({ data: { success: true, textId: '123' } });

    const result = await sendSms('+15551234567', 'Your spinach is going off', {
      env: { TEXTBELT_API_KEY: 'test-key' },
      http,
    });

    expect(result).toEqual({ sent: true, skipped: false, reason: null, provider: 'textbelt' });
    expect(http.post).toHaveBeenCalledWith(
      PROVIDERS.textbelt.defaultUrl,
      { phone: '+15551234567', message: 'Your spinach is going off', key: 'test-key' },
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });

  it('posts to Zixlow in the shape its API expects', async () => {
    const http = makeHttp({ data: { status: 'sent' } });

    const result = await sendSms('+15551234567', 'hello', {
      env: { SMS_PROVIDER: 'zixlow', ZIXLOW_API_KEY: 'test-key', ZIXLOW_SENDER_ID: 'Kitchen' },
      http,
    });

    expect(result.sent).toBe(true);
    expect(http.post.mock.calls[0][1]).toEqual({
      to: '+15551234567',
      message: 'hello',
      apiKey: 'test-key',
      sender: 'Kitchen',
    });
  });

  it('reports a provider rejection without throwing', async () => {
    const http = makeHttp({ data: { success: false, error: 'Out of quota' } });

    const result = await sendSms('+15551234567', 'hello', {
      env: { TEXTBELT_API_KEY: 'test-key' },
      http,
    });

    expect(result).toMatchObject({ sent: false, skipped: false, reason: 'rejected' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Out of quota'));
  });

  it('survives a network failure', async () => {
    const http = { post: jest.fn(async () => { throw new Error('ETIMEDOUT'); }) };

    const result = await sendSms('+15551234567', 'hello', {
      env: { TEXTBELT_API_KEY: 'test-key' },
      http,
    });

    expect(result).toMatchObject({ sent: false, skipped: false, reason: 'request-failed' });
  });

  it('never writes the credential to the log', async () => {
    const http = { post: jest.fn(async () => { throw new Error('ETIMEDOUT'); }) };

    await sendSms('+15551234567', 'hello', {
      env: { TEXTBELT_API_KEY: 'super-secret-key' },
      http,
    });

    const everythingLogged = [console.log, console.warn, console.error]
      .flatMap((fn) => fn.mock.calls.flat())
      .join(' ');
    expect(everythingLogged).not.toContain('super-secret-key');
  });

  it('skips a user with no phone number on file', async () => {
    const http = makeHttp();

    const result = await sendSms('', 'hello', { env: { TEXTBELT_API_KEY: 'test-key' }, http });

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'no-phone-number' });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('refuses to send an empty message', async () => {
    const http = makeHttp();

    const result = await sendSms('+15551234567', '', {
      env: { TEXTBELT_API_KEY: 'test-key' },
      http,
    });

    expect(result.reason).toBe('empty-message');
    expect(http.post).not.toHaveBeenCalled();
  });
});
