// src/pages/Inventory.jsx
// Inventory management page — Phase 3.2
// Wires together useInventory, useStorageLocations, InventoryList,
// AddItemModal, and ConfirmModal into a fully functional inventory view.

import React, { useState } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { Upload } from 'lucide-react';

import useInventory from '../hooks/useInventory';
import useStorageLocations from '../hooks/useStorageLocations';
import useCSVImport from '../hooks/useCSVImport';
import InventoryList from '../components/Inventory/InventoryList';
import AddItemModal from '../components/Inventory/AddItemModal';
import CSVImporter from '../components/CSVImport/CSVImporter';
import ConfirmModal from '../components/Common/ConfirmModal';

const Inventory = () => {
  const {
    items,
    loading: itemsLoading,
    error: itemsError,
    addItem,
    updateItem,
    deleteItem,
  } = useInventory();

  const { locations, loading: locationsLoading } = useStorageLocations();

  const {
    importItems,
    importing,
    progress: importProgress,
    history: importHistory,
  } = useCSVImport();

  // ── Modal state ──────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editItem, setEditItem] = useState(null); // item being edited
  const [deleteTarget, setDeleteTarget] = useState(null); // item pending deletion
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loading = itemsLoading || locationsLoading;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleOpenAdd = () => {
    setEditItem(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (item) => {
    setEditItem(item);
    setShowAddModal(true);
  };

  const handleSave = async (data) => {
    if (editItem) {
      return updateItem(editItem.id, data);
    }
    return addItem(data);
  };

  const handleOpenDelete = (item) => {
    setDeleteError('');
    setDeleteTarget(item);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteItem(deleteTarget.id);
    setDeleting(false);
    if (result?.success) {
      setDeleteTarget(null);
    } else {
      setDeleteError(result?.error || 'Could not delete item. Please try again.');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="inventory-page">
      {/* Global error banner */}
      {itemsError && (
        <Alert variant="danger" className="mb-3">
          {itemsError}
        </Alert>
      )}

      {deleteError && (
        <Alert variant="warning" dismissible onClose={() => setDeleteError('')} className="mb-3">
          {deleteError}
        </Alert>
      )}

      {/* Bulk import */}
      <div className="d-flex justify-content-end mb-2">
        <Button
          variant="outline-primary"
          size="sm"
          className="d-flex align-items-center gap-2"
          onClick={() => setShowImportModal(true)}
        >
          <Upload size={16} />
          Import CSV
        </Button>
      </div>

      {/* Main list */}
      <InventoryList
        items={items}
        locations={locations}
        loading={loading}
        onAdd={handleOpenAdd}
        onEdit={handleOpenEdit}
        onDelete={handleOpenDelete}
      />

      {/* Add / Edit modal */}
      <AddItemModal
        show={showAddModal}
        onHide={() => setShowAddModal(false)}
        onSave={handleSave}
        locations={locations}
        editItem={editItem}
      />

      {/* CSV bulk import modal */}
      <CSVImporter
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        locations={locations}
        onImport={importItems}
        importing={importing}
        progress={importProgress}
        history={importHistory}
      />

      {/* Delete confirmation modal */}
      <ConfirmModal
        show={Boolean(deleteTarget)}
        onHide={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        variant="danger"
        title="Delete Item"
        message={
          deleteTarget
            ? `Are you sure you want to remove "${deleteTarget.name}" from your inventory? This cannot be undone.`
            : ''
        }
        confirmText="Delete"
      />
    </div>
  );
};

export default Inventory;
