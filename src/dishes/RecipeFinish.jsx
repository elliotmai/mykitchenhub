// src/dishes/RecipeFinish.jsx
// Shown once a recipe is saved: the dish it goes with, picked already
// ("Goes with: Meatballs ✓", or change it, or a new dish), and a cover when it
// has none: three freely licensed photos of the dish to choose from, or skip.
// One tap on Done keeps what's picked. See ./newRecipe.js.

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Check } from 'lucide-react';

import { coverIdeas, ideaCredit } from '../services/recipeWeb';
import { dishOf } from './dishLogic';
import { dishFor, otherDishes, placeInDish, ideaAsCover } from './newRecipe';

const NEW = '__new__';

const RecipeFinish = ({ recipe, dishes, actions, onDone }) => {
  const suggested = useMemo(() => (recipe ? dishFor(recipe, dishes) : null), [recipe, dishes]);
  const choices = useMemo(() => (recipe ? otherDishes(dishes, recipe.id) : []), [recipe, dishes]);
  const [target, setTarget] = useState(NEW);
  const [changing, setChanging] = useState(false);
  const [newName, setNewName] = useState('');
  const [ideas, setIdeas] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!recipe) return undefined;
    setTarget(suggested ? suggested.id : NEW);
    setNewName(recipe.name || '');
    setChanging(false);
    setPicked(null);
    setProblem('');
    setIdeas(null);
    if (recipe.imageUrl) return undefined;
    let live = true;
    coverIdeas(suggested?.name || recipe.name)
      .then((found) => live && setIdeas(found))
      .catch(() => live && setIdeas([]));
    return () => {
      live = false;
    };
    // Only when another recipe is being finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);

  if (!recipe) return null;
  const chosen = target === NEW ? null : choices.find((d) => d.id === target) || null;

  const done = async () => {
    setBusy(true);
    setProblem('');
    try {
      let result = { success: true };
      if (chosen) result = await placeInDish(recipe, chosen, dishes, actions);
      else {
        const own = dishOf(dishes, recipe.id);
        const name = newName.trim() || recipe.name;
        // On its own already: a dish named after it, unless it should be called something else.
        if (own && own.recipes.length === 1) {
          if (name !== own.name) result = await actions.renameDish(own.id, name);
        } else result = await actions.moveToNewDish(recipe.id, name);
      }
      if (!result.success) throw new Error(result.error);
      if (picked) await ideaAsCover(recipe, picked);
      onDone();
    } catch (err) {
      setProblem(err.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show onHide={onDone} centered aria-labelledby="recipe-finish-title">
      <Modal.Header closeButton>
        <Modal.Title id="recipe-finish-title" className="h5">
          {recipe.name} is saved
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        <section aria-label="Dish">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className="text-muted">Goes with:</span>
            <Badge
              pill
              bg="primary"
              className="d-inline-flex align-items-center gap-1 px-3 py-2"
              aria-label={`Goes with ${chosen ? chosen.name : `a new dish, ${newName || recipe.name}`}`}
            >
              {chosen ? chosen.name : `New dish: ${newName || recipe.name}`}
              <Check size={14} aria-hidden="true" />
            </Badge>
            <Button variant="link" size="sm" className="p-0" onClick={() => setChanging((c) => !c)}>
              change
            </Button>
            {target !== NEW && (
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => {
                  setTarget(NEW);
                  setChanging(true);
                }}
              >
                new dish
              </Button>
            )}
          </div>
          {changing && (
            <div className="d-flex flex-column gap-2 mt-2">
              <Form.Select
                size="sm"
                aria-label="Dish"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value={NEW}>A new dish…</option>
                {choices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Form.Select>
              {target === NEW && (
                <Form.Control
                  size="sm"
                  aria-label="New dish name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              )}
            </div>
          )}
        </section>

        {!recipe.imageUrl && (
          <section aria-label="Cover">
            <div className="text-muted mb-2">A cover photo?</div>
            {ideas === null ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner size="sm" /> Looking for photos…
              </div>
            ) : ideas.length === 0 ? (
              <small className="text-muted">
                No free photos found. Its dish’s cover will show instead.
              </small>
            ) : (
              <div className="d-flex gap-2 flex-wrap">
                {ideas.map((idea) => (
                  <button
                    key={idea.url}
                    type="button"
                    className="p-0 border-0 bg-transparent text-start"
                    aria-pressed={picked?.url === idea.url}
                    onClick={() => setPicked(picked?.url === idea.url ? null : idea)}
                    style={{ width: 120 }}
                  >
                    <img
                      src={idea.thumbnail}
                      alt={idea.title || recipe.name}
                      loading="lazy"
                      style={{
                        width: 120,
                        height: 90,
                        objectFit: 'cover',
                        borderRadius: 'var(--mkh-radius-md)',
                        outline:
                          picked?.url === idea.url
                            ? '3px solid var(--mkh-primary, #0d6efd)'
                            : 'none',
                        outlineOffset: 2,
                      }}
                    />
                    <small className="d-block text-muted text-truncate" title={ideaCredit(idea)}>
                      {ideaCredit(idea)}
                    </small>
                  </button>
                ))}
                <Button
                  variant={picked ? 'outline-secondary' : 'secondary'}
                  size="sm"
                  className="align-self-center"
                  aria-pressed={!picked}
                  onClick={() => setPicked(null)}
                >
                  Skip
                </Button>
              </div>
            )}
          </section>
        )}
        {problem && (
          <Alert variant="warning" className="mb-0">
            {problem}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={done} disabled={busy}>
          {busy ? <Spinner size="sm" /> : 'Done'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default RecipeFinish;
