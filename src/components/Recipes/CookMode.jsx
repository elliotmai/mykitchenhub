// src/components/Recipes/CookMode.jsx
// Cook mode: a recipe as full-screen cards, one at a time.
//
// The first card gathers the ingredients (tap each one once it is out), then
// the steps follow, each card showing what it needs and how much of it beside
// the words. A step the cook can walk away from (the oven preheating, pasta
// boiling for 10 minutes) shares its card with the prep that can happen
// during the wait, so the onions get chopped while the oven heats
// (cookPlan.js). Every card ends with a peek at what comes next, and shrinks
// its text to fit the screen rather than scroll: on a tablet propped on the
// counter, nobody is scrolling with wet hands.
//
// Back / Next, the arrow keys, a swipe, or the progress dots move between
// cards; Escape or the close button leaves. The last card can log the cook
// ("I cooked this"), which is what the recipe page's own button does.
//
// While it is open, nothing takes the screen away: not the fridge tablet's
// idle return, and not Hive's 15-minute return to Fridge Board
// (useCookingHold).
//
// It works on any recipe, planned or not: everything it needs is the recipe.
//
// It sits just under the timer tray and the alarm (src/timers/timers.css), so
// a running timer stays in view and a finished one still rings over it.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import { ArrowLeft, ArrowRight, Check, ChefHat, Hourglass, X } from 'lucide-react';

import { instructionSteps } from '../../hooks/useRecipes';
import useCookingHold from '../../hooks/useCookingHold';
import StepTimer from '../../timers/StepTimer';
import { ingredientLine, ingredientParts, planCards, stepIngredientIndexes } from './cookPlan';
import './CookMode.css';

/** "Brown the beef: Cook it for 8 minutes" → a title and the rest, when the prefix is a short heading. */
export const splitStep = (text) => {
  const match = /^([^:.!?\d]{2,40}):\s+(.+)$/s.exec(String(text).trim());
  if (match && match[1].trim().split(/\s+/).length <= 5) {
    return { title: match[1].trim(), body: match[2].trim() };
  }
  return { title: null, body: String(text).trim() };
};

/** The smallest the text shrinks to before the card is allowed to scroll. */
const MIN_FIT = 0.6;

/**
 * Shrinks a card's text (the --cook-fit scale its CSS multiplies every size
 * by) until the card holds it without scrolling. Runs again when the card
 * changes or the screen turns.
 */
const useFitToCard = (ref, key) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener('resize', again);
    window.addEventListener('orientationchange', again);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('orientationchange', again);
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let fit = 1;
    el.style.setProperty('--cook-fit', String(fit));
    el.classList.remove('cook-mode-card--overflow');
    while (el.scrollHeight > el.clientHeight + 1 && fit > MIN_FIT) {
      fit = Math.max(MIN_FIT, Math.round((fit - 0.05) * 100) / 100);
      el.style.setProperty('--cook-fit', String(fit));
    }
    // Still too much even small: let it scroll rather than cut words off.
    if (el.scrollHeight > el.clientHeight + 1) el.classList.add('cook-mode-card--overflow');
  }, [ref, key, tick]);
};

/** The ingredients one step needs, amounts first. */
const StepIngredients = ({ items, compact = false }) => {
  if (!items.length) return null;
  return (
    <ul className={`cook-mode-needs${compact ? ' cook-mode-needs--compact' : ''}`}>
      {items.map(({ amount, name }, n) => (
        <li key={`${name}-${n}`}>
          {amount && <strong>{amount}</strong>} {name}
        </li>
      ))}
    </ul>
  );
};

/** Keep the screen on while cooking, where the browser allows it. */
const useWakeLock = () => {
  useEffect(() => {
    let lock = null;
    let cancelled = false;
    const request = async () => {
      try {
        if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) lock.release().catch(() => {});
      } catch {
        // Not allowed or not supported: the screen just sleeps as usual.
      }
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', request);
      lock?.release().catch(() => {});
    };
  }, []);
};

/**
 * @param {object}   recipe   - recipes/{id} document
 * @param {function} onClose  - () => void
 * @param {function} [onCooked] - (recipe) => void|Promise — logs the cook
 */
const CookMode = ({ recipe, onClose, onCooked }) => {
  const steps = instructionSteps(recipe.instructions);
  const rawIngredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).filter((i) =>
    ingredientLine(i)
  );
  const ingredients = rawIngredients.map(ingredientLine);
  const needs = (stepIndex) =>
    stepIngredientIndexes(steps[stepIndex], rawIngredients).map((n) =>
      ingredientParts(rawIngredients[n])
    );
  const plan = planCards(steps);
  // Card 0 gathers the ingredients; card n is plan[n - 1].
  const last = plan.length;

  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState([0]);
  const [gathered, setGathered] = useState([]);
  const [logged, setLogged] = useState(false);
  const [logging, setLogging] = useState(false);
  const startX = useRef(null);
  const closeRef = useRef(null);
  const cardRef = useRef(null);

  useWakeLock();
  useCookingHold();
  useFitToCard(cardRef, page);

  const go = useCallback(
    (to) => {
      const next = Math.max(0, Math.min(last, to));
      setPage(next);
      setSeen((s) => (s.includes(next) ? s : [...s, next]));
    },
    [last]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(page + 1);
      if (e.key === 'ArrowLeft') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, go, onClose]);

  // Nothing behind the cards scrolls while they are up.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const toggleGathered = (n) =>
    setGathered((g) => (g.includes(n) ? g.filter((x) => x !== n) : [...g, n]));

  const logCook = async () => {
    if (!onCooked || logging) return;
    setLogging(true);
    try {
      const result = await onCooked(recipe);
      // A caller that reports failure keeps the button, so it can be tried again.
      if (result?.success !== false) setLogged(true);
    } finally {
      setLogging(false);
    }
  };

  const stepLabel = (group) =>
    group.length > 1
      ? `Steps ${group[0] + 1}–${group[group.length - 1] + 1}`
      : `Step ${group[0] + 1}`;

  const timer = (n) => (
    <StepTimer recipeId={recipe.id} recipeName={recipe.name} index={n} text={steps[n]} />
  );

  // What the next card holds, in a line or two.
  const upNext = (() => {
    const next = plan[page]; // the card after this one is plan[page]
    if (!next) return null;
    const { title, body } = splitStep(steps[next.steps[0]]);
    return {
      label: next.parallel ? `${stepLabel(next.steps)}, at the same time` : stepLabel(next.steps),
      title,
      body,
    };
  })();

  let card;
  if (page === 0) {
    const facts = [
      recipe.prepTime || recipe.cookTime
        ? `${(Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0)} min`
        : null,
      recipe.servingsText || (recipe.servings ? `Serves ${recipe.servings}` : null),
    ].filter(Boolean);
    card = (
      <div className="cook-mode-body cook-mode-body--gather">
        <div className="cook-mode-main">
          <span className="cook-mode-stepno">{facts.join(' · ') || 'Ingredients'}</span>
          <h2 className="cook-mode-title">{recipe.name}</h2>
          <p className="cook-mode-text">
            {steps.length
              ? 'Get everything out, then start step 1. Tap an ingredient once you have it.'
              : 'This recipe has no steps saved yet. Edit it to add them.'}
          </p>
        </div>
        <aside className="cook-mode-side" aria-label="Ingredients">
          <h3>
            {ingredients.length
              ? `Gathered ${gathered.length} of ${ingredients.length}`
              : 'No ingredients recorded'}
          </h3>
          <ul className="cook-mode-gather">
            {ingredients.map((line, n) => (
              <li key={`${line}-${n}`}>
                <button
                  type="button"
                  className={gathered.includes(n) ? 'done' : ''}
                  aria-pressed={gathered.includes(n)}
                  onClick={() => toggleGathered(n)}
                >
                  <span className="cook-mode-check" aria-hidden="true">
                    {gathered.includes(n) && <Check size={16} />}
                  </span>
                  {line}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    );
  } else {
    const { steps: group, parallel } = plan[page - 1];
    const [first, ...meanwhile] = group;
    const { title, body } = splitStep(steps[first]);
    const firstNeeds = needs(first);

    if (!parallel) {
      card = (
        <div className="cook-mode-body">
          <div className="cook-mode-main">
            <span className="cook-mode-stepno">
              Step {first + 1} of {steps.length}
            </span>
            {title && <h2 className="cook-mode-title">{title}</h2>}
            <p className="cook-mode-text cook-mode-step">{body}</p>
            <div className="cook-mode-timer">{timer(first)}</div>
          </div>
          {firstNeeds.length > 0 && (
            <aside className="cook-mode-side" aria-label="For this step">
              <h3>For this step</h3>
              <StepIngredients items={firstNeeds} />
            </aside>
          )}
        </div>
      );
    } else {
      card = (
        <div className="cook-mode-body cook-mode-body--parallel">
          <section className="cook-mode-wait" aria-label={`Step ${first + 1}`}>
            <span className="cook-mode-stepno">
              <Hourglass size={16} aria-hidden="true" /> Step {first + 1} of {steps.length} · Start
              this, then keep going
            </span>
            {title && <h2 className="cook-mode-title">{title}</h2>}
            <p className="cook-mode-text cook-mode-step">{body}</p>
            <StepIngredients items={firstNeeds} compact />
            <div className="cook-mode-timer">{timer(first)}</div>
          </section>
          <section className="cook-mode-meanwhile" aria-label="While you wait">
            <h3>While you wait</h3>
            <ol>
              {meanwhile.map((n) => {
                const part = splitStep(steps[n]);
                return (
                  <li key={n}>
                    <span className="cook-mode-badge" aria-hidden="true">
                      {n + 1}
                    </span>
                    <div>
                      <span className="visually-hidden">Step {n + 1}: </span>
                      {part.title && <strong className="cook-mode-subtitle">{part.title}</strong>}
                      <p className="cook-mode-text">{part.body}</p>
                      <StepIngredients items={needs(n)} compact />
                      <div className="cook-mode-timer cook-mode-timer--small">{timer(n)}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      );
    }
  }

  return (
    <div
      className="cook-mode"
      role="dialog"
      aria-modal="true"
      aria-label={`Cooking ${recipe.name}`}
      onPointerDown={(e) => {
        if (e.target.closest('.cook-mode-card')) startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (startX.current == null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 70) go(page + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="cook-mode-top">
        <span className="cook-mode-name">
          <ChefHat size={18} aria-hidden="true" /> {recipe.name}
        </span>
        <Button
          ref={closeRef}
          variant="light"
          className="cook-mode-close"
          aria-label="Stop cooking"
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </div>

      <div className="cook-mode-dots">
        {Array.from({ length: last + 1 }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={i ? stepLabel(plan[i - 1].steps) : 'Ingredients'}
            aria-current={i === page ? 'step' : undefined}
            className={seen.includes(i) ? 'seen' : ''}
            onClick={() => go(i)}
          />
        ))}
      </div>

      <div className="cook-mode-card" ref={cardRef}>
        {card}
        {upNext && (
          <div className="cook-mode-next" aria-label="Up next">
            <span className="cook-mode-next-label">Up next · {upNext.label}</span>
            <span className="cook-mode-next-text">
              {upNext.title && <strong>{upNext.title}. </strong>}
              {upNext.body}
            </span>
          </div>
        )}
      </div>

      <div className="cook-mode-nav">
        <Button variant="light" disabled={page === 0} onClick={() => go(page - 1)}>
          <ArrowLeft size={18} /> Back
        </Button>
        {page < last ? (
          <Button variant="primary" onClick={() => go(page + 1)}>
            {page === 0 ? 'Start step 1' : 'Next step'} <ArrowRight size={18} />
          </Button>
        ) : onCooked && !logged ? (
          <Button variant="primary" disabled={logging} onClick={logCook}>
            <ChefHat size={18} /> {logging ? 'Logging…' : 'Done. I cooked this'}
          </Button>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {logged ? 'Logged. Close' : 'Done cooking'}
          </Button>
        )}
      </div>
    </div>
  );
};

export default CookMode;
