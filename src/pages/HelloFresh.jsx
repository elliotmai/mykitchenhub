// src/pages/HelloFresh.jsx
// HelloFresh integration — roadmap phase 5.
//
// Two jobs on one page: getting a recipe in (photo, link, or by hand), and
// logging the box it came in so the ingredients reach the fridge.

import React, { useState } from 'react';
import { Alert, Button, Card, Nav, Tab } from 'react-bootstrap';
import { Camera, Link2, PackageCheck, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  AddDeliveryModal,
  DeliveryHistory,
  EditDeliveryModal,
  PhotoImport,
  RecipeReviewForm,
  UrlImport,
} from '../components/HelloFresh';
import { ConfirmModal, useToast } from '../components/Common';
import useDeliveries from '../hooks/useDeliveries';
import useHelloFreshImport from '../hooks/useHelloFreshImport';
import useHelloFreshRecipes from '../hooks/useHelloFreshRecipes';
import useStorageLocations from '../hooks/useStorageLocations';

const HelloFresh = () => {
  const { showSuccess, showError } = useToast();

  const {
    configured,
    draft,
    warnings,
    importing,
    saving: savingRecipe,
    error: importError,
    importPhoto,
    importUrl,
    startManualEntry,
    saveDraft,
    reset,
  } = useHelloFreshImport();

  const { recipes, loading: recipesLoading } = useHelloFreshRecipes();
  const { locations } = useStorageLocations();
  const {
    deliveries,
    loading: deliveriesLoading,
    saving: savingDelivery,
    error: deliveriesError,
    addDelivery,
    updateDelivery,
    deleteDelivery,
  } = useDeliveries();

  const [importMethod, setImportMethod] = useState('photo');
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async (candidate) => {
    const result = await saveDraft(candidate);
    if (result.success) {
      showSuccess(`“${candidate.name}” is in your recipe book.`);
      reset();
    }
    return result;
  };

  const handleAddDelivery = async (payload) => {
    const result = await addDelivery(payload);
    if (result.success) {
      showSuccess(
        `Delivery logged — ${result.itemsAdded} ingredient${
          result.itemsAdded === 1 ? '' : 's'
        } stored and ${result.mealsScheduled} meal${
          result.mealsScheduled === 1 ? '' : 's'
        } scheduled.`
      );
    }
    return result;
  };

  const handleEditDelivery = async (delivery, changes) => {
    const result = await updateDelivery(delivery.id, changes);
    if (result.success) showSuccess('Delivery updated.');
    else showError(result.error || 'That change could not be saved.');
    // Handed back so the dialog stays open on a refusal rather than closing
    // over an edit that never landed.
    return result;
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteDelivery(deleteTarget.id);
    setDeleting(false);

    if (result?.success) setDeleteTarget(null);
    else showError(result?.error ?? 'That delivery could not be removed.');
  };

  return (
    <div className="hellofresh-page">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
        <h1 className="h3 mb-0">HelloFresh</h1>
        <Button
          variant="primary"
          onClick={() => setShowDeliveryModal(true)}
          className="d-flex align-items-center gap-2"
        >
          <PackageCheck size={18} />
          Add delivery
        </Button>
      </div>

      {!configured && (
        <Alert variant="info">
          Automatic import is off on this build, but you can still add recipes by hand.
        </Alert>
      )}

      {deliveriesError && <Alert variant="danger">{deliveriesError}</Alert>}

      {/* ── Import ─────────────────────────────────────────────────────── */}
      <section className="mb-5">
        <h2 className="h5 mb-3">Add a recipe</h2>

        {draft ? (
          <RecipeReviewForm
            draft={draft}
            warnings={warnings}
            saving={savingRecipe}
            error={importError}
            onSave={handleSave}
            onCancel={reset}
          />
        ) : (
          <Tab.Container activeKey={importMethod} onSelect={(key) => setImportMethod(key)}>
            <Nav variant="tabs" className="mb-3">
              <Nav.Item>
                <Nav.Link eventKey="photo" className="d-flex align-items-center gap-2">
                  <Camera size={16} /> Photo
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="url" className="d-flex align-items-center gap-2">
                  <Link2 size={16} /> Link
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="manual" className="d-flex align-items-center gap-2">
                  <Pencil size={16} /> By hand
                </Nav.Link>
              </Nav.Item>
            </Nav>

            <Tab.Content>
              {/* Every pane stays mounted, so an error is shown only on the
                  tab that produced it rather than on all of them at once. */}
              <Tab.Pane eventKey="photo">
                <PhotoImport
                  onImport={importPhoto}
                  onManualEntry={startManualEntry}
                  importing={importing}
                  error={importMethod === 'photo' ? importError : null}
                />
              </Tab.Pane>
              <Tab.Pane eventKey="url">
                <UrlImport
                  onImport={importUrl}
                  onManualEntry={startManualEntry}
                  importing={importing}
                  error={importMethod === 'url' ? importError : null}
                />
              </Tab.Pane>
              <Tab.Pane eventKey="manual">
                <Card>
                  <Card.Body className="text-center py-4">
                    <Pencil size={48} className="text-primary mb-3" aria-hidden="true" />
                    <h5>Type it in yourself</h5>
                    <p className="text-muted">
                      No card to photograph and no link to hand? Fill in the recipe directly.
                    </p>
                    <Button variant="primary" onClick={startManualEntry}>
                      Start a blank recipe
                    </Button>
                  </Card.Body>
                </Card>
              </Tab.Pane>
            </Tab.Content>
          </Tab.Container>
        )}

        {!draft && recipes.length > 0 && (
          <p className="text-muted small mt-3 mb-0">
            {recipes.length} HelloFresh recipe{recipes.length === 1 ? '' : 's'} imported so far —{' '}
            <Link to="/recipes" className="touch-link">
              see them all
            </Link>
            .
          </p>
        )}
      </section>

      {/* ── Deliveries ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="h5 mb-3">Delivery history</h2>
        <DeliveryHistory
          deliveries={deliveries}
          loading={deliveriesLoading}
          onEdit={setEditingDelivery}
          onDelete={setDeleteTarget}
        />
      </section>

      <AddDeliveryModal
        show={showDeliveryModal}
        onHide={() => setShowDeliveryModal(false)}
        onSubmit={handleAddDelivery}
        recipes={recipes}
        recipesLoading={recipesLoading}
        locations={locations}
        saving={savingDelivery}
      />

      <EditDeliveryModal
        show={Boolean(editingDelivery)}
        onHide={() => setEditingDelivery(null)}
        onSave={handleEditDelivery}
        delivery={editingDelivery}
      />

      <ConfirmModal
        show={Boolean(deleteTarget)}
        onHide={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        variant="danger"
        title="Remove delivery"
        message="This removes the delivery record. Ingredients already in your kitchen and meals already scheduled stay put."
        confirmText="Remove"
      />
    </div>
  );
};

export default HelloFresh;
