// src/pages/JoinShare.jsx
// /join/<token>: an invite to plan events with a household (as a partner) or
// to one event (as a guest). Signed out, it remembers the link (it survives
// signing up and confirming the email) and asks for a sign-in first.

import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Container } from 'react-bootstrap';

import { useAuth } from '../hooks/useAuth';
import { joinShare } from '../backend/sharing';
import { forgetHousehold, setActiveKitchen } from '../backend/supabase';
import { PENDING_SHARE_KEY } from '../components/Auth/HouseholdGate';
import { PageLoader } from '../components/Common';

const JoinShare = () => {
  const { token } = useParams();
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    let live = true;
    (async () => {
      try {
        const joined = await joinShare(token);
        // Open on what was shared; someone with a household of their own can switch back.
        setActiveKitchen({ ...joined, can_edit: true });
        forgetHousehold();
        if (live) navigate('/events', { replace: true });
      } catch (err) {
        if (live) setProblem(err.message || 'That link didn’t work.');
      }
    })();
    return () => {
      live = false;
    };
  }, [token, isAuthenticated, loading, navigate]);

  if (loading) return <PageLoader message="Loading..." />;
  if (!isAuthenticated) {
    try {
      window.localStorage.setItem(PENDING_SHARE_KEY, token);
    } catch {
      /* the login redirect below carries it as well */
    }
    return <Navigate to="/login" state={{ from: { pathname: `/join/${token}` } }} replace />;
  }
  if (problem) {
    return (
      <Container className="py-5" style={{ maxWidth: '32rem' }}>
        <Alert variant="warning">{problem}</Alert>
        <Button onClick={() => navigate('/events')}>Go to KitchenHub</Button>
      </Container>
    );
  }
  return <PageLoader message="Joining…" />;
};

export default JoinShare;
