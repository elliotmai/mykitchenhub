// src/components/HelloFresh/UrlImport.jsx
// Paste the link from the HelloFresh app or email and we read the page.

import React, { useState } from 'react';
import { Alert, Button, Card, Form, InputGroup, Spinner } from 'react-bootstrap';
import { Link2 } from 'lucide-react';

import { looksLikeHelloFreshUrl } from '../../services/helloFreshApi';

const UrlImport = ({ onImport, onManualEntry, importing = false, error = null }) => {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = url.trim();
  // Only complain once they've typed something and moved on.
  const invalid = touched && trimmed.length > 0 && !looksLikeHelloFreshUrl(trimmed);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (!trimmed || !looksLikeHelloFreshUrl(trimmed)) return;
    await onImport(trimmed);
  };

  return (
    <Card>
      <Card.Body className="py-4">
        <div className="text-center mb-3">
          <Link2 size={48} className="text-primary mb-3" aria-hidden="true" />
          <h5>Paste the recipe link</h5>
          <p className="text-muted mb-0">
            Copy the link from your HelloFresh app or delivery email. We&rsquo;ll pull the
            ingredients and steps straight off the page.
          </p>
        </div>

        <Form onSubmit={handleSubmit} noValidate>
          <Form.Group controlId="hellofresh-url">
            <Form.Label>HelloFresh recipe link</Form.Label>
            <InputGroup hasValidation>
              <Form.Control
                type="url"
                inputMode="url"
                placeholder="https://www.hellofresh.com/recipes/…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => setTouched(true)}
                isInvalid={invalid}
                disabled={importing}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={importing || trimmed.length === 0}
                className="d-flex align-items-center gap-2"
              >
                {importing ? (
                  <>
                    <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                    Reading…
                  </>
                ) : (
                  'Import'
                )}
              </Button>
              <Form.Control.Feedback type="invalid">
                That needs to be a hellofresh.com recipe link.
              </Form.Control.Feedback>
            </InputGroup>
          </Form.Group>
        </Form>

        {error && (
          <Alert variant="warning" className="mt-3 mb-0">
            {error.message}
            {error.code === 'recipe-not-found' && (
              <div className="small mt-1">
                Some pages load their recipe after the fact. Photographing the card works better for
                those.
              </div>
            )}
          </Alert>
        )}

        <div className="text-center mt-3">
          <Button variant="link" onClick={onManualEntry} disabled={importing}>
            No link? Enter it by hand
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default UrlImport;
