// src/utils/tags.js
// Recipe tags, kept tidy: stored trimmed and lower case with no repeats
// ("Dinner", "dinner " and "DINNER" are one tag), shown in sentence case, and
// matched case-insensitively. A new tag that is only a plural or singular of
// one already used ("potato" when "potatoes" exists) becomes the existing one,
// so near-duplicates don't creep back in.

/** One tag as stored: "  Main  Course " → "main course". */
export const normalizeTag = (value) =>
  String(value ?? '')
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** A list of tags as stored: normalized, no blanks, no repeats, first spelling wins. */
export const normalizeTags = (tags) => {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    const tag = normalizeTag(t);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
};

/** "main course" → "Main course" (display only; the stored value stays lower case). */
export const tagLabel = (tag) => {
  const t = String(tag ?? '');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

const variants = (tag) => {
  const v = new Set([tag]);
  if (tag.endsWith('ies')) {
    v.add(`${tag.slice(0, -3)}y`);
    v.add(tag.slice(0, -1));
  } else if (tag.endsWith('es')) {
    v.add(tag.slice(0, -2));
    v.add(tag.slice(0, -1));
  } else if (tag.endsWith('s')) v.add(tag.slice(0, -1));
  if (tag.endsWith('y')) v.add(`${tag.slice(0, -1)}ies`);
  v.add(`${tag}s`);
  v.add(`${tag}es`);
  return v;
};

/**
 * The tag to store for what the cook typed: an existing tag when it is the
 * same word (any case, or a plural/singular of it), else the typed tag.
 */
export const matchExistingTag = (raw, existing = []) => {
  const tag = normalizeTag(raw);
  if (!tag) return '';
  const known = normalizeTags(existing);
  if (known.includes(tag)) return tag;
  const forms = variants(tag);
  return known.find((k) => forms.has(k)) || tag;
};

/** Existing tags that start with (then contain) what is typed, for suggestions. */
export const suggestTags = (typed, existing = [], exclude = [], max = 8) => {
  const q = normalizeTag(typed);
  const skip = new Set(normalizeTags(exclude));
  const known = normalizeTags(existing).filter((t) => !skip.has(t));
  if (!q) return known.slice(0, max);
  const starts = known.filter((t) => t.startsWith(q));
  const contains = known.filter((t) => !t.startsWith(q) && t.includes(q));
  return [...starts, ...contains].slice(0, max);
};
