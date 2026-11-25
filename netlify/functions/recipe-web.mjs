/*
 * Recipes from the web, fetched here rather than in the browser (CORS):
 *   POST /api/recipeFromUrl  { url }            → { recipe, imageUrl, pageUrl }
 *        The page's schema.org Recipe (JSON-LD); its image, else og:image.
 *   POST /api/recipeCover    { recipeId, imageUrl, household }
 *        → { imageUrl }  The photo copied into Storage at
 *        kitchen/<household>/recipes/<recipeId>/cover.jpg.
 *   POST /api/coverIdeas     { q }              → { ideas: [...] }
 *        Freely licensed photos of a dish from Openverse, commercial-safe
 *        licences only, for a recipe with no page to take one from.
 * All three need a signed-in cook (callable in ../lib/kitchen.mjs).
 */
import scraper from '../../functions/src/hellofresh/helloFreshScraper.js';
import { callable, service } from '../lib/kitchen.mjs';
import { publicFetch, PublicFetchError } from '../lib/publicFetch.mjs';

const { extractJsonLd, findRecipeNode, parseJsonLdRecipe } = scraper;

const fail = (message, status = 'invalid-argument') =>
  Object.assign(new Error(message), { status });

const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** og:image / twitter:image, in either attribute order. */
export function metaImage(html) {
  for (const name of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    const esc = name.replace(/[:]/g, '\\:');
    const a = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)["']`, 'i')
    );
    const b = html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, 'i')
    );
    const hit = a?.[1] || b?.[1];
    if (hit) return decode(hit);
  }
  return null;
}

const titleOf = (html) => decode(html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || '');

const absolute = (value, base) => {
  try {
    return value ? new URL(value, base).href : null;
  } catch {
    return null;
  }
};

async function recipeFromUrl({ data }) {
  let page;
  try {
    page = await publicFetch(data.url, {
      accept: 'text/html,application/xhtml+xml',
      maxBytes: 4_000_000,
    });
  } catch (err) {
    throw fail(
      err instanceof PublicFetchError ? err.message : 'That page could not be loaded right now.',
      'failed-precondition'
    );
  }
  const html = page.body.toString('utf8');
  const node = findRecipeNode(extractJsonLd(html));
  const pageUrl = page.url.href;
  const image = absolute(
    (node && parseJsonLdRecipe(node, pageUrl).imageUrl) || metaImage(html),
    pageUrl
  );
  if (!node) {
    return { recipe: null, title: titleOf(html), imageUrl: image, pageUrl };
  }
  const raw = parseJsonLdRecipe(node, pageUrl);
  return {
    recipe: {
      name: decode(raw.name),
      ingredients: raw.ingredients.map((i) => decode(i)).filter(Boolean),
      instructions: raw.instructions.map((s) => decode(s)).filter(Boolean),
      servings: raw.servings,
      prepTime: raw.prepTime,
      cookTime: raw.cookTime,
      tags: raw.tags
        .map((t) => decode(t))
        .filter(Boolean)
        .slice(0, 20),
      description: decode(typeof node.description === 'string' ? node.description : '').slice(
        0,
        600
      ),
    },
    imageUrl: image,
    pageUrl,
  };
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)\b/i;

async function recipeCover({ householdId, data }) {
  const recipeId = String(data.recipeId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(recipeId)) throw fail('Which recipe?');
  if (data.household && data.household !== householdId) {
    throw fail('Covers can only be copied into your own household.', 'permission-denied');
  }
  let image;
  try {
    image = await publicFetch(data.imageUrl, { accept: 'image/*', maxBytes: 8_000_000 });
  } catch (err) {
    throw fail(
      err instanceof PublicFetchError ? err.message : 'That photo could not be loaded.',
      'failed-precondition'
    );
  }
  const type = image.type.split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.test(type)) throw fail('That link is not a photo.', 'failed-precondition');
  const path = `${householdId}/recipes/${recipeId}/cover.jpg`;
  const storage = service().storage.from('kitchen');
  const { error } = await storage.upload(path, image.body, {
    contentType: type,
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw fail('The photo could not be saved.', 'internal');
  const { data: pub } = storage.getPublicUrl(path);
  return { imageUrl: `${pub.publicUrl}?v=${Date.now()}` };
}

/** Openverse licences that allow any use, credited (cc0, pdm, by, by-sa). */
const SAFE = new Set(['cc0', 'pdm', 'by', 'by-sa']);

async function coverIdeas({ data }) {
  const q = String(data.q || '')
    .trim()
    .slice(0, 80);
  if (!q) return { ideas: [] };
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(`${q} food`)}&license=${[...SAFE].join(',')}&mature=false&page_size=12`;
  let res;
  try {
    res = await publicFetch(url, { accept: 'application/json', maxBytes: 1_000_000 });
  } catch {
    throw fail('Couldn’t look for photos right now.', 'failed-precondition');
  }
  let body;
  try {
    body = JSON.parse(res.body.toString('utf8'));
  } catch {
    return { ideas: [] };
  }
  const ideas = (body.results || [])
    .filter((r) => SAFE.has(String(r.license).toLowerCase()) && r.url)
    .slice(0, 3)
    .map((r) => ({
      url: r.url,
      thumbnail: r.thumbnail || r.url,
      title: String(r.title || '').slice(0, 120),
      creator: String(r.creator || '').slice(0, 80),
      license: String(r.license).toLowerCase(),
      licenseVersion: r.license_version || '',
      licenseUrl: r.license_url || '',
      pageUrl: r.foreign_landing_url || '',
    }));
  return { ideas };
}

const HANDLERS = { recipeFromUrl, recipeCover, coverIdeas };

export default async (req) => {
  const name = new URL(req.url).pathname.split('/').pop();
  return callable(HANDLERS[name] || recipeFromUrl)(req);
};

export const config = { path: ['/api/recipeFromUrl', '/api/recipeCover', '/api/coverIdeas'] };
