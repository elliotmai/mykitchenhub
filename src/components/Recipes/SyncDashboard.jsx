// src/components/Recipes/SyncDashboard.jsx
// Admin view over the legacy "Let's Eat" recipe sync — Phase 4.2.
//
// The sync costs real money: every recipe without instructions is looked up in
// Spoonacular and, failing that, written by Claude. So this screen leads with
// what has been spent, runs in small explicit batches, and offers a dry run
// that reports what *would* happen without writing or spending anything.

import React, { useState } from 'react';
import { Modal, Button, Form, Row, Col, Badge, ProgressBar, Alert, Table } from 'react-bootstrap';
import { RefreshCw, DollarSign, AlertTriangle } from 'lucide-react';

import useSyncStatus from '../../hooks/useSyncStatus';

const STATUS_VARIANTS = {
  idle: 'secondary',
  'in-progress': 'info',
  completed: 'success',
  'cost-limit-reached': 'warning',
  error: 'danger',
};

/** Firestore Timestamp | ISO string → something a human can read. */
export const formatSyncTime = (value) => {
  if (!value) return 'Never';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
};

export const formatUsd = (value) => `$${(Number(value) || 0).toFixed(2)}`;

/**
 * SyncDashboard
 *
 * @param {boolean}  show
 * @param {function} onHide
 */
const SyncDashboard = ({ show, onHide }) => {
  const { status, loading, error, running, lastResult, runBatch, progress } = useSyncStatus();
  const [batchSize, setBatchSize] = useState('10');
  const [dryRun, setDryRun] = useState(true);

  const handleRun = (restart = false) =>
    runBatch({ limit: Number(batchSize) || 10, dryRun, restart });

  const sources = status.instructionSources ?? {};

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="d-flex align-items-center gap-2">
          <RefreshCw size={20} className="text-primary" />
          Legacy Recipe Sync
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}

        <div className="d-flex align-items-center gap-2 mb-3">
          <span className="fw-semibold">Status</span>
          <Badge bg={STATUS_VARIANTS[status.currentStatus] ?? 'secondary'}>
            {loading ? 'loading' : status.currentStatus}
          </Badge>
          <span className="text-muted ms-auto" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
            Last run: {formatSyncTime(status.lastSyncTimestamp)}
          </span>
        </div>

        <ProgressBar
          now={progress}
          label={`${progress}%`}
          className="mb-3"
          aria-label="Sync progress"
        />

        <Table size="sm" borderless className="mb-3">
          <tbody>
            <tr>
              <td>Recipes seen in the legacy database</td>
              <td className="text-end fw-semibold">{status.recipesToProcess ?? 0}</td>
            </tr>
            <tr>
              <td>Processed</td>
              <td className="text-end fw-semibold">{status.recipesProcessed ?? 0}</td>
            </tr>
            <tr>
              <td>Imported</td>
              <td className="text-end fw-semibold">{status.recipesImported ?? 0}</td>
            </tr>
            <tr>
              <td>Skipped (already here, or unusable)</td>
              <td className="text-end fw-semibold">{status.recipesSkipped ?? 0}</td>
            </tr>
            <tr>
              <td>Instructions matched from Spoonacular</td>
              <td className="text-end fw-semibold">{sources.spoonacular ?? 0}</td>
            </tr>
            <tr>
              <td>Instructions written by Claude</td>
              <td className="text-end fw-semibold">{sources.ai_generated ?? 0}</td>
            </tr>
            <tr>
              <td className="d-flex align-items-center gap-1">
                <DollarSign size={14} /> Spent so far
              </td>
              <td className="text-end fw-semibold">
                {formatUsd(status.costAccumulated)}
                {status.costLimitUsd ? ` of ${formatUsd(status.costLimitUsd)}` : ''}
              </td>
            </tr>
          </tbody>
        </Table>

        {status.lastError && (
          <Alert variant="warning" className="py-2 d-flex align-items-start gap-2">
            <AlertTriangle size={16} className="flex-shrink-0 mt-1" />
            <span>{status.lastError}</span>
          </Alert>
        )}

        <hr />

        <Row className="g-2 align-items-end mb-2">
          <Col xs={6} sm={4}>
            <Form.Label className="fw-semibold mb-1">Recipes this batch</Form.Label>
            <Form.Control
              type="number"
              aria-label="Recipes this batch"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              min="1"
              max="100"
            />
          </Col>
          <Col xs={6} sm={4}>
            <Form.Check
              type="switch"
              id="sync-dry-run"
              label="Dry run (spends nothing)"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
          </Col>
          <Col xs={12} sm={4} className="d-flex gap-2 justify-content-sm-end">
            <Button variant="primary" disabled={running} onClick={() => handleRun(false)}>
              {running ? 'Running…' : 'Run batch'}
            </Button>
            <Button variant="outline-secondary" disabled={running} onClick={() => handleRun(true)}>
              Start over
            </Button>
          </Col>
        </Row>

        <p className="text-muted mb-0" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
          A real run reads the legacy database, calls Spoonacular, and falls back to Claude for
          anything it cannot match — each of which costs money. Batches resume where the last one
          stopped; “Start over” rewinds to the first recipe.
        </p>

        {lastResult && (
          <Alert variant="info" className="mt-3 py-2 mb-0">
            <strong>{lastResult.dryRun ? 'Dry run' : 'Run'} finished:</strong>{' '}
            {lastResult.processed ?? 0} processed, {lastResult.imported ?? 0} imported,{' '}
            {lastResult.skipped ?? 0} skipped, {formatUsd(lastResult.cost)} spent.
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer className="border-0">
        <Button variant="light" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SyncDashboard;
