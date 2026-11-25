// src/sharing/ShareControls.jsx
// Sharing, for the household: a link anyone can open to join (copy it, or
// make a new one that stops the old), an emailed invite, and the people it's
// shared with (view only or can edit, and remove). For event partners
// (kind 'partner') or one event's guests (kind 'event').

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, InputGroup } from 'react-bootstrap';
import { Copy, Link2, Mail, X } from 'lucide-react';

import { inviteByEmail, joinUrl, setSharing, shareLink, sharingPeople } from '../backend/sharing';

const SMALL = { fontSize: 'var(--mkh-font-size-small)' };

const ShareControls = ({ kind, eventId = '', what }) => {
  const [link, setLink] = useState('');
  const [people, setPeople] = useState([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    try {
      setPeople(await sharingPeople(kind, eventId));
    } catch (err) {
      setProblem(err.message);
    }
  }, [kind, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (work, done) => {
    setProblem('');
    setNote('');
    try {
      const out = await work();
      if (done) setNote(done(out));
      await load();
    } catch (err) {
      setProblem(err.message || 'Something went wrong.');
    }
  };

  const makeLink = (reset) =>
    act(
      async () => {
        const token = await shareLink(kind, eventId, reset);
        setLink(joinUrl(token));
      },
      () => (reset ? 'New link made. The old one no longer works.' : '')
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote('Link copied.');
    } catch {
      setNote('Select the link and copy it.');
    }
  };

  return (
    <div className="d-flex flex-column gap-2" style={SMALL}>
      <span className="text-muted">
        People who open the link and sign in with a Hive account (or make one) can {what}. They
        don’t join your household.
      </span>
      {link ? (
        <InputGroup size="sm">
          <Form.Control
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="outline-secondary" onClick={copy} aria-label="Copy the link">
            <Copy size={14} />
          </Button>
          <Button variant="outline-secondary" onClick={() => makeLink(true)}>
            New link
          </Button>
        </InputGroup>
      ) : (
        <Button
          size="sm"
          variant="outline-primary"
          className="align-self-start d-flex align-items-center gap-1"
          onClick={() => makeLink(false)}
        >
          <Link2 size={14} aria-hidden="true" /> Get the invite link
        </Button>
      )}
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => inviteByEmail(kind, eventId, email),
            (addr) => {
              setEmail('');
              return `Invited ${addr}. They’re added when they sign in with that email.`;
            }
          );
        }}
      >
        <InputGroup size="sm">
          <Form.Control
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Invite by email"
          />
          <Button type="submit" variant="outline-secondary" disabled={!email.includes('@')}>
            <Mail size={14} aria-hidden="true" /> Invite
          </Button>
        </InputGroup>
      </Form>
      {people.length > 0 && (
        <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
          {people.map((p) => (
            <li key={p.user_id || p.email} className="d-flex align-items-center gap-2">
              <span className="flex-grow-1 text-truncate">
                {p.name || p.email}
                {p.pending && <span className="text-muted"> · invited</span>}
              </span>
              <Form.Select
                size="sm"
                style={{ width: 'auto' }}
                value={p.can_edit ? 'edit' : 'view'}
                onChange={(e) =>
                  act(() => setSharing(kind, eventId, p, { canEdit: e.target.value === 'edit' }))
                }
                aria-label={`What ${p.name || p.email} can do`}
              >
                <option value="edit">Can edit</option>
                <option value="view">View only</option>
              </Form.Select>
              <Button
                size="sm"
                variant="link"
                className="p-0 text-muted"
                aria-label={`Remove ${p.name || p.email}`}
                onClick={() => act(() => setSharing(kind, eventId, p, { remove: true }))}
              >
                <X size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {note && <span className="text-success">{note}</span>}
      {problem && (
        <Alert variant="warning" className="mb-0 py-1">
          {problem}
        </Alert>
      )}
    </div>
  );
};

export default ShareControls;
