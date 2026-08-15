// src/components/WasteAlerts/FreezerSuggestions.jsx
// "Freeze it and it keeps for months" — roadmap 6.3.
//
// Shows only items the freezer would genuinely rescue, says how many days that
// buys, and offers to move all of it or half of it.

import React, { useState } from 'react';
import { Alert, Badge, Button, Card, ListGroup, Spinner } from 'react-bootstrap';
import { Snowflake } from 'lucide-react';

import { getExpirationLabel } from '../../hooks/useInventory';
// The same threshold the hook enforces. Keeping a second copy here meant the
// button could be enabled for a quantity `freezeHalf` would then refuse.
import { canSplitQuantity } from '../../hooks/useWasteAlerts';

/**
 * FreezerSuggestions
 *
 * @param {Array}    suggestions     - [{ item, frozenDays, daysLeft, daysGained }]
 * @param {object}   freezerLocation - the storageLocation items would move to
 * @param {function} onFreezeAll     - async (item) => { success, error }
 * @param {function} onFreezeHalf    - async (item) => { success, error }
 */
const FreezerSuggestions = ({
  suggestions = [],
  freezerLocation = null,
  onFreezeAll,
  onFreezeHalf,
}) => {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const run = async (action, item, id) => {
    setBusyId(id);
    setError('');
    const result = await action?.(item);
    setBusyId(null);
    if (result && !result.success) {
      setError(result.error || 'Could not move that to the freezer. Please try again.');
    }
  };

  return (
    <Card data-testid="freezer-suggestions">
      <Card.Header className="bg-transparent d-flex align-items-center gap-2">
        <Snowflake size={18} className="text-info" aria-hidden="true" />
        <h5 className="mb-0">Freeze it instead</h5>
      </Card.Header>
      <Card.Body className="p-0">
        {error && (
          <Alert variant="warning" className="m-3 mb-0 py-2">
            {error}
          </Alert>
        )}

        {!freezerLocation && suggestions.length > 0 && (
          <Alert variant="info" className="m-3 mb-0 py-2">
            Add a freezer in Settings and these can be moved with one tap.
          </Alert>
        )}

        {suggestions.length === 0 ? (
          <div className="text-center text-muted py-4 px-3">
            <p className="mb-0">Nothing here would keep much longer in the freezer.</p>
          </div>
        ) : (
          <ListGroup variant="flush">
            {suggestions.map(({ item, daysGained, frozenDays }) => {
              const busy = busyId === item.id;
              const canSplit = canSplitQuantity(item.quantity);

              return (
                <ListGroup.Item key={item.id} data-testid="freezer-suggestion">
                  <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="fw-semibold text-capitalize">{item.name}</div>
                      <div className="text-muted small">
                        {getExpirationLabel(item.expiresAt)} · {item.quantity}
                        {item.unit ? ` ${item.unit}` : ''}
                      </div>
                      <Badge bg="info" text="dark" className="mt-1">
                        +{daysGained} days if you freeze it
                      </Badge>
                      <div className="text-muted" style={{ fontSize: 'var(--mkh-font-size-tiny)' }}>
                        Keeps about {frozenDays} days frozen
                      </div>
                    </div>

                    <div className="d-flex gap-2 flex-shrink-0">
                      {/*
                        The label stays put while the write is in flight.
                        Swapping it for a bare spinner left the button with no
                        accessible name at all, so a screen reader announced
                        "button" for the control it had just been told to
                        press. `aria-busy` carries the waiting state instead.
                      */}
                      <Button
                        size="sm"
                        variant="outline-primary"
                        disabled={busy || !freezerLocation}
                        aria-busy={busy}
                        onClick={() => run(onFreezeAll, item, item.id)}
                      >
                        {busy && <Spinner size="sm" className="me-1" aria-hidden="true" />}
                        Freeze All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={busy || !freezerLocation || !canSplit}
                        aria-busy={busy}
                        title={
                          canSplit ? undefined : 'Not enough of this to split — freeze all instead.'
                        }
                        // A `title` on a disabled button is not reliably read
                        // out, so the reason travels in the name as well.
                        aria-label={
                          canSplit
                            ? undefined
                            : `Freeze Half — not enough ${item.name} to split, freeze all instead`
                        }
                        onClick={() => run(onFreezeHalf, item, item.id)}
                      >
                        Freeze Half
                      </Button>
                    </div>
                  </div>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </Card.Body>
    </Card>
  );
};

export default FreezerSuggestions;
