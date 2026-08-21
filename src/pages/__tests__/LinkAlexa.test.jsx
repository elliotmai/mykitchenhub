// Account linking, from the app's side of it.
//
// Amazon hands this page a set of query parameters and expects the browser back
// with a code on the end of a redirect it named. So the two things worth
// testing are that the code goes to exactly the URI Amazon asked for, with the
// state it sent, and that arriving with none of that is the disconnect button
// rather than a broken page.

import React from 'react';
import { screen, waitFor } from '@testing-library/react';

import LinkAlexa, { buildRedirect } from '../LinkAlexa';
import { renderWithProviders } from '../../test-utils';
import * as fns from '../../test-utils/mocks/functions';

const REDIRECT = 'https://layla.amazon.com/api/skill/link/M2ABC123';
const LINK_ROUTE = `/link/alexa?client_id=mykitchenhub-alexa&redirect_uri=${encodeURIComponent(
  REDIRECT
)}&state=amazon-state&response_type=code`;

let assign;

beforeEach(() => {
  assign = jest.fn();
  // jsdom refuses a real navigation, and the assertion worth making is about
  // where the page tried to go rather than what jsdom did about it.
  delete window.location;
  window.location = { assign, href: 'http://localhost/link/alexa' };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const renderPage = (route) => renderWithProviders(<LinkAlexa />, { route, path: '/link/alexa' });

describe('buildRedirect', () => {
  it('puts the code and Amazon own state on the URI it was given', () => {
    const url = new URL(buildRedirect(REDIRECT, 'the-code', 'amazon-state'));

    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toBe('the-code');
    // The state is Amazon's CSRF token; a link that loses it is rejected there.
    expect(url.searchParams.get('state')).toBe('amazon-state');
  });

  it('leaves out a state Amazon did not send', () => {
    expect(buildRedirect(REDIRECT, 'the-code', null)).not.toContain('state');
  });

  it('keeps a query string the redirect URI already had', () => {
    const withQuery = `${REDIRECT}?vendorId=123`;
    const url = new URL(buildRedirect(withQuery, 'the-code', 's'));

    expect(url.searchParams.get('vendorId')).toBe('123');
    expect(url.searchParams.get('code')).toBe('the-code');
  });
});

describe('linking', () => {
  it('mints a code and sends the browser back to Amazon', async () => {
    fns.__callable('createAlexaAuthCode').mockResolvedValue({ data: { code: 'the-code' } });

    renderPage(LINK_ROUTE);

    await waitFor(() => expect(assign).toHaveBeenCalled());

    expect(fns.__callable('createAlexaAuthCode')).toHaveBeenCalledWith({
      clientId: 'mykitchenhub-alexa',
      redirectUri: REDIRECT,
    });
    expect(assign.mock.calls[0][0]).toContain('code=the-code');
    expect(assign.mock.calls[0][0]).toContain('state=amazon-state');
  });

  it('leaves a link to follow when the automatic hop does not happen', async () => {
    fns.__callable('createAlexaAuthCode').mockResolvedValue({ data: { code: 'the-code' } });

    renderPage(LINK_ROUTE);

    const link = await screen.findByRole('link', { name: 'Continue' });
    expect(link).toHaveAttribute('href', expect.stringContaining('code=the-code'));
  });

  it('says what went wrong, and offers another go', async () => {
    fns.__failCallable('createAlexaAuthCode', new Error('Unrecognised redirect URI.'));

    renderPage(LINK_ROUTE);

    expect(await screen.findByText('Unrecognised redirect URI.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not redirect anywhere when no code came back', async () => {
    fns.__callable('createAlexaAuthCode').mockResolvedValue({ data: {} });

    renderPage(LINK_ROUTE);

    await screen.findByRole('button', { name: 'Try again' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('refuses a response type it does not issue, rather than half-answering', async () => {
    renderPage(LINK_ROUTE.replace('response_type=code', 'response_type=token'));

    expect(await screen.findByText(/does not issue/)).toBeInTheDocument();
    expect(fns.__callable('createAlexaAuthCode')).not.toHaveBeenCalled();
  });

  it('links without a response type, which Amazon does not always send', async () => {
    fns.__callable('createAlexaAuthCode').mockResolvedValue({ data: { code: 'c' } });

    renderPage(LINK_ROUTE.replace('&response_type=code', ''));

    await waitFor(() => expect(assign).toHaveBeenCalled());
  });
});

describe('arriving without Amazon behind you', () => {
  it('is the disconnect button', async () => {
    const { user } = renderPage('/link/alexa');

    expect(screen.getByText(/enable the My Kitchen Hub skill/)).toBeInTheDocument();
    expect(fns.__callable('createAlexaAuthCode')).not.toHaveBeenCalled();

    fns.__callable('unlinkAlexa').mockResolvedValue({ data: { revoked: 2 } });
    await user.click(screen.getByRole('button', { name: 'Disconnect Alexa' }));

    expect(await screen.findByText(/no longer reach your kitchen/)).toBeInTheDocument();
  });

  it('says so when there was nothing linked in the first place', async () => {
    const { user } = renderPage('/link/alexa');

    fns.__callable('unlinkAlexa').mockResolvedValue({ data: { revoked: 0 } });
    await user.click(screen.getByRole('button', { name: 'Disconnect Alexa' }));

    expect(await screen.findByText(/nothing linked to disconnect/)).toBeInTheDocument();
  });

  it('reports a failed disconnect rather than claiming success', async () => {
    const { user } = renderPage('/link/alexa');

    fns.__failCallable('unlinkAlexa', new Error('functions/unavailable'));
    await user.click(screen.getByRole('button', { name: 'Disconnect Alexa' }));

    expect(await screen.findByText('functions/unavailable')).toBeInTheDocument();
  });
});
