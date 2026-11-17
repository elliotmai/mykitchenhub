// src/components/ConnectedApps/ConnectedApps.jsx
// Settings → Connected apps: let another of your apps (Fridge Board) read
// this kitchen through the `board` API, and take that away again.
//
// The token is minted on the server and shown here exactly once. Nothing in
// the browser keeps it: close the panel and it is gone.

import React, { useState } from 'react';
import { Alert, Button, Form, InputGroup, ListGroup, Spinner } from 'react-bootstrap';
import { Copy, Check, Plug } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';

import useApiTokens from '../../hooks/useApiTokens';

const MAX_LABEL_LENGTH = 60;

/** "2 hours ago", or "Never used". */
export const lastUsedLabel = (iso, now = new Date()) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Never used';
  // A clock a few seconds ahead of the server should not read "in 3 seconds".
  const safe = date > now ? now : date;
  return `Last used ${formatDistanceToNowStrict(safe, { addSuffix: true })}`;
};

/** "Connected 17 Nov 2026". */
export const createdLabel = (iso) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `Connected ${format(date, 'd MMM yyyy')}`;
};

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

/** The new token, once, with Copy and Done. */
const NewToken = ({ label, token, onDone }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    setCopied(await copyText(token));
  };

  return (
    <Alert variant="success" data-testid="new-api-token">
      <p className="fw-semibold mb-2">{label} is connected.</p>
      <Form.Label htmlFor="new-api-token-value" className="small mb-1">
        Token
      </Form.Label>
      <InputGroup className="mb-2">
        <Form.Control
          id="new-api-token-value"
          readOnly
          value={token}
          onFocus={(e) => e.target.select()}
          className="font-monospace"
        />
        <Button variant="outline-secondary" onClick={handleCopy}>
          {copied ? (
            <>
              <Check size={16} className="me-1" /> Copied
            </>
          ) : (
            <>
              <Copy size={16} className="me-1" /> Copy
            </>
          )}
        </Button>
      </InputGroup>
      <p className="small mb-3">Copy this now. You won’t see it again.</p>
      <Button variant="primary" onClick={onDone}>
        Done
      </Button>
    </Alert>
  );
};

/** Ask for a name, then mint. */
const ConnectForm = ({ onCreate, onCancel }) => {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = label.trim();
    if (!name) {
      setError('Give the app a name.');
      return;
    }
    setSaving(true);
    setError('');
    const result = await onCreate(name);
    setSaving(false);
    if (!result.success) setError(result.error);
  };

  return (
    <Form onSubmit={handleSubmit} className="mb-3" data-testid="connect-app-form">
      {error && (
        <Alert variant="danger" className="py-2">
          {error}
        </Alert>
      )}
      <Form.Group className="mb-3" controlId="connect-app-name">
        <Form.Label>App name</Form.Label>
        <Form.Control
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Fridge Board"
          maxLength={MAX_LABEL_LENGTH}
          autoFocus
        />
      </Form.Group>
      <div className="d-flex gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? (
            <>
              <Spinner size="sm" className="me-2" />
              Connecting…
            </>
          ) : (
            'Connect'
          )}
        </Button>
        <Button variant="outline-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Form>
  );
};

/** One connected app, with an in-page confirmation before revoking. */
const TokenRow = ({ token, onRevoke }) => {
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');

  const handleRevoke = async () => {
    setRevoking(true);
    setError('');
    const result = await onRevoke(token.id);
    // On success the row unmounts, so only a failure needs state.
    if (!result.success) {
      setRevoking(false);
      setError(result.error);
    }
  };

  return (
    <ListGroup.Item data-testid="connected-app">
      <div className="d-flex align-items-center gap-3 flex-wrap">
        <div className="flex-grow-1">
          <div className="fw-semibold">{token.label}</div>
          <small className="text-muted">
            {[createdLabel(token.createdAt), lastUsedLabel(token.lastUsedAt)]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </div>
        {!confirming && (
          <Button variant="outline-danger" size="sm" onClick={() => setConfirming(true)}>
            Revoke
          </Button>
        )}
      </div>

      {confirming && (
        <div className="mt-2" role="group" aria-label={`Revoke ${token.label}`}>
          <p className="mb-2">Revoke {token.label}? It stops working straight away.</p>
          {error && (
            <Alert variant="danger" className="py-2">
              {error}
            </Alert>
          )}
          <div className="d-flex gap-2">
            <Button variant="danger" size="sm" onClick={handleRevoke} disabled={revoking}>
              {revoking ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Revoking…
                </>
              ) : (
                `Revoke ${token.label}`
              )}
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => {
                setConfirming(false);
                setError('');
              }}
              disabled={revoking}
            >
              Keep it
            </Button>
          </div>
        </div>
      )}
    </ListGroup.Item>
  );
};

/**
 * ConnectedApps — the whole panel. Data comes from useApiTokens.
 */
const ConnectedApps = () => {
  const { tokens, loading, error, createToken, revokeToken } = useApiTokens();
  const [connecting, setConnecting] = useState(false);
  const [minted, setMinted] = useState(null);

  const handleCreate = async (label) => {
    const result = await createToken(label);
    if (result.success) {
      setConnecting(false);
      setMinted({ label, token: result.token });
    }
    return result;
  };

  return (
    <div data-testid="connected-apps">
      <p className="text-muted">
        A connected app can read this kitchen — the week’s meals and their recipes, what is about to
        go off and the shopping list — and add to or tick off the shopping list.
      </p>

      {error && (
        <Alert variant="danger" className="py-2">
          {error}
        </Alert>
      )}

      {minted && (
        <NewToken label={minted.label} token={minted.token} onDone={() => setMinted(null)} />
      )}

      {connecting ? (
        <ConnectForm onCreate={handleCreate} onCancel={() => setConnecting(false)} />
      ) : (
        !minted && (
          <Button
            variant="primary"
            className="mb-3 d-inline-flex align-items-center gap-2"
            onClick={() => setConnecting(true)}
          >
            <Plug size={16} /> Connect an app
          </Button>
        )
      )}

      {loading ? (
        <div className="text-center py-3">
          <Spinner size="sm" className="me-2" />
          <span className="text-muted">Loading connected apps…</span>
        </div>
      ) : tokens.length === 0 ? (
        !error && (
          <p className="text-muted mb-0">
            No apps connected. Connect one to let another of your apps read this one.
          </p>
        )
      ) : (
        <ListGroup>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} onRevoke={revokeToken} />
          ))}
        </ListGroup>
      )}
    </div>
  );
};

export default ConnectedApps;
