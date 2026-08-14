// src/components/HelloFresh/PhotoImport.jsx
// Point your phone at the recipe card and let Claude Vision read it.

import React, { useRef, useState } from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import { Camera, Image as ImageIcon, RefreshCw } from 'lucide-react';

import { SUPPORTED_IMAGE_TYPES } from '../../services/helloFreshApi';

/**
 * When the AI cannot read a photo the cook needs to know what to change, not
 * that a request failed. Each code maps to something they can actually do.
 */
const RECOVERY_HINTS = {
  'unreadable-image': [
    'Lay the card flat and fill the frame with it.',
    'Turn on more light, and avoid glare from a flash.',
    'Photograph one side of the card at a time.',
  ],
  'vision-not-configured': ['Use “Enter it by hand” below, or paste the recipe link instead.'],
  'vision-request-failed': ['The AI service is having a moment. Try again shortly.'],
  network: ['Check your connection and try again.'],
  offline: ['You are offline. Reconnect and try again.'],
  'not-configured': ['Use “Enter it by hand” below, or paste the recipe link instead.'],
};

const PhotoImport = ({ onImport, onManualEntry, importing = false, error = null }) => {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState('');

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    // Let the same card be re-picked after a failure.
    event.target.value = '';
    if (!file) return;

    setFileName(file.name);
    setPreview(URL.createObjectURL(file));
    await onImport(file);
  };

  const openPicker = () => fileInputRef.current?.click();

  const hints = error ? (RECOVERY_HINTS[error.code] ?? RECOVERY_HINTS['unreadable-image']) : [];

  return (
    <Card>
      <Card.Body className="text-center py-4">
        <Camera size={48} className="text-primary mb-3" aria-hidden="true" />
        <h5>Photograph the recipe card</h5>
        <p className="text-muted">
          Snap the front of your HelloFresh card and we&rsquo;ll read the ingredients and steps off
          it. You get to check everything before it&rsquo;s saved.
        </p>

        {preview && (
          <img
            src={preview}
            alt={fileName ? `Preview of ${fileName}` : 'Recipe card preview'}
            className="img-fluid rounded mb-3"
            style={{ maxHeight: '220px' }}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_IMAGE_TYPES.join(',')}
          capture="environment"
          className="d-none"
          onChange={handleFile}
          data-testid="photo-input"
          aria-label="Recipe card photo"
        />

        <div className="d-flex flex-column flex-sm-row justify-content-center gap-2">
          <Button
            variant="primary"
            onClick={openPicker}
            disabled={importing}
            className="d-flex align-items-center justify-content-center gap-2"
          >
            {importing ? (
              <>
                <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
                Reading the card…
              </>
            ) : (
              <>
                {preview ? <RefreshCw size={18} /> : <ImageIcon size={18} />}
                {preview ? 'Try another photo' : 'Take or choose a photo'}
              </>
            )}
          </Button>

          <Button variant="outline-secondary" onClick={onManualEntry} disabled={importing}>
            Enter it by hand
          </Button>
        </div>

        {error && (
          <Alert variant="warning" className="text-start mt-3 mb-0">
            <div className="fw-semibold">{error.message}</div>

            {error.details?.length > 0 && (
              <ul className="mb-0 mt-2 small">
                {error.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}

            {hints.length > 0 && (
              <>
                <div className="small fw-semibold mt-2">What usually helps:</div>
                <ul className="mb-0 small">
                  {hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              </>
            )}
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
};

export default PhotoImport;
