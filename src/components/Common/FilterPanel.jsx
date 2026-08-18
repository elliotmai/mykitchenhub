// src/components/Common/FilterPanel.jsx
// A filter section that folds away.
//
// Filters are worth screen space when you are using them and a waste of it the
// rest of the time. On a phone the recipe library's four selects and its row of
// tag chips could take most of the first screen, so the recipes themselves —
// the reason the page exists — started below the fold.
//
// Collapsed, the header still reports how many filters are on. A panel that
// hides an active filter without saying so is worse than one that takes up
// room: the list looks wrong and nothing on screen explains why.

import { useState, useId } from 'react';
import { Badge, Button, Collapse } from 'react-bootstrap';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';

import './FilterPanel.css';

/** True on a viewport narrow enough that the filters are worth folding away. */
const isNarrowViewport = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 767.98px)').matches;
};

/**
 * A labelled, collapsible group of filter controls.
 *
 * @param {string}  [title]        header text
 * @param {number}  [activeCount]  how many filters are currently applied
 * @param {boolean} [defaultOpen]  force the initial state; defaults to open on
 *                                 anything wider than a phone
 * @param {React.ReactNode} children  the controls themselves
 */
export const FilterPanel = ({
  title = 'Filters',
  activeCount = 0,
  defaultOpen,
  children,
  className = '',
  ...rest
}) => {
  // Read once, on mount. Re-reading on resize would fold the panel away under
  // someone who had deliberately opened it.
  const [open, setOpen] = useState(() => defaultOpen ?? !isNarrowViewport());
  const bodyId = useId();

  return (
    <div className={`mkh-filter-panel ${className}`.trim()} {...rest}>
      <Button
        variant="light"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="mkh-filter-panel__toggle d-flex align-items-center gap-2 w-100 justify-content-between"
      >
        <span className="d-flex align-items-center gap-2">
          <SlidersHorizontal size={16} aria-hidden="true" />
          {title}
          {activeCount > 0 && (
            <Badge bg="primary" pill aria-label={`${activeCount} filters applied`}>
              {activeCount}
            </Badge>
          )}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="mkh-filter-panel__chevron"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        />
      </Button>

      <Collapse in={open}>
        <div id={bodyId}>
          <div className="pt-2">{children}</div>
        </div>
      </Collapse>
    </div>
  );
};

export default FilterPanel;
