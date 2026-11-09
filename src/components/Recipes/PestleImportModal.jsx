// src/components/Recipes/PestleImportModal.jsx
// "Import from Pestle": pick the zip Pestle's "Export all" produced, see what
// will come in, then import it in one go.

import React, { useEffect, useRef } from 'react';
import { Modal, Button, Form, Alert, ProgressBar, ListGroup, Spinner } from 'react-bootstrap';
import { Upload, CheckCircle } from 'lucide-react';

import usePestleImport from '../../hooks/usePestleImport';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * PestleImportModal
 *
 * @param {boolean}  show
 * @param {function} onHide
 * @param {array}    existingRecipes - the current library, to skip duplicates
 */
const PestleImportModal = ({ show, onHide, existingRecipes = [] }) => {
  const { plan, preparing, committing, progress, result, error, prepare, commit, reset } =
    usePestleImport(existingRecipes);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!show) reset();
  }, [show, reset]);

  const handleFiles = (event) => {
    const { files } = event.target;
    if (files?.length) prepare(files);
  };

  const done = Boolean(result?.success);
  const readyCount = plan?.ready.length ?? 0;
  const missingSteps = plan?.ready.filter((r) => r.missingSteps) ?? [];

  return (
    <Modal show={show} onHide={committing ? undefined : onHide} centered scrollable>
      <Modal.Header closeButton={!committing}>
        <Modal.Title>Import from Pestle</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {done ? (
          <div className="text-center py-3">
            <CheckCircle
              size={40}
              className="mb-2"
              style={{ color: 'var(--mkh-success, #198754)' }}
            />
            <p className="mb-1 fw-semibold">
              {plural(result.imported, 'recipe')} added to your library.
            </p>
            <p className="text-muted mb-0">
              They’re tagged <strong>pestle</strong> so you can filter to them.
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted">
              In Pestle, use <strong>Export all</strong> and choose the .zip it gives you. You can
              also pick the individual .md recipe files.
            </p>

            <Form.Group controlId="pestle-import-file" className="mb-3">
              <Form.Label className="visually-hidden">Pestle export</Form.Label>
              <Form.Control
                ref={inputRef}
                type="file"
                accept=".zip,.md,.markdown,application/zip,text/markdown"
                multiple
                onChange={handleFiles}
                disabled={preparing || committing}
              />
            </Form.Group>

            {preparing && (
              <div className="d-flex align-items-center gap-2 text-muted">
                <Spinner size="sm" /> Reading recipes…
              </div>
            )}

            {error && <Alert variant="danger">{error}</Alert>}

            {plan && !preparing && (
              <>
                <Alert variant={readyCount > 0 ? 'info' : 'secondary'} className="mb-3">
                  <strong>{plural(readyCount, 'recipe')}</strong> ready to import.
                  {plan.duplicates.length > 0 && (
                    <>
                      {' '}
                      {plural(plan.duplicates.length, 'recipe')} already in your library will be
                      skipped.
                    </>
                  )}
                  {plan.problems.length > 0 && (
                    <> {plural(plan.problems.length, 'file')} couldn’t be read.</>
                  )}
                </Alert>

                {missingSteps.length > 0 && (
                  <Alert variant="warning" className="mb-3">
                    Pestle has no steps saved for {missingSteps.map((r) => r.name).join(', ')}. It
                    will be imported with a reminder to add them.
                  </Alert>
                )}

                {committing && (
                  <ProgressBar
                    className="mb-3"
                    now={progress.total ? (progress.done / progress.total) * 100 : 0}
                    label={`${progress.done} / ${progress.total}`}
                  />
                )}

                {readyCount > 0 && (
                  <ListGroup variant="flush" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {plan.ready.map((r) => (
                      <ListGroup.Item key={r.fileName} className="px-0 py-1 small">
                        {r.name}
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}

                {plan.problems.length > 0 && (
                  <details className="mt-3 small">
                    <summary>Files that couldn’t be read</summary>
                    <ul className="mb-0">
                      {plan.problems.map((p) => (
                        <li key={p.fileName}>
                          {p.name}: {p.problem}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        {done ? (
          <Button variant="primary" onClick={onHide}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="light" onClick={onHide} disabled={committing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="d-flex align-items-center gap-2"
              onClick={commit}
              disabled={!readyCount || preparing || committing}
            >
              {committing ? <Spinner size="sm" /> : <Upload size={16} />}
              {committing ? 'Importing…' : `Import ${readyCount || ''}`.trim()}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default PestleImportModal;
