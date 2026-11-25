// src/services/recipeWeb.js
// The web side of adding a recipe, done by netlify/functions/recipe-web.mjs
// (the browser can't read other sites): a recipe from its page, its photo
// copied into the household's Storage, and freely licensed photo ideas for a
// recipe that has no page.

import { getFunctions, httpsCallable } from '../backend/functions';
import { myHousehold } from '../backend/supabase';

const call = (name) => httpsCallable(getFunctions(), name);

/** { recipe | null, title, imageUrl, pageUrl } */
export const recipeFromUrl = async (url) =>
  (await call('recipeFromUrl')({ url: String(url ?? '').trim() })).data;

/** Copy a photo into Storage as the recipe's cover: { imageUrl }. */
export const copyCover = async (recipeId, imageUrl) =>
  (await call('recipeCover')({ recipeId, imageUrl, household: await myHousehold() })).data;

/** Up to three freely licensed photos of a dish. */
export const coverIdeas = async (q) => (await call('coverIdeas')({ q })).data?.ideas || [];

/** "Photo: Jane Doe, CC BY 2.0" */
export const ideaCredit = (idea) =>
  [
    idea.creator ? `Photo: ${idea.creator}` : 'Photo',
    idea.license === 'cc0'
      ? 'CC0'
      : idea.license === 'pdm'
        ? 'public domain'
        : `CC ${idea.license.toUpperCase()} ${idea.licenseVersion}`.trim(),
  ].join(', ');
