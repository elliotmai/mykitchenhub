// src/components/Auth/HouseholdGate.jsx
// KitchenHub belongs to a household: everyone in it shares the recipes, meal
// plan, events and shopping list. Someone signed in without one makes a
// household, or joins theirs with the code someone in it shares (Settings →
// Household here, or Hive or Let's Eat: the same codes).

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Form } from 'react-bootstrap';

import { createHousehold, currentHousehold, joinHousehold } from '../../backend/household';
import { PageLoader } from '../Common';

const HouseholdGate = ({ children }) => {
  const [state, setState] = useState('checking'); // checking | none | ready | error
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const check = useCallback(async () => {
    try {
      setState((await currentHousehold()) ? 'ready' : 'none');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const run = async (work) => {
    setBusy(true);
    setProblem('');
    try {
      await work();
      await check();
    } catch (err) {
      setProblem(
        /invite|code/i.test(err.message)
          ? 'That code didn’t work. Check it with whoever sent it.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  if (state === 'checking') return <PageLoader message="Loading..." />;
  if (state === 'ready') return children;

  return (
    <Container className="py-5" style={{ maxWidth: '32rem' }}>
      <Card className="shadow-sm" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
        <Card.Body className="p-4 d-flex flex-column gap-3">
          <h1 className="h4 mb-0">Your household’s kitchen</h1>
          {state === 'error' ? (
            <>
              <Alert variant="warning" className="mb-0">
                Couldn’t check your household. Check your connection.
              </Alert>
              <Button onClick={check}>Try again</Button>
            </>
          ) : (
            <>
              <p className="mb-0 text-muted">
                KitchenHub belongs to a household: everyone in it shares the recipes, meal plan,
                events and shopping list.
              </p>
              {problem && (
                <Alert variant="danger" className="mb-0">
                  {problem}
                </Alert>
              )}
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => joinHousehold(code));
                }}
                className="d-flex flex-column gap-2"
              >
                <Form.Label htmlFor="household-code" className="mb-0 fw-semibold">
                  Join yours with its code
                </Form.Label>
                <Form.Control
                  id="household-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="Household code"
                />
                <Button type="submit" disabled={busy || !code.trim()}>
                  Join
                </Button>
              </Form>
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => createHousehold(name));
                }}
                className="d-flex flex-column gap-2"
              >
                <Form.Label htmlFor="household-name" className="mb-0 fw-semibold">
                  Or make a new household
                </Form.Label>
                <Form.Control
                  id="household-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="The Smiths"
                />
                <Button type="submit" variant="outline-primary" disabled={busy || !name.trim()}>
                  Make a household
                </Button>
              </Form>
            </>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default HouseholdGate;
