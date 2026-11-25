// src/dishes/newRecipe.js
// What happens to a recipe just added, so it lands in a dish with a cover
// without anyone sorting it by hand:
//   - a web page's photo is copied into the household's Storage
//     (coverSource { kind: 'web', pageUrl }), and
//   - the dish it most likely belongs to is suggested (suggestDish), or a new
//     dish named after it.
// RecipeFinish.jsx asks; several recipes at once take the suggestion.

import { doc, updateDoc } from '../backend/firestore';
import { db } from '../services/firebase';
import { copyCover } from '../services/recipeWeb';
import { dishOf, suggestDish } from './dishLogic';

const isOurs = (url) => /\/storage\/v1\/object\/public\/kitchen\//.test(String(url || ''));

/** Copy a web page's photo into Storage. Keeps the page's address on failure. */
export async function adoptWebCover(recipe) {
  if (!recipe?.imageUrl || recipe.coverSource?.kind !== 'web' || isOurs(recipe.imageUrl)) {
    return recipe?.imageUrl || null;
  }
  try {
    const { imageUrl } = await copyCover(recipe.id, recipe.imageUrl);
    await updateDoc(doc(db, 'recipes', recipe.id), { imageUrl });
    return imageUrl;
  } catch (err) {
    console.error('Could not copy the cover:', err?.message);
    return recipe.imageUrl;
  }
}

/** A freely licensed photo (an Openverse idea) as the recipe's cover. */
export async function ideaAsCover(recipe, idea) {
  let imageUrl = idea.url;
  try {
    imageUrl = (await copyCover(recipe.id, idea.url)).imageUrl;
  } catch (err) {
    console.error('Could not copy that photo; linking it instead:', err?.message);
  }
  await updateDoc(doc(db, 'recipes', recipe.id), {
    imageUrl,
    coverSource: {
      kind: 'openverse',
      pageUrl: idea.pageUrl || null,
      creator: idea.creator || null,
      license: idea.license,
      licenseVersion: idea.licenseVersion || null,
      licenseUrl: idea.licenseUrl || null,
    },
  });
  return imageUrl;
}

/** The dishes a new recipe could join: every dish but one it makes on its own. */
export const otherDishes = (dishes, recipeId) =>
  dishes.filter((d) => !(d.recipes.length === 1 && d.recipes[0].id === recipeId));

/** The suggested dish for a new recipe, or null (then it's a dish of its own). */
export const dishFor = (recipe, dishes) =>
  suggestDish(recipe.name, otherDishes(dishes, recipe.id))?.dish || null;

/** Put a recipe in a dish unless it is already there. */
export async function placeInDish(recipe, dish, dishes, actions) {
  if (!dish) return { success: true, unchanged: true };
  if (dishOf(dishes, recipe.id)?.id === dish.id) return { success: true, unchanged: true };
  return actions.moveRecipe(recipe.id, dish.id);
}
