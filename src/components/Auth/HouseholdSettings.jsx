// src/components/Auth/HouseholdSettings.jsx
// Settings → Household: the code someone else enters to join this kitchen's
// household (owners only, as in Hive and Let's Eat), and a new code that
// stops the old one working.

import React, { useState } from 'react';
import { Alert, Button } from 'react-bootstrap';

import { currentHousehold, householdCode, newHouseholdCode } from '../../backend/household';
import ShareControls from '../../sharing/ShareControls';

const HouseholdSettings = () => {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (make) => {
    setBusy(true);
    setProblem('');
    try {
      setCode(await make(await currentHousehold()));
    } catch (err) {
      setProblem(
        /owner/i.test(err.message) ? 'Only the household’s owner can share its code.' : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-3">
      <p className="mb-0 text-muted">
        Everyone in your household shares the recipes, meal plan, events and shopping list. To add
        someone, give them the household code: they sign in, choose “Join yours with its code” and
        enter it.
      </p>
      {code ? (
        <div className="d-flex flex-wrap align-items-center gap-3">
          <span>
            Household code: <b style={{ letterSpacing: '0.08em' }}>{code}</b>
          </span>
          <Button
            size="sm"
            variant="outline-secondary"
            disabled={busy}
            onClick={() => run(newHouseholdCode)}
          >
            New code
          </Button>
        </div>
      ) : (
        <Button className="align-self-start" disabled={busy} onClick={() => run(householdCode)}>
          Show the household code
        </Button>
      )}
      {code && (
        <small className="text-muted">It doesn’t expire. “New code” stops this one working.</small>
      )}
      {problem && <Alert variant="warning">{problem}</Alert>}
      <hr className="my-1" />
      <h6 className="mb-0">Event partners</h6>
      <p className="mb-0 text-muted">
        People outside the household who always plan events with you: every event, its menu and
        shopping, and the recipe book. They don’t see the pantry, meal plan, timers or settings.
      </p>
      <ShareControls kind="partner" what="plan all your events with you and use your recipe book" />
    </div>
  );
};

export default HouseholdSettings;
