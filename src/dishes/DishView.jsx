// src/dishes/DishView.jsx
// A dish and all of its recipes. Each recipe keeps its own ingredients,
// steps, notes and photo; from here a cook picks the favourite, moves a
// recipe to another dish (or a new one), renames the dish or merges it into
// another.

import React, { useState } from 'react';
import { Alert, Button, Col, Form, InputGroup, Row } from 'react-bootstrap';
import { ArrowLeft, Pencil, Star } from 'lucide-react';

import RecipeCard from '../components/Recipes/RecipeCard';

const NEW_DISH = '__new__';

const RecipeTools = ({ recipe, dish, dishes, isFavorite, onFavorite, onMove, onMoveNew }) => {
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');

  const move = (event) => {
    event.preventDefault();
    if (target === NEW_DISH) onMoveNew(recipe, newName);
    else if (target) onMove(recipe, target);
  };

  return (
    <Form onSubmit={move} className="mt-2 d-flex flex-column gap-2">
      <Button
        size="sm"
        variant={isFavorite ? 'primary' : 'outline-secondary'}
        className="d-flex align-items-center gap-1 align-self-start"
        aria-pressed={isFavorite}
        onClick={() => onFavorite(isFavorite ? null : recipe.id)}
      >
        <Star size={14} aria-hidden="true" />
        {isFavorite ? 'Favourite' : 'Make favourite'}
      </Button>
      <InputGroup size="sm">
        <Form.Select
          aria-label={`Move ${recipe.name} to another dish`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Move to…</option>
          {dishes
            .filter((d) => d.id !== dish.id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          <option value={NEW_DISH}>A new dish…</option>
        </Form.Select>
        <Button
          type="submit"
          variant="outline-secondary"
          disabled={!target || (target === NEW_DISH && !newName.trim())}
        >
          Move
        </Button>
      </InputGroup>
      {target === NEW_DISH && (
        <Form.Control
          size="sm"
          placeholder="New dish name"
          aria-label="New dish name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      )}
    </Form>
  );
};

const DishView = ({
  dish,
  dishes = [],
  onBack,
  onView,
  onEdit,
  onDelete,
  onCook,
  currentUid,
  actions,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(dish?.name ?? '');
  const [mergeTarget, setMergeTarget] = useState('');
  const [problem, setProblem] = useState('');

  if (!dish) {
    return (
      <div>
        <Button variant="link" className="px-0 mb-3" onClick={onBack}>
          <ArrowLeft size={16} className="me-1" /> Back to recipes
        </Button>
        <Alert variant="warning">That dish has no recipes any more.</Alert>
      </div>
    );
  }

  const report = (result) => {
    setProblem(result?.success === false ? result.error : '');
    return result;
  };

  const saveName = async (event) => {
    event.preventDefault();
    const result = report(await actions.renameDish(dish.id, name));
    if (result?.success) setRenaming(false);
  };

  const merge = async (event) => {
    event.preventDefault();
    const result = report(await actions.mergeDish(dish.id, mergeTarget));
    if (result?.success) onBack();
  };

  return (
    <div className="dish-view">
      <Button variant="link" className="px-0 mb-2" onClick={onBack}>
        <ArrowLeft size={16} className="me-1" /> Back to recipes
      </Button>

      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          {renaming ? (
            <Form onSubmit={saveName} className="d-flex gap-2">
              <Form.Control
                aria-label="Dish name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit">Save</Button>
              <Button variant="light" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </Form>
          ) : (
            <h1 className="h3 mb-0 d-flex align-items-center gap-2">
              {dish.name}
              <Button
                variant="link"
                size="sm"
                className="p-0"
                aria-label={`Rename ${dish.name}`}
                onClick={() => {
                  setName(dish.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={16} />
              </Button>
            </h1>
          )}
          <small className="text-muted">
            {dish.recipes.length === 1 ? '1 recipe' : `${dish.recipes.length} recipes`}
          </small>
        </div>

        <Form onSubmit={merge} className="d-flex gap-2" style={{ minWidth: '16rem' }}>
          <Form.Select
            size="sm"
            aria-label={`Merge ${dish.name} into another dish`}
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
          >
            <option value="">Merge into another dish…</option>
            {dishes
              .filter((d) => d.id !== dish.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Form.Select>
          <Button size="sm" type="submit" variant="outline-secondary" disabled={!mergeTarget}>
            Merge
          </Button>
        </Form>
      </div>

      {problem && (
        <Alert variant="warning" dismissible onClose={() => setProblem('')}>
          {problem}
        </Alert>
      )}

      <Row xs={1} sm={2} md={3} lg={4} className="g-3">
        {dish.recipes.map((recipe) => (
          <Col key={recipe.id}>
            <RecipeCard
              recipe={recipe}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              onCook={onCook}
              currentUid={currentUid}
            />
            <RecipeTools
              recipe={recipe}
              dish={dish}
              dishes={dishes}
              isFavorite={dish.favoriteId === recipe.id}
              onFavorite={(id) => actions.setFavorite(dish.id, id).then(report)}
              onMove={(r, to) => actions.moveRecipe(r.id, to).then(report)}
              onMoveNew={(r, n) => actions.moveToNewDish(r.id, n).then(report)}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default DishView;
