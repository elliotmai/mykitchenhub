// src/components/Recipes/RecipeImportModal.jsx
// "Import recipes": paste one that ChatGPT or Claude wrote, or pick the zip
// Pestle's "Export all" produced. Either way the cook sees what will come in
// before anything is saved.

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Button,
  Form,
  Alert,
  ProgressBar,
  ListGroup,
  Spinner,
  Tabs,
  Tab,
} from 'react-bootstrap';
import { Upload, CheckCircle, Copy, Check } from 'lucide-react';

import useRecipeImport from '../../hooks/useRecipeImport';
import { RECIPE_FORMAT_PROMPT } from '../../utils/recipeImport';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const IMPORT_TABS = { paste: 'paste', pestle: 'pestle' };

/** Clipboard write with a fallback for browsers that refuse the async API. */
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove();
    return Boolean(ok);
  }
};

/**
 * RecipeImportModal
 *
 * @param {boolean}  show
 * @param {function} onHide
 * @param {array}    existingRecipes - the current library, to skip duplicates
 * @param {string}   initialTab      - 'paste' (default) or 'pestle'
 * @param {string}   initialText     - prefill for the paste box (from the share sheet)
 * @param {function} onOpenRecipe    - (id) => void, offered after a single import
 */
const RecipeImportModal = ({
  show,
  onHide,
  existingRecipes = [],
  initialTab = IMPORT_TABS.paste,
  initialText = '',
  onOpenRecipe,
}) => {
  const {
    plan,
    preparing,
    committing,
    progress,
    result,
    error,
    prepareFiles,
    prepareText,
    commit,
    reset,
  } = useRecipeImport(existingRecipes);
  const inputRef = useRef(null);
  const [tab, setTab] = useState(initialTab);
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show) {
      setTab(initialTab);
      setText(initialText);
    } else {
      reset();
      setCopied(false);
    }
  }, [show, initialTab, initialText, reset]);

  const switchTab = (key) => {
    if (committing) return;
    reset();
    setTab(key);
  };

  const handleFiles = (event) => {
    const { files } = event.target;
    if (files?.length) prepareFiles(files);
  };

  const handleCopyFormat = async () => {
    setCopied(await copyText(RECIPE_FORMAT_PROMPT));
  };

  const done = Boolean(result?.success);
  const readyCount = plan?.ready.length ?? 0;
  const missingSteps = plan?.ready.filter((r) => r.missingSteps) ?? [];
  const singleId = done && result.ids?.length === 1 ? result.ids[0] : null;

  const summary = plan && !preparing && (
    <>
      <Alert variant={readyCount > 0 ? 'info' : 'secondary'} className="mb-3">
        <strong>{plural(readyCount, 'recipe')}</strong> ready to import.
        {plan.duplicates.length > 0 && (
          <>
            {' '}
            {plural(plan.duplicates.length, 'recipe')} already in your library will be skipped
            {plan.duplicates.length <= 3 && <> ({plan.duplicates.map((d) => d.name).join(', ')})</>}
            .
          </>
        )}
        {plan.problems.length > 0 && (
          <>
            {' '}
            {plural(plan.problems.length, tab === IMPORT_TABS.paste ? 'part' : 'file')} couldn’t be
            read.
          </>
        )}
      </Alert>

      {missingSteps.length > 0 && (
        <Alert variant="warning" className="mb-3">
          No steps found for {missingSteps.map((r) => r.name).join(', ')}. It will be imported with
          a reminder to add them.
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
        <ListGroup variant="flush" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {plan.ready.map((r) => (
            <ListGroup.Item key={r.fileName} className="px-0 py-1 small">
              <span className="fw-semibold">{r.name}</span>
              <span className="text-muted">
                {' '}
                · {plural(r.document.ingredients.length, 'ingredient')}
                {!r.missingSteps && <> · {plural(r.document.instructions.length, 'step')}</>}
              </span>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}

      {plan.problems.length > 0 && (
        <details className="mt-3 small">
          <summary>What couldn’t be read</summary>
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
  );

  return (
    <Modal
      show={show}
      onHide={committing ? undefined : onHide}
      centered
      scrollable
      aria-labelledby="recipe-import-title"
    >
      <Modal.Header closeButton={!committing}>
        <Modal.Title id="recipe-import-title">Import recipes</Modal.Title>
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
            {tab === IMPORT_TABS.pestle && (
              <p className="text-muted mb-0">
                They’re tagged <strong>pestle</strong> so you can filter to them.
              </p>
            )}
          </div>
        ) : (
          <Tabs
            activeKey={tab}
            onSelect={switchTab}
            className="mb-3"
            fill
            mountOnEnter
            unmountOnExit
          >
            <Tab eventKey={IMPORT_TABS.paste} title="Paste a recipe" disabled={committing}>
              <p className="text-muted small mb-2">
                Paste a recipe from ChatGPT, Claude or anywhere else. For the cleanest result, copy
                the format below and send it to the assistant with your request — or after it, as
                “rewrite that recipe in this format”.
              </p>

              <div className="d-flex gap-2 flex-wrap mb-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="d-flex align-items-center gap-1"
                  onClick={handleCopyFormat}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Format copied' : 'Copy format for ChatGPT / Claude'}
                </Button>
              </div>

              <details className="small mb-3">
                <summary>Show the format</summary>
                <pre
                  className="mt-2 mb-0 p-2"
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: 'var(--mkh-bg-subtle, #f6f6f6)',
                    borderRadius: 'var(--mkh-radius-md, 6px)',
                    fontSize: '0.8rem',
                  }}
                >
                  {RECIPE_FORMAT_PROMPT}
                </pre>
              </details>

              <Form.Group controlId="recipe-import-text" className="mb-2">
                <Form.Label className="visually-hidden">Recipe text</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={8}
                  placeholder={
                    '# Recipe name\n\n## Ingredients\n* 1 cup rice\n\n## Instructions\n1. Cook the rice.'
                  }
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (plan || error) reset();
                  }}
                  disabled={committing}
                />
              </Form.Group>

              <div className="d-flex justify-content-end mb-3">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => prepareText(text)}
                  disabled={!text.trim() || committing}
                >
                  Preview
                </Button>
              </div>

              {error && <Alert variant="danger">{error}</Alert>}
              {summary}
            </Tab>

            <Tab eventKey={IMPORT_TABS.pestle} title="Pestle export" disabled={committing}>
              <p className="text-muted">
                In Pestle, use <strong>Export all</strong> and choose the .zip it gives you. You can
                also pick individual .md recipe files.
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
              {summary}
            </Tab>
          </Tabs>
        )}
      </Modal.Body>

      <Modal.Footer>
        {done ? (
          <>
            {singleId && onOpenRecipe && (
              <Button
                variant="outline-primary"
                onClick={() => {
                  onHide?.();
                  onOpenRecipe(singleId);
                }}
              >
                Open recipe
              </Button>
            )}
            <Button variant="primary" onClick={onHide}>
              Done
            </Button>
          </>
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

export default RecipeImportModal;
