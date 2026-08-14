// src/components/StorageLocations/StorageLocationsList.jsx
// Displays all storage locations with edit and delete controls

import React, { useState } from 'react';
import { Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { Pencil, Trash2, Lock, Plus } from 'lucide-react';
import AddLocationModal from './AddLocationModal';

/**
 * StorageLocationsList
 *
 * @param {Array}    locations       - Array of location objects from useStorageLocations
 * @param {boolean}  loading         - True while loading from Firestore
 * @param {function} onAdd           - ({ label, type, icon, color }) => Promise<{ success, error }>
 * @param {function} onEdit          - (locationId, updates) => Promise<{ success, error }>
 * @param {function} onDelete        - (locationId) => Promise<{ success, error }>
 */
const StorageLocationsList = ({ locations, loading, onAdd, onEdit, onDelete }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // location object being edited
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // --- Handlers ---
  const handleAddSave = (data) => onAdd(data);

  const handleEditSave = async (data) => {
    const result = await onEdit(editTarget.id, data);
    if (result?.success) setEditTarget(null);
    return result;
  };

  const handleDeleteClick = (loc) => {
    setDeleteError('');
    setConfirmDeleteId(loc.id);
  };

  const handleDeleteConfirm = async () => {
    setDeletingId(confirmDeleteId);
    setDeleteError('');
    const result = await onDelete(confirmDeleteId);
    setDeletingId(null);
    if (result?.success) {
      setConfirmDeleteId(null);
    } else {
      setDeleteError(result?.error || 'Could not delete location.');
      setConfirmDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div className="d-flex align-items-center gap-2 py-3 text-muted">
        <Spinner size="sm" /> Loading locations…
      </div>
    );
  }

  return (
    <div>
      {deleteError && (
        <Alert
          variant="warning"
          dismissible
          onClose={() => setDeleteError('')}
          className="py-2 mb-3"
        >
          {deleteError}
        </Alert>
      )}

      {/* Location list */}
      <div className="d-flex flex-column gap-2 mb-3">
        {locations.length === 0 && (
          <p className="text-muted fst-italic mb-0">No locations yet. Add one below.</p>
        )}

        {locations.map((loc) => (
          <div
            key={loc.id}
            className="d-flex align-items-center justify-content-between rounded-3 px-3 py-2"
            style={{
              background: `${loc.color}12`,
              border: `1.5px solid ${loc.color}44`,
            }}
          >
            {/* Left: icon + info */}
            <div className="d-flex align-items-center gap-3">
              <div style={{ fontSize: '1.5rem', lineHeight: 1 }}>{loc.icon}</div>
              <div>
                <div className="fw-semibold" style={{ color: loc.color, lineHeight: 1.2 }}>
                  {loc.label}
                </div>
                <div className="d-flex align-items-center gap-2 mt-1">
                  <Badge
                    bg="light"
                    text="dark"
                    style={{ fontSize: '0.7rem', textTransform: 'capitalize' }}
                  >
                    {loc.type}
                  </Badge>
                  {loc.itemCount > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#6c757d' }}>
                      {loc.itemCount} item{loc.itemCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {loc.isDefault && (
                    <span style={{ fontSize: '0.7rem', color: '#6c757d' }}>default</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: actions */}
            {confirmDeleteId === loc.id ? (
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: '0.8rem', color: '#dc3545' }}>Delete?</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={handleDeleteConfirm}
                  disabled={deletingId === loc.id}
                >
                  {deletingId === loc.id ? <Spinner size="sm" /> : 'Yes'}
                </Button>
                <Button size="sm" variant="light" onClick={() => setConfirmDeleteId(null)}>
                  No
                </Button>
              </div>
            ) : (
              <div className="d-flex gap-1">
                <Button
                  size="sm"
                  variant="light"
                  className="p-1"
                  title="Edit"
                  onClick={() => setEditTarget(loc)}
                >
                  <Pencil size={15} />
                </Button>

                {loc.isDefault ? (
                  <Button
                    size="sm"
                    variant="light"
                    className="p-1"
                    title="Default locations cannot be deleted"
                    disabled
                  >
                    <Lock size={15} className="text-muted" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="light"
                    className="p-1 text-danger"
                    title="Delete"
                    onClick={() => handleDeleteClick(loc)}
                    disabled={deletingId === loc.id}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      <Button
        variant="outline-primary"
        size="sm"
        className="d-flex align-items-center gap-2"
        onClick={() => setShowAddModal(true)}
      >
        <Plus size={16} /> Add Location
      </Button>

      {/* Add modal */}
      <AddLocationModal
        show={showAddModal}
        onHide={() => setShowAddModal(false)}
        onSave={handleAddSave}
      />

      {/* Edit modal */}
      <AddLocationModal
        show={Boolean(editTarget)}
        onHide={() => setEditTarget(null)}
        onSave={handleEditSave}
        editLocation={editTarget}
      />
    </div>
  );
};

export default StorageLocationsList;
