// src/components/CSVImport/CSVImporter.jsx
// Bulk-import inventory from a CSV file — roadmap step 3.3.
//
// Three steps: pick a file, look at what we made of it, then import. The
// preview is the point — a spreadsheet that has been edited by hand always has
// a few bad rows, and importing 96 of 100 items while being told exactly what
// went wrong with the other 4 beats an all-or-nothing error message.

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Alert, Table, ProgressBar, Badge, Form, Spinner } from 'react-bootstrap';
import { Upload, FileText, CheckCircle2, AlertTriangle, History } from 'lucide-react';

import { validateCSV, readFileText, SAMPLE_CSV, KNOWN_COLUMNS } from './csvValidation';

/** Rows shown per preview table before it collapses into a "…and N more". */
const PREVIEW_LIMIT = 25;

const formatImportedAt = (value) => {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * CSVImporter
 *
 * @param {boolean}  show      - Controls visibility
 * @param {function} onHide    - Close callback
 * @param {array}    locations - Storage locations from useStorageLocations
 * @param {function} onImport  - async (validRows, { fileName, skipped, errors })
 *                               => { success, imported, skipped, error }
 * @param {boolean}  importing - True while the import is running
 * @param {object}   progress  - { processed, total } from useCSVImport
 * @param {array}    history   - Past imports, newest first
 */
const CSVImporter = ({
  show,
  onHide,
  locations = [],
  onImport,
  importing = false,
  progress = { processed: 0, total: 0 },
  history = [],
}) => {
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);

  const clear = useCallback(() => {
    setFileName('');
    setReading(false);
    setReadError('');
    setAnalysis(null);
    setResult(null);
  }, []);

  // Start from a clean slate every time the modal opens.
  useEffect(() => {
    if (show) clear();
  }, [show, clear]);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setReading(true);
    setReadError('');
    setResult(null);
    setFileName(file.name);

    try {
      const text = await readFileText(file);
      setAnalysis(validateCSV(text, locations));
    } catch (err) {
      setReadError(err?.message || 'Could not read that file.');
      setAnalysis(null);
    } finally {
      setReading(false);
    }
  };

  const handleImport = async () => {
    if (!analysis?.validRows.length) return;

    const outcome = await onImport(analysis.validRows, {
      fileName,
      skipped: analysis.errorRows.length,
      errors: analysis.errorRows,
    });

    setResult(outcome ?? { success: false, error: 'Import did not complete.' });
  };

  const validCount = analysis?.validRows.length ?? 0;
  const errorCount = analysis?.errorRows.length ?? 0;

  // ── Step: results ────────────────────────────────────────────────────────
  const renderResult = () => (
    <>
      {result.success ? (
        <Alert variant="success" className="d-flex align-items-start gap-2">
          <CheckCircle2 size={20} className="flex-shrink-0 mt-1" />
          <div>
            <strong>
              {result.imported} item{result.imported === 1 ? '' : 's'} added to your kitchen.
            </strong>
            {result.skipped > 0 && (
              <div className="small">
                {result.skipped} row{result.skipped === 1 ? '' : 's'} skipped — fix them in your
                spreadsheet and import again.
              </div>
            )}
          </div>
        </Alert>
      ) : (
        <Alert variant="danger" className="d-flex align-items-start gap-2">
          <AlertTriangle size={20} className="flex-shrink-0 mt-1" />
          <div>
            <strong>The import did not finish.</strong>
            <div className="small">{result.error}</div>
          </div>
        </Alert>
      )}
    </>
  );

  // ── Step: preview ────────────────────────────────────────────────────────
  const renderPreview = () => (
    <>
      <p className="text-muted mb-3">
        <FileText size={16} className="me-1" />
        {fileName} — {analysis.totalRows} row{analysis.totalRows === 1 ? '' : 's'}
      </p>

      <div className="d-flex gap-2 mb-3 flex-wrap">
        <Badge bg="success">{validCount} ready to import</Badge>
        <Badge bg={errorCount ? 'warning' : 'secondary'} text={errorCount ? 'dark' : undefined}>
          {errorCount} need{errorCount === 1 ? 's' : ''} fixing
        </Badge>
      </div>

      {validCount === 0 && (
        <Alert variant="warning">
          None of these rows can be imported yet. Fix the problems below and try again.
        </Alert>
      )}

      {validCount > 0 && (
        <>
          <h6 className="fw-semibold">Ready to import</h6>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <Table size="sm" hover className="mb-1">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {analysis.validRows.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={`valid-${row.row}`}>
                    <td>{row.data.name}</td>
                    <td>
                      {row.data.quantity} {row.data.unit}
                    </td>
                    <td>{row.data.locationLabel}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {validCount > PREVIEW_LIMIT && (
            <p className="text-muted small">…and {validCount - PREVIEW_LIMIT} more.</p>
          )}
        </>
      )}

      {errorCount > 0 && (
        <>
          <h6 className="fw-semibold mt-3">Rows we had to skip</h6>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <Table size="sm" hover className="mb-1">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>What is wrong</th>
                </tr>
              </thead>
              <tbody>
                {analysis.errorRows.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={`error-${row.row}`}>
                    <td>{row.row}</td>
                    <td>{row.errors.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {errorCount > PREVIEW_LIMIT && (
            <p className="text-muted small">…and {errorCount - PREVIEW_LIMIT} more.</p>
          )}
        </>
      )}

      {importing && (
        <div className="mt-3">
          <ProgressBar
            now={progress.total ? (progress.processed / progress.total) * 100 : 0}
            label={`${progress.processed}/${progress.total}`}
          />
          <p className="text-muted small mt-1 mb-0">
            Adding items… large files are saved 500 at a time.
          </p>
        </div>
      )}
    </>
  );

  // ── Step: choose a file ──────────────────────────────────────────────────
  const renderPicker = () => (
    <>
      <p className="text-muted">
        Have a spreadsheet of what is in your kitchen? Save it as a CSV and drop it in here.
      </p>

      <Form.Group className="mb-3">
        <Form.Label htmlFor="csv-import-file" className="fw-semibold">
          Choose a CSV file
        </Form.Label>
        <Form.Control
          id="csv-import-file"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={reading}
        />
      </Form.Group>

      {reading && (
        <p className="text-muted d-flex align-items-center gap-2">
          <Spinner size="sm" /> Reading {fileName}…
        </p>
      )}

      <details>
        <summary className="fw-semibold" style={{ cursor: 'pointer' }}>
          What should the file look like?
        </summary>
        <p className="text-muted small mt-2 mb-1">
          The first line names the columns. <strong>name</strong>, <strong>quantity</strong> and{' '}
          <strong>location</strong> are required; {KNOWN_COLUMNS.slice(3).join(', ')} are optional.
          A location is either one of your own (
          {locations
            .map((l) => l.label)
            .filter(Boolean)
            .join(', ') || 'none yet'}
          ) or just “fridge”, “freezer” or “pantry”.
        </p>
        <pre className="small bg-light p-2 rounded mb-0">{SAMPLE_CSV}</pre>
      </details>

      {history.length > 0 && (
        <div className="mt-3">
          <h6 className="fw-semibold d-flex align-items-center gap-2">
            <History size={16} /> Recent imports
          </h6>
          <ul className="text-muted small mb-0 ps-3">
            {history.map((entry) => (
              <li key={entry.id}>
                {formatImportedAt(entry.importedAt)} — {entry.fileName}: {entry.itemsImported} added
                {entry.itemsSkipped > 0 ? `, ${entry.itemsSkipped} skipped` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // ── Footer buttons for the current step ──────────────────────────────────
  const renderFooter = () => {
    if (result) {
      return (
        <>
          <Button variant="light" onClick={clear}>
            Import another file
          </Button>
          <Button variant="primary" onClick={onHide}>
            Done
          </Button>
        </>
      );
    }

    if (analysis && !analysis.fileError) {
      return (
        <>
          <Button variant="light" onClick={clear} disabled={importing}>
            Choose a different file
          </Button>
          <Button variant="primary" onClick={handleImport} disabled={importing || validCount === 0}>
            {importing ? 'Importing…' : `Import ${validCount} item${validCount === 1 ? '' : 's'}`}
          </Button>
        </>
      );
    }

    return (
      <Button variant="light" onClick={onHide}>
        Cancel
      </Button>
    );
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="d-flex align-items-center gap-2">
          <Upload size={20} className="text-primary" />
          Import from CSV
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="pt-3">
        {readError && <Alert variant="danger">{readError}</Alert>}
        {analysis?.fileError && <Alert variant="danger">{analysis.fileError}</Alert>}

        {result
          ? renderResult()
          : analysis && !analysis.fileError
            ? renderPreview()
            : renderPicker()}
      </Modal.Body>

      <Modal.Footer className="border-0 pt-0">{renderFooter()}</Modal.Footer>
    </Modal>
  );
};

export default CSVImporter;
