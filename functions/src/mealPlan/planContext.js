// functions/src/mealPlan/planContext.js
// Everything the planner needs to know about one kitchen — roadmap 7.2.
//
// Pure date helpers plus a Firestore read that gathers expiring ingredients,
// preferences, dietary restrictions, the HelloFresh schedule, and the recipes
// available to cook.

const RECIPE_LIMIT = 60;
const EXPIRING_WITHIN_DAYS = 7;

/** `YYYY-MM-DD` for a Date, in local time — the format meal plans use. */
const toDayKey = (date) => {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Parse a `YYYY-MM-DD` key back into a local Date at midnight. */
const fromDayKey = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const isDayKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The Monday of the week containing `date`. */
const startOfWeek = (date = new Date()) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

/** `days` consecutive day keys starting at `weekStart`. */
const weekDayKeys = (weekStart, days = 7) => {
  const start = fromDayKey(weekStart);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return toDayKey(d);
  });
};

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/** Firestore Timestamp, ISO string, or Date — all become a Date, or null. */
const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Days until an item goes off — negative when it already has. */
const daysUntil = (value, now = new Date()) => {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
};

const docsOf = (snapshot) => (snapshot?.docs || []).map((d) => ({ id: d.id, ...d.data() }));

/** Flatten the two shapes user preferences have been written in. */
const readPreferences = (profile = {}) => {
  const prefs = profile.preferences || {};
  const dietary = prefs.dietary || {};
  return {
    dietaryRestrictions: prefs.dietaryRestrictions || dietary.restrictions || [],
    allergies: dietary.allergies || [],
    dislikedIngredients: prefs.dislikedIngredients || dietary.dislikes || [],
    defaultServings: Number(prefs.defaultServings) > 0 ? Number(prefs.defaultServings) : 2,
  };
};

/** HelloFresh delivery days, as day keys inside the planned week. */
const readHelloFresh = (profile = {}, dayKeys = []) => {
  const hf = profile.helloFresh || {};
  const active = Boolean(hf.enabled ?? hf.active ?? hf.linked);
  // Stored as weekday numbers (1 = Monday) per the HelloFresh section.
  const deliveryDays = Array.isArray(hf.deliveryDays) ? hf.deliveryDays : [];
  const deliveryDayKeys = deliveryDays
    .map((weekday) => dayKeys[Number(weekday) - 1])
    .filter(Boolean);

  return {
    active,
    mealsPerWeek: Number(hf.mealsPerWeek) || 0,
    deliveryDayKeys,
  };
};

/**
 * Gather one user's planning context.
 *
 * @param {object} db      - firestore instance
 * @param {string} uid
 * @param {string} weekStart - `YYYY-MM-DD`
 * @param {number} days
 */
async function collectPlanContext(db, uid, weekStart, days = 7, now = new Date()) {
  const dayKeys = weekDayKeys(weekStart, days);
  const userRef = db.collection('users').doc(uid);

  const [profileSnap, inventorySnap, recipesSnap, entriesSnap] = await Promise.all([
    userRef.get(),
    userRef.collection('inventory').get(),
    db.collection('recipes').limit(RECIPE_LIMIT).get(),
    userRef.collection('mealPlanEntries').get(),
  ]);

  const profile = profileSnap && profileSnap.exists ? profileSnap.data() : {};
  const inventory = docsOf(inventorySnap).map((item) => ({
    name: item.name,
    normalized: normalize(item.normalized || item.name),
    quantity: Number(item.quantity) || 0,
    unit: item.unit || '',
    daysUntilExpiry: daysUntil(item.expiresAt, now),
  }));

  const expiring = inventory
    .filter((item) => item.daysUntilExpiry !== null && item.daysUntilExpiry <= EXPIRING_WITHIN_DAYS)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const recipes = docsOf(recipesSnap).map((recipe) => ({
    id: recipe.id,
    name: recipe.name || recipe.title || 'Untitled recipe',
    servings: Number(recipe.servings) || 2,
    difficulty: recipe.difficulty || 'medium',
    tags: recipe.tags || [],
    prepTime: recipe.prepTime ?? null,
    cookTime: recipe.cookTime ?? null,
    ingredients: (recipe.ingredients || []).map((ingredient) => ({
      name: ingredient.name ?? '',
      normalized: normalize(ingredient.normalized || ingredient.name),
      quantity: Number(ingredient.quantity) || 0,
      unit: ingredient.unit || '',
    })),
  }));

  const weekEntries = docsOf(entriesSnap).filter((entry) => dayKeys.includes(entry.date));
  const helloFresh = readHelloFresh(profile, dayKeys);

  // Days a delivered HelloFresh meal already owns — the planner must leave
  // these alone rather than double-booking dinner.
  const takenDays = [
    ...new Set(
      weekEntries
        .filter((entry) => entry.source === 'hellofresh' && entry.mealType === 'dinner')
        .map((entry) => entry.date)
    ),
  ];

  return {
    weekStart,
    dayKeys,
    openDays: dayKeys.filter((key) => !takenDays.includes(key)),
    takenDays,
    preferences: readPreferences(profile),
    helloFresh,
    inventory,
    expiring,
    recipes,
    existingEntries: weekEntries.map((entry) => ({
      date: entry.date,
      mealType: entry.mealType,
      recipeName: entry.recipeName,
      source: entry.source,
    })),
  };
}

module.exports = {
  collectPlanContext,
  toDayKey,
  fromDayKey,
  isDayKey,
  startOfWeek,
  weekDayKeys,
  normalize,
  daysUntil,
  readPreferences,
  readHelloFresh,
  RECIPE_LIMIT,
  EXPIRING_WITHIN_DAYS,
};
