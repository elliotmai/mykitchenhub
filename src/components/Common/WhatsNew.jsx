import React, { useEffect, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { Sparkles } from 'lucide-react';
import { WHATS_NEW } from '../../config/whatsNew';
import './WhatsNew.css';

const STORAGE_KEY = 'mykitchenhub.whatsNewSeen';

// Compare versions like "2026.07.26" and "2026.07.26.2" numerically per segment,
// so same-day increments (.1, .2, … .10) order correctly.
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0,
      y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * WhatsNew Component
 *
 * Accumulating "What's New" popup. The next time a person opens the app after
 * one or more updates, it shows EVERY changelog entry newer than what this
 * device has already seen — combined into a single popup — then remembers the
 * latest version locally so nothing repeats until the next update.
 *
 * First visit on a device shows only the newest entry (not the whole history);
 * a returning device that missed several releases sees them all stacked
 * together.
 */
const WhatsNew = () => {
  const latest = WHATS_NEW[0];
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    if (!latest) return;
    let seen = null;
    try {
      seen = localStorage.getItem(STORAGE_KEY);
    } catch {
      seen = null;
    }
    // Versions are zero-padded YYYY.MM.DD, so string comparison orders them.
    const unseen =
      seen == null ? [latest] : WHATS_NEW.filter((e) => cmpVersion(e.version, seen) > 0);
    if (unseen.length) setEntries(unseen);
  }, [latest]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, latest.version);
    } catch {
      /* ignore storage failures */
    }
    setEntries([]);
  };

  if (!entries.length || !latest) return null;

  const stacked = entries.length > 1;

  return (
    <Modal show onHide={dismiss} centered className="whats-new-modal">
      <Modal.Header closeButton className="whats-new__header">
        <Modal.Title className="whats-new__title">
          <span className="whats-new__icon">
            <Sparkles size={22} />
          </span>
          What&apos;s new
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="whats-new__body">
        {!stacked && latest.date && <p className="whats-new__date">{latest.date}</p>}

        {entries.map((entry) => (
          <div key={entry.version} className="whats-new__entry">
            {stacked && entry.date && <p className="whats-new__entry-date">{entry.date}</p>}
            <ul className="whats-new__list">
              {entry.items.map((item, i) => (
                <li key={i} className="whats-new__item">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Modal.Body>

      <Modal.Footer className="whats-new__footer">
        <Button variant="primary" onClick={dismiss} className="whats-new__btn">
          Got it
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default WhatsNew;
