// src/dishes/dishLogic.js
// Dishes: many recipes for the same food ("Lasagna": Grandma's, the quick one,
// the one from the HelloFresh card) shown as one thing with its recipes under
// it. Pure functions, so the grouping is easy to trust and to test.
//
// A recipe's dish is, in order:
//   1. the dish it was put in by hand (`recipe.dishId`), else
//   2. the dish its name means once the noise is taken out: case, accents,
//      punctuation, plurals, and words that describe a version of a dish
//      rather than the dish ("Grandma's", "easy", "the best", "homemade").
// A name with a subtitle in brackets, "Go Big Spud (Cheesy Loaded Potato
// Soup)", joins the dish the brackets name when another recipe already is
// that dish; otherwise the brackets are just dropped.
//
// Dish documents (kitchen.docs 'dishes/<id>') only hold what a person
// decided: a name, a favourite recipe, or that the dish was merged into
// another (`mergedInto`). Without one, a dish is named after its recipes.

/** Words that describe a version of a dish, not the dish. */
const VERSION_WORDS = new Set([
  'a',
  'an',
  'the',
  'my',
  'our',
  'your',
  'best',
  'easy',
  'easiest',
  'quick',
  'quickest',
  'simple',
  'homemade',
  'home',
  'made',
  'classic',
  'perfect',
  'ultimate',
  'healthy',
  'healthier',
  'authentic',
  'famous',
  'favorite',
  'favourite',
  'copycat',
  'creamy',
  'recipe',
  'style',
  'original',
  'old',
  'fashioned',
  'traditional',
  'basic',
  'simply',
  'super',
  'really',
  'very',
  'delicious',
  'yummy',
  'amazing',
  'world',
  'worlds',
  'grandma',
  'grandmas',
  'granny',
  'nana',
  'nanas',
  'mom',
  'moms',
  'mum',
  'mums',
  'mother',
  'mothers',
  'dad',
  'dads',
  'aunt',
  'aunts',
  'auntie',
  'family',
]);

/** Little words that join others and change nothing ("mac n cheese" = "mac and cheese"). */
const JOINERS = new Set(['and', 'n', 'with', 'w', 'of', 'in', 'on', 'for']);

/** "potatoes" → "potato", "berries" → "berry", "dishes" → "dish", "ribs" → "rib". */
export function singular(word) {
  if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The words of a name as they are compared: lower case, no accents or punctuation. */
const words = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]s\b/g, 's')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** What a name means as a dish: "Grandma's Easy Lasagnas!" → "lasagna". */
export function dishKey(name) {
  const kept = words(String(name ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
    .filter((w) => !VERSION_WORDS.has(w) && !JOINERS.has(w))
    .map(singular);
  if (kept.length) return kept.join(' ');
  // Nothing left ("The Best One"): fall back to the plain words.
  return words(name).map(singular).join(' ');
}

/** The dish named in brackets, if any: "Go Big Spud (Cheesy Loaded Potato Soup)". */
export const bracketKey = (name) => {
  const inner = /\(([^)]+)\)/.exec(String(name ?? ''));
  return inner ? dishKey(inner[1]) : null;
};

/** A dish id from its key: "cheesy loaded potato soup" → "cheesy-loaded-potato-soup". */
export const dishIdFor = (key) => (key || 'untitled').replace(/\s+/g, '-').slice(0, 80);

/** Follow merges: a dish merged into another lives on as that one. */
export function resolveDish(id, dishDocs = {}) {
  let current = id;
  const seen = new Set();
  while (dishDocs[current]?.mergedInto && !seen.has(current)) {
    seen.add(current);
    current = dishDocs[current].mergedInto;
  }
  return current;
}

/** Title Case for a dish named after its recipes' common key. */
const titleCase = (text) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The dish each recipe belongs to: { [recipeId]: dishId }.
 * Hand-placed recipes first, then names, then bracketed subtitles that match
 * a dish some other recipe already is.
 */
export function assignDishes(recipes = [], dishDocs = {}) {
  const byName = new Map();
  const auto = {};
  for (const r of recipes) {
    const id = dishIdFor(dishKey(r.name || r.title));
    auto[r.id] = id;
    byName.set(id, (byName.get(id) || 0) + 1);
  }
  const out = {};
  for (const r of recipes) {
    let id = r.dishId || auto[r.id];
    if (!r.dishId) {
      const inner = bracketKey(r.name || r.title);
      const innerId = inner && dishIdFor(inner);
      const others = innerId && (byName.get(innerId) || 0) - (innerId === auto[r.id] ? 1 : 0);
      if (innerId && others > 0) id = innerId;
    }
    out[r.id] = resolveDish(id, dishDocs);
  }
  return out;
}

const cooked = (r) => Number(r.timesCooked) || 0;

/**
 * Dishes from recipes: [{ id, name, recipes, favorite, favoriteId, named }],
 * alphabetical, each dish's recipes with the favourite first, then most cooked.
 */
export function groupDishes(recipes = [], dishDocs = {}) {
  const assignment = assignDishes(recipes, dishDocs);
  const groups = new Map();
  for (const r of recipes) {
    const id = assignment[r.id];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  return [...groups.entries()]
    .map(([id, list]) => {
      const doc = dishDocs[id] || {};
      const favoriteId = list.some((r) => r.id === doc.favoriteRecipeId)
        ? doc.favoriteRecipeId
        : null;
      const sorted = [...list].sort(
        (a, b) =>
          (b.id === favoriteId) - (a.id === favoriteId) ||
          cooked(b) - cooked(a) ||
          String(a.name || '').localeCompare(String(b.name || ''))
      );
      // Unnamed: the shortest recipe name that is plainly this dish, else the key.
      const plain = list
        .map((r) => String(r.name || r.title || '').trim())
        .filter((n) => n && dishIdFor(dishKey(n)) === id)
        .sort((a, b) => a.length - b.length)[0];
      const name = doc.name || plain || titleCase(id.replace(/-/g, ' '));
      return {
        id,
        name,
        named: Boolean(doc.name),
        recipes: sorted,
        favoriteId,
        favorite: sorted[0],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The dish a recipe is in, from groupDishes' output. */
export const dishOf = (dishes, recipeId) =>
  dishes.find((d) => d.recipes.some((r) => r.id === recipeId)) || null;

/** The recipe to cook for a dish: the favourite, else the most cooked. */
export const recipeToCook = (dish) => dish?.favorite || null;

/** A new dish's id for a typed name, not clashing with one that exists. */
export function newDishId(name, existingIds = []) {
  const base = dishIdFor(dishKey(name));
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
