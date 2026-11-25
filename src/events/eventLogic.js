// src/events/eventLogic.js
// Meal planning by events, the way Let's Eat did it: "Thanksgiving", with a
// date or none, guests and notes, and a menu of dishes and recipes. An event
// can run over several days ("Christmas": Eve, the Day, Boxing Day), each
// with its own date, menu and status. Its menus feed the shopping list.
//
// Events are kitchen.docs 'events/<id>', the household's. Pure functions here:
// each change returns a new event for the hook to save.

import { ingredientKey } from '../utils/ingredientMeasure';

/** Let's Eat's statuses: what the day still needs. */
export const EVENT_STATUSES = ['Not Started', 'Shopping', 'Cooking', 'Done'];

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const newId = () => Math.random().toString(36).slice(2, 10);

/** A new event with its one day. */
export function newEvent({ name, date = null, guests = '', notes = '' } = {}, makeId = newId) {
  const clean = String(name ?? '').trim();
  if (!clean) return null;
  return {
    name: clean.slice(0, 120),
    guests: String(guests ?? '')
      .trim()
      .slice(0, 500),
    notes: String(notes ?? '')
      .trim()
      .slice(0, 2000),
    days: [
      {
        id: makeId(),
        name: clean.slice(0, 120),
        date: isDay(date) ? date : null,
        status: 'Not Started',
        menu: [],
      },
    ],
  };
}

const mapDays = (event, fn) => ({ ...event, days: (event.days || []).map(fn) });

export const addDay = (event, { name = '', date = null } = {}, makeId = newId) => ({
  ...event,
  days: [
    ...(event.days || []),
    {
      id: makeId(),
      name: String(name).trim().slice(0, 120) || `Day ${(event.days || []).length + 1}`,
      date: isDay(date) ? date : null,
      status: 'Not Started',
      menu: [],
    },
  ],
});

export const removeDay = (event, dayId) => ({
  ...event,
  days: (event.days || []).filter((d) => d.id !== dayId),
});

/** Change a day's name, date or status. */
export const updateDay = (event, dayId, patch = {}) =>
  mapDays(event, (d) => {
    if (d.id !== dayId) return d;
    const next = { ...d };
    if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 120) || d.name;
    if (patch.date !== undefined) next.date = isDay(patch.date) ? patch.date : null;
    if (patch.status !== undefined && EVENT_STATUSES.includes(patch.status))
      next.status = patch.status;
    return next;
  });

/** Put a dish ({ dishId }) or one recipe ({ recipeId }) on a day's menu, once. */
export const addToMenu = (
  event,
  dayId,
  { dishId = null, recipeId = null, label = '', recipeIds = null } = {}
) => {
  if (!dishId && !recipeId) return event;
  return mapDays(event, (d) => {
    if (d.id !== dayId) return d;
    const menu = d.menu || [];
    if (
      menu.some(
        (m) =>
          (dishId && m.dishId === dishId && !m.recipeId) || (recipeId && m.recipeId === recipeId)
      )
    )
      return d;
    return {
      ...d,
      menu: [
        ...menu,
        {
          ...(dishId ? { dishId } : {}),
          ...(recipeId ? { recipeId } : {}),
          // A dish's recipes as it stands, so a guest on this event may read them.
          ...(dishId && Array.isArray(recipeIds) ? { recipeIds: recipeIds.slice(0, 50) } : {}),
          label: String(label).slice(0, 120),
        },
      ],
    };
  });
};

export const removeFromMenu = (event, dayId, index) =>
  mapDays(event, (d) =>
    d.id === dayId ? { ...d, menu: (d.menu || []).filter((_, i) => i !== index) } : d
  );

/**
 * Each dish line with the ids of its dish's recipes now: a guest on the event
 * may read exactly those (kitchen.on_my_event_menu in the database).
 */
export const snapshotDishRecipes = (event, dishes = []) =>
  mapDays(event, (d) => ({
    ...d,
    menu: (d.menu || []).map((m) => {
      const dish = m.dishId ? dishes.find((x) => x.id === m.dishId) : null;
      return dish ? { ...m, recipeIds: dish.recipes.map((r) => r.id).slice(0, 50) } : m;
    }),
  }));

/** Who is bringing a menu line ("Aunt Sue"), or '' to clear it. */
export const setBringing = (event, dayId, index, who) =>
  mapDays(event, (d) =>
    d.id === dayId
      ? {
          ...d,
          menu: (d.menu || []).map((m, i) => {
            if (i !== index) return m;
            const name = String(who ?? '')
              .trim()
              .slice(0, 80);
            const { bringing, ...rest } = m;
            return name ? { ...rest, bringing: name } : rest;
          }),
        }
      : d
  );

/** The days an event has, earliest first, undated last. */
export const sortedDays = (event) =>
  [...(event.days || [])].sort(
    (a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date).localeCompare(String(b.date))
  );

/** An event still ahead: any day today or later, or not dated yet. */
export const isUpcoming = (event, today) =>
  (event.days || []).length === 0 || (event.days || []).some((d) => !d.date || d.date >= today);

/** Upcoming first (soonest, then undated), then past (most recent first). */
export function sortEvents(events = [], today) {
  const first = (e) => sortedDays(e).find((d) => d.date)?.date || null;
  const upcoming = events.filter((e) => isUpcoming(e, today));
  const past = events.filter((e) => !isUpcoming(e, today));
  upcoming.sort(
    (a, b) =>
      (first(a) ? 0 : 1) - (first(b) ? 0 : 1) ||
      String(first(a)).localeCompare(String(first(b))) ||
      a.name.localeCompare(b.name)
  );
  past.sort((a, b) => String(first(b)).localeCompare(String(first(a))));
  return { upcoming, past };
}

/**
 * The recipe each menu line will be cooked from: the recipe itself, or the
 * dish's favourite (else most cooked). Lines whose recipe is gone keep their label.
 */
export function menuRecipes(day, dishes = [], recipesById = {}) {
  return (day.menu || []).map((m) => {
    const dish = m.dishId ? dishes.find((d) => d.id === m.dishId) : null;
    const recipe = (m.recipeId && recipesById[m.recipeId]) || dish?.favorite || null;
    return {
      line: m,
      dish,
      recipe,
      label: recipe?.name || dish?.name || m.label || 'A recipe no longer in the library',
    };
  });
}

/**
 * Shopping lines for some event days: each recipe's ingredients by name (no
 * amounts), once each, leaving out what is already waiting on the list.
 */
export function shoppingLines(
  days = [],
  dishes = [],
  recipesById = {},
  onList = [],
  eventId = null
) {
  const have = new Set(
    onList.filter((i) => i.status !== 'bought').map((i) => ingredientKey(i.normalized || i.name))
  );
  const out = [];
  for (const day of days) {
    for (const { recipe } of menuRecipes(day, dishes, recipesById)) {
      for (const ing of recipe?.ingredients || []) {
        const name = String(ing?.name ?? ing ?? '').trim();
        const key = ingredientKey(name);
        if (!name || !key || have.has(key)) continue;
        have.add(key);
        out.push({ name, recipeName: recipe.name, ...(eventId ? { eventId } : {}) });
      }
    }
  }
  return out;
}

/** Lower case, no accents, single spaces: what "contains" compares. */
const searchable = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * What the menu search offers for a query: dishes and recipes whose name
 * contains every word typed, in any order ("chili dip" finds "Cream Cheese
 * Chili Dip"). A dish with several recipes offers "any recipe" first, then
 * its matching recipes; a match on the dish's name keeps all its recipes.
 * Options: [{ kind: 'dish'|'recipe', id, label, dishName? }]. An empty query
 * offers everything.
 */
export function searchMenuOptions(dishes = [], query = '', label = (r) => r?.name || r?.title || 'Untitled recipe') {
  const words = searchable(query).split(' ').filter(Boolean);
  const hit = (text) => {
    const s = searchable(text);
    return words.every((w) => s.includes(w));
  };
  const out = [];
  for (const dish of dishes) {
    const recipes = dish.recipes || [];
    if (!recipes.length) continue;
    const dishHit = hit(dish.name);
    const matching = dishHit ? recipes : recipes.filter((r) => hit(label(r)));
    if (!matching.length) continue;
    if (recipes.length === 1) {
      out.push({ kind: 'recipe', id: recipes[0].id, label: label(recipes[0]) });
      continue;
    }
    out.push({ kind: 'dish', id: dish.id, label: `${dish.name} (any recipe)` });
    for (const r of matching) out.push({ kind: 'recipe', id: r.id, label: label(r), dishName: dish.name });
  }
  return out;
}
