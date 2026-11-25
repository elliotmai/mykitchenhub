// src/components/Auth/HouseholdGate.jsx
// KitchenHub belongs to a household: everyone in it shares the recipes, meal
// plan, events and shopping list. Someone signed in without one makes a
// household, or joins theirs with the code someone in it shares (Settings →
// Household here, or Hive or Let's Eat: the same codes).
//
// People outside the household can also plan events with it (event partners,
// and guests on one event; src/backend/sharing.js). They may have no
// household at all: then the app opens on what's shared with them. Someone
// with both can switch (useKitchen().switchTo). While working in a shared
// kitchen only the event side of the app is offered; the database enforces
// the rest.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Button, Card, Container, Form } from 'react-bootstrap';

import { createHousehold, joinHousehold } from '../../backend/household';
import {
  activeKitchen,
  forgetHousehold,
  ownHousehold,
  setActiveKitchen,
} from '../../backend/supabase';
import { acceptMyInvites, joinShare, myShares } from '../../backend/sharing';
import { PageLoader } from '../Common';

export const PENDING_SHARE_KEY = 'kitchenhub.pendingShare';
/** Pages of the event side of the app: what a shared kitchen offers. */
export const SHARED_PATHS = ['/events', '/recipes', '/shopping-list', '/settings'];

const KitchenContext = createContext({ own: null, shares: [], active: null, switchTo: () => {} });
export const useKitchen = () => useContext(KitchenContext);

const sameShare = (a, b) =>
  a &&
  b &&
  a.household_id === b.household_id &&
  a.kind === b.kind &&
  (a.event_id || '') === (b.event_id || '');

/** Take up a link opened before signing in (e.g. across the email confirmation). */
const takePendingShare = async () => {
  let token = null;
  try {
    token = window.localStorage.getItem(PENDING_SHARE_KEY);
    window.localStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    token = null;
  }
  if (!token) return null;
  try {
    return await joinShare(token);
  } catch {
    return null;
  }
};

const HouseholdGate = ({ children }) => {
  const location = useLocation();
  const [state, setState] = useState('checking'); // checking | none | ready | error
  const [kitchen, setKitchen] = useState({ own: null, shares: [], active: null });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const check = useCallback(async () => {
    try {
      const joined = await takePendingShare();
      await acceptMyInvites().catch(() => 0);
      const [own, shares] = await Promise.all([ownHousehold(), myShares().catch(() => [])]);
      let active = activeKitchen();
      if (joined) active = shares.find((s) => s.household_id === joined.household_id) || active;
      if (active && !shares.some((s) => sameShare(s, active))) active = null;
      if (!own && !active && shares.length) active = shares[0];
      setActiveKitchen(active);
      forgetHousehold();
      setKitchen({ own, shares, active });
      setState(own || active ? 'ready' : 'none');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const switchTo = useCallback((share) => {
    setActiveKitchen(share || null);
    forgetHousehold();
    window.location.assign(share ? '/events' : '/dashboard');
  }, []);

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
  if (state === 'ready') {
    // A shared kitchen offers the event side of the app only.
    if (kitchen.active && !SHARED_PATHS.some((p) => location.pathname.startsWith(p))) {
      return <Navigate to="/events" replace />;
    }
    return (
      <KitchenContext.Provider value={{ ...kitchen, switchTo }}>{children}</KitchenContext.Provider>
    );
  }

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
                events and shopping list. Invited to plan an event? Open the link you were sent.
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
