// src/pages/LinkAlexa.jsx
// Where Amazon sends a cook to prove which kitchen is theirs — roadmap 7.4.
//
// This is the Authorization URI configured on the skill's account linking page.
// Alexa opens it in a browser; the sign-in gate in front of it does the actual
// authenticating; and then this page trades that Firebase session for a
// one-time code and hands it back to Amazon at the redirect URI Amazon named.
//
// Arriving here without Amazon's query parameters is not an error — it is
// somebody looking for the "disconnect Alexa" button, so that is what they get.

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Spinner } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Mic } from 'lucide-react';

import { functions } from '../services/firebase';

/**
 * Build the URL Amazon expects the browser to come back to.
 *
 * `state` is echoed back untouched — it is Amazon's CSRF token, and a linking
 * attempt that loses it is rejected at their end.
 */
export const buildRedirect = (redirectUri, code, state) => {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return url.toString();
};

const LinkAlexa = () => {
  const [params] = useSearchParams();
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [redirectUrl, setRedirectUrl] = useState(null);
  const [unlinked, setUnlinked] = useState(null);

  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');
  const responseType = params.get('response_type');

  const isLinkingRequest = Boolean(clientId && redirectUri);

  const link = useCallback(async () => {
    setStatus('working');
    setError(null);

    try {
      const createCode = httpsCallable(functions, 'createAlexaAuthCode');
      const result = await createCode({ clientId, redirectUri });
      const code = result?.data?.code;
      if (!code) throw new Error('No code was issued.');

      const target = buildRedirect(redirectUri, code, state);
      setRedirectUrl(target);
      setStatus('redirecting');
      // The link is rendered as well: a browser that blocks the automatic hop
      // should still leave somebody one tap from a linked skill.
      window.location.assign(target);
    } catch (err) {
      console.error('Alexa linking failed:', err);
      setStatus('error');
      setError(err?.message || 'Could not link your account.');
    }
  }, [clientId, redirectUri, state]);

  useEffect(() => {
    // Amazon only sends people here after they have pressed "Link Account", so
    // there is no second confirmation to ask for — but a response type we do
    // not implement is worth refusing loudly rather than half-answering.
    if (!isLinkingRequest || status !== 'idle') return;
    if (responseType && responseType !== 'code') {
      setStatus('error');
      setError(`Alexa asked for a "${responseType}" response, which this app does not issue.`);
      return;
    }
    link();
  }, [isLinkingRequest, responseType, status, link]);

  const unlink = async () => {
    setStatus('working');
    setError(null);
    try {
      const revoke = httpsCallable(functions, 'unlinkAlexa');
      const result = await revoke();
      setUnlinked(result?.data?.revoked ?? 0);
      setStatus('idle');
    } catch (err) {
      console.error('Alexa unlink failed:', err);
      setStatus('error');
      setError(err?.message || 'Could not unlink Alexa.');
    }
  };

  return (
    <Container className="py-5" style={{ maxWidth: '32rem' }}>
      <Card className="shadow-sm" style={{ borderRadius: 'var(--mkh-radius-lg)' }}>
        <Card.Body className="p-4">
          <div className="d-flex align-items-center gap-2 mb-3">
            <Mic size={20} />
            <h1 className="h5 mb-0">Alexa</h1>
          </div>

          {error && (
            <Alert variant="danger" className="py-2">
              {error}
            </Alert>
          )}

          {isLinkingRequest ? (
            <>
              <p className="text-muted">
                Connecting your kitchen to Alexa, so &ldquo;Alexa, tell My Kitchen Hub to add
                milk&rdquo; puts milk on this shopping list.
              </p>

              {status === 'working' && (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" /> <span>Linking…</span>
                </div>
              )}

              {status === 'redirecting' && (
                <p className="mb-0">
                  Taking you back to Alexa… <a href={redirectUrl}>Continue</a> if nothing happens.
                </p>
              )}

              {status === 'error' && (
                <Button variant="primary" onClick={link}>
                  Try again
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-muted">
                To connect Alexa, enable the My Kitchen Hub skill in the Alexa app and choose
                &ldquo;Link Account&rdquo; — Alexa will send you back here.
              </p>

              {unlinked !== null && (
                <Alert variant="success" className="py-2">
                  {unlinked > 0
                    ? 'Alexa can no longer reach your kitchen.'
                    : 'There was nothing linked to disconnect.'}
                </Alert>
              )}

              <Button variant="outline-danger" onClick={unlink} disabled={status === 'working'}>
                {status === 'working' ? 'Disconnecting…' : 'Disconnect Alexa'}
              </Button>
            </>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default LinkAlexa;
