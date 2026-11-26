// src/components/Recipes/CookMode.jsx
// Cook mode: a recipe as full-screen cards, one at a time.
//
// The first card gathers the ingredients (tap each one once it is out), then
// every step gets a card of its own with big text and, when the step names a
// duration, the same shared kitchen timer the recipe page offers. Back / Next,
// the arrow keys, a swipe, or the progress dots move between cards; Escape or
// the close button leaves. The last card can log the cook ("I cooked this"),
// which is what the recipe page's own button does.
//
// It works on any recipe, planned or not: everything it needs is the recipe.
//
// It sits just under the timer tray and the alarm (src/timers/timers.css), so
// a running timer stays in view and a finished one still rings over it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import { ArrowLeft, ArrowRight, Check, ChefHat, X } from 'lucide-react';

import { instructionSteps } from '../../hooks/useRecipes';
import StepTimer from '../../timers/StepTimer';
import './CookMode.css';

/** "Brown the beef: Cook it for 8 minutes" → a title and the rest, when the prefix is a short heading. */
export const splitStep = (text) => {
  const match = /^([^:.!?\d]{2,40}):\s+(.+)$/s.exec(String(text).trim());
  if (match && match[1].trim().split(/\s+/).length <= 5) {
    return { title: match[1].trim(), body: match[2].trim() };
  }
  return { title: null, body: String(text).trim() };
};

const ingredientText = (ingredient) =>
  typeof ingredient === 'string'
    ? ingredient
    : ingredient?.text ||
      [ingredient?.quantity, ingredient?.unit, ingredient?.name].filter(Boolean).join(' ');

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
  const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
    .map(ingredientText)
    .filter(Boolean);
  const last = steps.length;

  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState([0]);
  const [gathered, setGathered] = useState([]);
  const [logged, setLogged] = useState(false);
  const [logging, setLogging] = useState(false);
  const startX = useRef(null);
  const closeRef = useRef(null);

  useWakeLock();

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

  let card;
  if (page === 0) {
    const facts = [
      recipe.prepTime || recipe.cookTime
        ? `${(Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0)} min`
        : null,
      recipe.servingsText || (recipe.servings ? `Serves ${recipe.servings}` : null),
    ].filter(Boolean);
    card = (
      <>
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
      </>
    );
  } else {
    const step = steps[page - 1];
    const { title, body } = splitStep(step);
    card = (
      <div className="cook-mode-main">
        <span className="cook-mode-stepno">
          Step {page} of {last}
        </span>
        {title && <h2 className="cook-mode-title">{title}</h2>}
        <p className="cook-mode-text cook-mode-step">{body}</p>
        <div className="cook-mode-timer">
          <StepTimer recipeId={recipe.id} recipeName={recipe.name} index={page - 1} text={step} />
        </div>
      </div>
    );
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
            aria-label={i ? `Step ${i}` : 'Ingredients'}
            aria-current={i === page ? 'step' : undefined}
            className={seen.includes(i) ? 'seen' : ''}
            onClick={() => go(i)}
          />
        ))}
      </div>

      <div className="cook-mode-card">{card}</div>

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
