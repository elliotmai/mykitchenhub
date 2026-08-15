// src/pages/Recipes.jsx
// Recipe library — Phase 4.
//
// Two views share one route: the library grid, and the full recipe view when
// `?recipe=<id>` is in the URL. Keeping the detail view on a search param means
// it is deep-linkable and the browser Back button works, without adding a
// route to the shared App.jsx.

import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert } from 'react-bootstrap';

import useRecipes from '../hooks/useRecipes';
import useInventory from '../hooks/useInventory';
import RecipeList from '../components/Recipes/RecipeList';
import AddRecipeModal from '../components/Recipes/AddRecipeModal';
import SyncDashboard from '../components/Recipes/SyncDashboard';
import ConfirmModal from '../components/Common/ConfirmModal';
import RecipeDetail from './RecipeDetail';

const RECIPE_PARAM = 'recipe';

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
  } = useRecipes();

  const { items } = useInventory();

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(RECIPE_PARAM);

  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [editRecipe, setEditRecipe] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [actionError, setActionError] = useState('');

  // Inventory feeds both the ingredient autocomplete and the "in your kitchen"
  // markers on the detail view.
  const inventoryNames = useMemo(() => items.map((i) => i.normalized ?? i.name), [items]);
  const ingredientSuggestions = useMemo(() => items.map((i) => i.name).filter(Boolean), [items]);

  const selectedRecipe = selectedId ? getRecipeById(selectedId) : null;

  // ── Navigation ───────────────────────────────────────────────────────────
  const openRecipe = (recipe) => setSearchParams({ [RECIPE_PARAM]: recipe.id });
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
    return addRecipe(data);
  };

  // ── Cook counter ─────────────────────────────────────────────────────────
  const handleCook = async (recipe) => {
    setActionError('');
    const result = await markCooked(recipe.id);
    if (!result?.success) setActionError(result?.error || 'Could not record that cook.');
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
          currentUid={currentUid}
        />
      )}

      <AddRecipeModal
        show={showRecipeModal}
        onHide={() => setShowRecipeModal(false)}
        onSave={handleSave}
        editRecipe={editRecipe}
        ingredientSuggestions={ingredientSuggestions}
      />

      <SyncDashboard show={showSync} onHide={() => setShowSync(false)} />

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
