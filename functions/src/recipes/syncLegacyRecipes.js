// functions/src/recipes/syncLegacyRecipes.js
// Roadmap 4.2 — import the "Let's Eat" recipe library into MyKitchenHub.
//
// The shape of the problem: ~500 legacy recipes, most of them with a name, a
// rough ingredient list and no instructions. For each one we try Spoonacular
// first (cheap, real recipes) and fall back to Claude (costs tokens). Both are
// paid, so the sync is built to be interruptible and bounded:
//
//   * one batch per invocation (`limit`, default 10, hard ceiling 100)
//   * a cursor in syncMetadata, so the next call resumes where this one stopped
//   * a running cost total checked *before* every paid call, against a ceiling
//   * a dry run that reads and reports but never writes and never spends
//
// RUNNING THIS COSTS MONEY. See README.md → "Legacy recipe sync" before you do.

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const { getLegacyFirestore } = require('./legacyCredentials');
const spoonacular = require('./spoonacular');
const claude = require('./claudeInstructions');
const { transformLegacyRecipe } = require('./transformLegacyRecipe');

/** Fixed document id the dashboard reads. */
const SYNC_DOC_ID = 'legacy-recipe-sync';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Ceiling on total spend across every run, in USD. */
const DEFAULT_COST_LIMIT_USD = 10;

/**
 * Worst-case cost of one Claude generation, used for the pre-flight budget
 * check (the real cost comes back with the response and replaces it).
 */
const CLAUDE_COST_ESTIMATE = 0.02;

/** Status values the dashboard renders. */
const STATUS = {
  IDLE: 'idle',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  COST_LIMIT: 'cost-limit-reached',
  DISABLED: 'disabled',
  ERROR: 'error',
};

/** Everything the metadata document holds before the first run. */
const emptyState = () => ({
  currentStatus: STATUS.IDLE,
  recipesToProcess: 0,
  recipesProcessed: 0,
  recipesImported: 0,
  recipesSkipped: 0,
  instructionSources: { spoonacular: 0, ai_generated: 0 },
  costAccumulated: 0,
  cursor: null,
  lastError: null,
  enabled: true,
});

const clampLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
};

/** Total legacy recipes, when the driver can count them cheaply. */
const countLegacyRecipes = async (legacyDb) => {
  try {
    const query = legacyDb.collectionGroup('recipes');
    if (typeof query.count !== 'function') return null;
    const snapshot = await query.count().get();
    return snapshot?.data?.()?.count ?? null;
  } catch (err) {
    // A missing count index is not worth failing a sync over.
    return null;
  }
};

/** Has this legacy recipe already been imported? */
const alreadyImported = async (db, legacyId) => {
  const existing = await db.collection('recipes').where('legacyId', '==', legacyId).limit(1).get();
  return !existing.empty;
};

/**
 * Run one batch of the legacy sync.
 *
 * Every collaborator is injected so the whole thing can be exercised against
 * fakes — no emulator, no network, no spend.
 *
 * @param {object} options
 * @param {number}  options.limit    - legacy recipes to attempt this run
 * @param {boolean} options.dryRun   - report only; no writes, no paid calls
 * @param {boolean} options.restart  - ignore the saved cursor
 * @param {object} deps
 * @param {object} deps.db           - MyKitchenHub Firestore
 * @param {object} deps.legacyDb     - legacy Firestore
 * @param {object} deps.spoonacular  - { findInstructions }
 * @param {object} deps.claude       - { generateInstructions }
 * @param {object} deps.env
 * @param {function} deps.now        - () => Date
 */
const runLegacySync = async (
  { limit = DEFAULT_LIMIT, dryRun = false, restart = false } = {},
  {
    db,
    legacyDb,
    spoonacular: spoon = spoonacular,
    claude: ai = claude,
    env = process.env,
    now = () => new Date(),
  } = {}
) => {
  const batchSize = clampLimit(limit);
  const costLimitUsd = Number(env.LEGACY_SYNC_MAX_COST_USD) || DEFAULT_COST_LIMIT_USD;
  const spoonacularKey = env.SPOONACULAR_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;

  const metaRef = db.collection('syncMetadata').doc(SYNC_DOC_ID);
  const metaSnap = await metaRef.get();
  const state = { ...emptyState(), ...(metaSnap.exists ? metaSnap.data() : {}) };

  // A switched-off sync stays off — the owner turns it back on deliberately.
  if (state.enabled === false && !dryRun) {
    return {
      status: STATUS.DISABLED,
      message: 'Sync is disabled in syncMetadata. Set enabled: true to run it.',
      processed: 0,
      imported: 0,
      skipped: 0,
      cost: 0,
      dryRun,
    };
  }

  let spent = Number(state.costAccumulated) || 0;
  const startingSpend = spent;
  const cursor = restart ? null : (state.cursor ?? null);

  // Ordering by document path makes the cursor a plain string we can store.
  let query = legacyDb.collectionGroup('recipes').orderBy('__name__').limit(batchSize);
  if (cursor) query = query.startAfter(legacyDb.doc(cursor));

  const snapshot = await query.get();
  const docs = snapshot.docs ?? [];

  const totalToProcess = (await countLegacyRecipes(legacyDb)) ?? state.recipesToProcess ?? 0;

  const batch = dryRun ? null : db.batch();
  const results = [];
  let imported = 0;
  let skipped = 0;
  let spoonacularWins = 0;
  let aiWins = 0;
  let costLimitHit = false;
  let lastCursor = cursor;

  for (const doc of docs) {
    const legacyId = doc.id;
    const legacyPath = doc.ref?.path ?? legacyId;

    // Advance the cursor even for a skip: a recipe already imported should not
    // be re-examined on the next run.
    lastCursor = legacyPath;

    if (await alreadyImported(db, legacyId)) {
      skipped += 1;
      results.push({ legacyId, action: 'skipped', reason: 'already-imported' });
      continue;
    }

    const recipe = transformLegacyRecipe(doc.data(), legacyId, {
      createdAt: now().toISOString(),
    });

    let instructionSource = recipe.instructions.length > 0 ? 'legacy' : null;

    // ── Fill in missing instructions ────────────────────────────────────────
    if (!instructionSource && !dryRun) {
      if (spent + spoonacular.DEFAULT_COST_PER_CALL > costLimitUsd) {
        costLimitHit = true;
        results.push({ legacyId, action: 'stopped', reason: 'cost-limit' });
        break;
      }

      const match = await spoon.findInstructions(recipe.name, { apiKey: spoonacularKey });
      spent += match.cost ?? 0;

      if (match.matched) {
        recipe.instructions = match.instructions;
        recipe.sourceId = match.sourceId ?? null;
        recipe.imageUrl = recipe.imageUrl ?? match.imageUrl ?? null;
        recipe.servings = match.servings ?? recipe.servings;
        recipe.cookTime = recipe.cookTime ?? match.cookTime ?? null;
        instructionSource = 'spoonacular';
        spoonacularWins += 1;
      }
    }

    if (!instructionSource && !dryRun) {
      if (spent + CLAUDE_COST_ESTIMATE > costLimitUsd) {
        costLimitHit = true;
        results.push({ legacyId, action: 'stopped', reason: 'cost-limit' });
        break;
      }

      const written = await ai.generateInstructions(
        { name: recipe.name, ingredients: recipe.ingredients },
        { apiKey: anthropicKey }
      );
      spent += written.cost ?? 0;

      if (written.generated) {
        recipe.instructions = written.instructions;
        instructionSource = 'ai-generated';
        aiWins += 1;
      }
    }

    // A recipe nobody could write instructions for is still worth having —
    // it is tagged so the app can show it as needing attention.
    const tags = [...recipe.tags];
    if (instructionSource === 'spoonacular') tags.push('spoonacular-instructions');
    if (instructionSource === 'ai-generated') tags.push('ai-instructions');
    if (!instructionSource) tags.push('needs-instructions');
    recipe.tags = [...new Set(tags)];

    if (recipe.instructions.length === 0) {
      recipe.instructions = ['Instructions were not available in the original recipe.'];
    }

    if (!dryRun) {
      batch.set(db.collection('recipes').doc(), recipe);
    }

    imported += 1;
    results.push({
      legacyId,
      name: recipe.name,
      action: dryRun ? 'would-import' : 'imported',
      instructionSource: instructionSource ?? 'none',
    });
  }

  const processed = imported + skipped;
  const exhausted = docs.length < batchSize;

  let status = STATUS.IN_PROGRESS;
  if (costLimitHit) status = STATUS.COST_LIMIT;
  else if (exhausted) status = STATUS.COMPLETED;

  if (!dryRun) {
    batch.set(
      metaRef,
      {
        legacyProjectId: env.LEGACY_FIREBASE_PROJECT_ID ?? state.legacyProjectId ?? null,
        enabled: state.enabled !== false,
        currentStatus: status,
        recipesToProcess: totalToProcess,
        recipesProcessed: (Number(state.recipesProcessed) || 0) + processed,
        recipesImported: (Number(state.recipesImported) || 0) + imported,
        recipesSkipped: (Number(state.recipesSkipped) || 0) + skipped,
        instructionSources: {
          spoonacular: (Number(state.instructionSources?.spoonacular) || 0) + spoonacularWins,
          ai_generated: (Number(state.instructionSources?.ai_generated) || 0) + aiWins,
        },
        costAccumulated: Number(spent.toFixed(4)),
        costLimitUsd,
        cursor: exhausted && !costLimitHit ? null : lastCursor,
        lastSyncTimestamp: now().toISOString(),
        lastError: costLimitHit
          ? `Stopped at the $${costLimitUsd} ceiling. Raise LEGACY_SYNC_MAX_COST_USD to continue.`
          : null,
      },
      { merge: true }
    );

    await batch.commit();
  }

  return {
    status,
    dryRun,
    processed,
    imported,
    skipped,
    cost: Number((spent - startingSpend).toFixed(4)),
    totalCost: Number(spent.toFixed(4)),
    costLimitUsd,
    instructionSources: { spoonacular: spoonacularWins, ai_generated: aiWins },
    cursor: exhausted && !costLimitHit ? null : lastCursor,
    results,
  };
};

/** Uids allowed to start a sync. Empty means "any signed-in user". */
const adminUids = (env = process.env) =>
  String(env.SYNC_ADMIN_UIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Callable entry point. The admin dashboard calls this with a batch size and,
 * usually, dryRun: true first.
 */
const syncLegacyRecipes = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data = {}, context) => {
    if (!context?.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in to run the legacy sync.');
    }

    const allowed = adminUids();
    if (allowed.length > 0 && !allowed.includes(context.auth.uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'This account cannot run the legacy sync.'
      );
    }

    let config = {};
    try {
      config = functions.config();
    } catch (err) {
      // Not deployed with runtime config; environment variables carry it.
      config = {};
    }

    try {
      const legacyDb = getLegacyFirestore({ config });

      return await runLegacySync(
        { limit: data.limit, dryRun: Boolean(data.dryRun), restart: Boolean(data.restart) },
        { db: admin.firestore(), legacyDb }
      );
    } catch (err) {
      console.error('Legacy sync failed:', err.message);

      // Record the failure so the dashboard shows it, then surface it.
      try {
        await admin
          .firestore()
          .collection('syncMetadata')
          .doc(SYNC_DOC_ID)
          .set({ currentStatus: STATUS.ERROR, lastError: err.message }, { merge: true });
      } catch (writeErr) {
        console.error('Could not record the sync failure:', writeErr.message);
      }

      throw new functions.https.HttpsError('internal', err.message);
    }
  });

module.exports = {
  SYNC_DOC_ID,
  STATUS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_COST_LIMIT_USD,
  CLAUDE_COST_ESTIMATE,
  clampLimit,
  emptyState,
  adminUids,
  runLegacySync,
  syncLegacyRecipes,
};
