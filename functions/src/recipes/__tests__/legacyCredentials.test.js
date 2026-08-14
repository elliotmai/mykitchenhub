/**
 * Legacy credential loading.
 *
 * The rule this suite exists to enforce: credentials come from Functions config
 * or the environment, and nothing — not even an error message — ever echoes a
 * secret back out.
 */

const {
  loadLegacyCredentials,
  getLegacyFirestore,
  LEGACY_APP_NAME,
} = require('../legacyCredentials');

const SERVICE_ACCOUNT = {
  project_id: 'lets-eat-legacy',
  client_email: 'sync@lets-eat-legacy.iam.gserviceaccount.com',
  private_key: '-----BEGIN TEST KEY-----\\nline-one\\nline-two\\n-----END TEST KEY-----\\n',
};

describe('loadLegacyCredentials', () => {
  it('reads a service account supplied as JSON', () => {
    const creds = loadLegacyCredentials({
      env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SERVICE_ACCOUNT) },
    });

    expect(creds.projectId).toBe('lets-eat-legacy');
    expect(creds.clientEmail).toBe(SERVICE_ACCOUNT.client_email);
  });

  it('reads a base64-encoded service account, which is how config stores it', () => {
    const encoded = Buffer.from(JSON.stringify(SERVICE_ACCOUNT)).toString('base64');

    const creds = loadLegacyCredentials({ env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: encoded } });

    expect(creds.projectId).toBe('lets-eat-legacy');
  });

  it('reads it from Firebase Functions config', () => {
    const creds = loadLegacyCredentials({
      env: {},
      config: { legacy: { service_account: JSON.stringify(SERVICE_ACCOUNT) } },
    });

    expect(creds.projectId).toBe('lets-eat-legacy');
  });

  it('turns escaped newlines in the private key back into real ones', () => {
    const creds = loadLegacyCredentials({
      env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SERVICE_ACCOUNT) },
    });

    expect(creds.privateKey).toContain('\n');
    expect(creds.privateKey).not.toContain('\\n');
  });

  it('accepts the three discrete variables', () => {
    const creds = loadLegacyCredentials({
      env: {
        LEGACY_FIREBASE_PROJECT_ID: 'lets-eat-legacy',
        LEGACY_FIREBASE_CLIENT_EMAIL: 'sync@example.com',
        LEGACY_FIREBASE_PRIVATE_KEY: 'key-material\\nsecond-line',
      },
    });

    expect(creds).toMatchObject({ projectId: 'lets-eat-legacy', clientEmail: 'sync@example.com' });
    expect(creds.privateKey).toBe('key-material\nsecond-line');
  });

  it('names the variables that are missing, so the fix is obvious', () => {
    expect(() => loadLegacyCredentials({ env: {} })).toThrow(/LEGACY_FIREBASE_PROJECT_ID/);
    expect(() => loadLegacyCredentials({ env: {} })).toThrow(/LEGACY_FIREBASE_CLIENT_EMAIL/);
  });

  it('never puts the credential itself into the error message', () => {
    const secret = 'super-secret-private-key-material';

    try {
      loadLegacyCredentials({ env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: `{"private_key":"${secret}"` } });
      throw new Error('expected the load to fail');
    } catch (err) {
      expect(err.message).not.toContain(secret);
    }
  });

  it('rejects a service account missing its key fields', () => {
    expect(() =>
      loadLegacyCredentials({
        env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'x' }) },
      })
    ).toThrow(/missing/i);
  });
});

describe('getLegacyFirestore', () => {
  const firestore = () => ({ __legacy: true });

  it('creates one named app for the legacy project', () => {
    const adminSdk = {
      apps: [],
      initializeApp: jest.fn(() => ({ name: LEGACY_APP_NAME, firestore })),
      credential: { cert: jest.fn((c) => c) },
    };

    getLegacyFirestore({
      adminSdk,
      env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SERVICE_ACCOUNT) },
    });

    expect(adminSdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(adminSdk.initializeApp.mock.calls[0][1]).toBe(LEGACY_APP_NAME);
  });

  it('reuses the app on a warm invocation instead of initialising twice', () => {
    const adminSdk = {
      apps: [{ name: LEGACY_APP_NAME, firestore }],
      initializeApp: jest.fn(),
      credential: { cert: jest.fn() },
    };

    const db = getLegacyFirestore({ adminSdk, env: {} });

    expect(db).toEqual({ __legacy: true });
    expect(adminSdk.initializeApp).not.toHaveBeenCalled();
  });

  it('does not touch the default app', () => {
    const adminSdk = {
      apps: [{ name: '[DEFAULT]', firestore: () => ({ __main: true }) }],
      initializeApp: jest.fn(() => ({ name: LEGACY_APP_NAME, firestore })),
      credential: { cert: jest.fn((c) => c) },
    };

    const db = getLegacyFirestore({
      adminSdk,
      env: { LEGACY_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SERVICE_ACCOUNT) },
    });

    expect(db).toEqual({ __legacy: true });
    expect(adminSdk.initializeApp).toHaveBeenCalled();
  });
});
