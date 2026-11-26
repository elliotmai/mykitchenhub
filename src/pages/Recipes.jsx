// src/pages/Recipes.jsx
// Recipe library — Phase 4.
//
// Two views share one route: the library grid, and the full recipe view when
// `?recipe=<id>` is in the URL. Keeping the detail view on a search param means
// it is deep-linkable and the browser Back button works, without adding a
// route to the shared App.jsx.

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert } from 'react-bootstrap';

import useRecipes from '../hooks/useRecipes';
import useInventory from '../hooks/useInventory';
import RecipeList from '../components/Recipes/RecipeList';
import AddRecipeModal from '../components/Recipes/AddRecipeModal';
import SyncDashboard from '../components/Recipes/SyncDashboard';
import RecipeImportModal from '../components/Recipes/RecipeImportModal';
import ConfirmModal from '../components/Common/ConfirmModal';
import RecipeDetail from './RecipeDetail';
import useDishes from '../dishes/useDishes';
import DishView from '../dishes/DishView';
import { dishOf } from '../dishes/dishLogic';
import RecipeFinish from '../dishes/RecipeFinish';
import { adoptWebCover, dishFor, placeInDish } from '../dishes/newRecipe';

const RECIPE_PARAM = 'recipe';
const DISH_PARAM = 'dish';

// The Android share sheet (manifest.json `share_target`) lands here with the
// shared text in these params, which open the importer's paste tab.
export const SHARE_PARAMS = ['share-text', 'share-title', 'share-url'];

const Recipes = () => {
  const {
    recipes,
    loading,
    error,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    markCooked,
    getRecipeById,
    currentUid,
    tags,
  } = useRecipes();

  const { items } = useInventory();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(RECIPE_PARAM);
  const selectedDishId = searchParams.get(DISH_PARAM);
  const dishActions = useDishes(recipes);
  const selectedDish = selectedDishId
    ? dishActions.dishes.find((d) => d.id === selectedDishId) || null
    : null;

  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [editRecipe, setEditRecipe] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [sharedText, setSharedText] = useState('');

  // Something shared from another app: open the importer with it, then tidy
  // the URL so Back and refresh don't import it twice.
  // The "Import Recipe" home-screen shortcut opens /recipes?action=import.
  useEffect(() => {
    const text = searchParams.get('share-text') || searchParams.get('share-url') || '';
    const fromShortcut = searchParams.get('action') === 'import';
    if (!text.trim() && !fromShortcut) return;
    setSharedText(text);
    setShowImport(true);
    const next = new URLSearchParams(searchParams);
    [...SHARE_PARAMS, 'action'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeImport = () => {
    setShowImport(false);
    setSharedText('');
  };
  const [actionError, setActionError] = useState('');
  const report = (result) => {
    if (result && !result.success) setActionError(result.error);
    return result;
  };

  // Inventory feeds both the ingredient autocomplete and the "in your kitchen"
  // markers on the detail view.
  const inventoryNames = useMemo(() => items.map((i) => i.normalized ?? i.name), [items]);
  const ingredientSuggestions = useMemo(() => items.map((i) => i.name).filter(Boolean), [items]);

  const selectedRecipe = selectedId ? getRecipeById(selectedId) : null;

  // ── Navigation ───────────────────────────────────────────────────────────
  const openRecipe = (recipe) => setSearchParams({ [RECIPE_PARAM]: recipe.id });
  const openDish = (dish) => setSearchParams({ [DISH_PARAM]: dish.id });
  const recipeDish = selectedId ? dishOf(dishActions.dishes, selectedId) : null;
  const closeRecipe = () => setSearchParams({});

  // ── Create / edit ────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditRecipe(null);
    setShowRecipeModal(true);
  };

  const openEdit = (recipe) => {
    setEditRecipe(recipe);
    setShowRecipeModal(true);
  };

  const handleSave = async (data) => {
    if (editRecipe) return updateRecipe(editRecipe.id, data);
    const result = await addRecipe(data);
    if (result?.success && result.id) setFinishing({ id: result.id, ...data });
    return result;
  };

  // ── A recipe just added: its dish and cover (src/dishes/newRecipe.js) ──────
  const [finishing, setFinishing] = useState(null);
  const handleImported = async ({ recipes: added = [] }) => {
    const covered = await Promise.all(
      added.map(async (r) => ({ ...r, imageUrl: await adoptWebCover(r) }))
    );
    if (covered.length === 1) {
      closeImport();
      setFinishing(covered[0]);
      return;
    }
    // Several at once: each takes its suggested dish, else is a dish of its own.
    for (const r of covered) {
      await placeInDish(r, dishFor(r, dishActions.dishes), dishActions.dishes, dishActions);
    }
  };

  // ── Cook counter ─────────────────────────────────────────────────────────
  const handleCook = async (recipe) => {
    setActionError('');
    const result = await markCooked(recipe.id);
    if (!result?.success) setActionError(result?.error || 'Could not record that cook.');
    return result;
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteRecipe(deleteTarget.id);
    setDeleting(false);

    if (result?.success) {
      // Deleting from the detail view leaves nothing to look at.
      if (selectedId === deleteTarget.id) closeRecipe();
      setDeleteTarget(null);
    } else {
      setActionError(result?.error || 'Could not delete that recipe.');
      setDeleteTarget(null);
    }
  };

  return (
    <div className="recipes-page">
      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {actionError && (
        <Alert variant="warning" dismissible onClose={() => setActionError('')} className="mb-3">
          {actionError}
        </Alert>
      )}

      {selectedId ? (
        <RecipeDetail
          recipe={selectedRecipe}
          loading={loading}
          inventoryNames={inventoryNames}
          onBack={closeRecipe}
          onCook={handleCook}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          dish={recipeDish}
          onOpenDish={openDish}
          dishes={dishActions.dishes}
          onMoveDish={(r, to) => dishActions.moveRecipe(r.id, to).then(report)}
          onMoveNewDish={(r, n) => dishActions.moveToNewDish(r.id, n).then(report)}
          onUseAsCover={(d, r) => dishActions.setCover(d.id, r.imageUrl, r.id).then(report)}
        />
      ) : selectedDishId ? (
        <DishView
          dish={selectedDish}
          dishes={dishActions.dishes}
          onBack={closeRecipe}
          onView={openRecipe}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onCook={handleCook}
          currentUid={currentUid}
          actions={dishActions}
        />
      ) : (
        <RecipeList
          recipes={recipes}
          loading={loading}
          onAdd={openAdd}
          onView={openRecipe}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onCook={handleCook}
          onOpenSync={() => setShowSync(true)}
          onOpenImport={() => setShowImport(true)}
          currentUid={currentUid}
          groupDishes={dishActions.group}
          onOpenDish={openDish}
        />
      )}

      <AddRecipeModal
        show={showRecipeModal}
        onHide={() => setShowRecipeModal(false)}
        onSave={handleSave}
        editRecipe={editRecipe}
        ingredientSuggestions={ingredientSuggestions}
        tagSuggestions={tags}
      />

      <SyncDashboard show={showSync} onHide={() => setShowSync(false)} />

      <RecipeImportModal
        show={showImport}
        onHide={closeImport}
        existingRecipes={recipes}
        initialText={sharedText}
        onOpenRecipe={(id) => setSearchParams({ [RECIPE_PARAM]: id })}
        onImported={handleImported}
      />

      {finishing && (
        <RecipeFinish
          recipe={finishing}
          dishes={dishActions.dishes}
          actions={dishActions}
          onDone={() => {
            const id = finishing.id;
            setFinishing(null);
            setSearchParams({ [RECIPE_PARAM]: id });
          }}
        />
      )}

      <ConfirmModal
        show={Boolean(deleteTarget)}
        onHide={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        variant="danger"
        title="Delete Recipe"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? This removes it for everyone and cannot be undone.`
            : ''
        }
        confirmText="Delete"
      />
    </div>
  );
};

export default Recipes;
