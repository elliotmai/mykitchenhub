// src/components/Common/ChipFilter.jsx
// A row of toggleable chips that stops growing.
//
// The recipe library renders one chip per tag across the whole collection.
// That is fine at a dozen tags and unusable at eighty: the chips wrap into a
// wall that pushes the recipes off the screen, and the wall gets taller every
// time somebody adds a recipe with a new tag.
//
// So only the first few are shown, with a control that reveals the rest.
// Selected chips are always shown regardless of where they fall in the order —
// a filter you have switched on must never be hidden behind "show more".

import { useMemo, useState } from 'react';
import { Badge, Button } from 'react-bootstrap';

/** How many chips to show before folding the rest away. */
export const DEFAULT_VISIBLE_CHIPS = 12;

/**
 * @param {string[]} options            every available chip value
 * @param {string[]} selected           the ones currently on
 * @param {(value: string) => void} onToggle
 * @param {number}   [visibleCount]     how many to show collapsed
 * @param {string}   [label]            accessible name for the group
 */
export const ChipFilter = ({
  options = [],
  selected = [],
  onToggle,
  visibleCount = DEFAULT_VISIBLE_CHIPS,
  label = 'Filter by tag',
  className = '',
}) => {
  const [expanded, setExpanded] = useState(false);

  // A selected chip is always visible. Without this, switching a tag on and
  // then collapsing would leave the list filtered by something with nothing on
  // screen to say so — and no way to switch it off again.
  const shown = useMemo(() => {
    if (expanded || options.length <= visibleCount) return options;
    const head = options.slice(0, visibleCount);
    const selectedBelow = options.slice(visibleCount).filter((o) => selected.includes(o));
    return [...head, ...selectedBelow];
  }, [options, selected, expanded, visibleCount]);

  const hiddenCount = options.length - shown.length;

  if (options.length === 0) return null;

  return (
    <div className={`d-flex gap-2 flex-wrap ${className}`.trim()} role="group" aria-label={label}>
      {shown.map((option) => {
        const active = selected.includes(option);
        return (
          <Badge
            key={option}
            as="button"
            type="button"
            bg={active ? 'primary' : 'light'}
            text={active ? undefined : 'dark'}
            aria-pressed={active}
            onClick={() => onToggle(option)}
            className="border-0 px-2 py-1"
            style={{
              borderRadius: 'var(--mkh-radius-full)',
              cursor: 'pointer',
              outline: active ? 'none' : '1px solid var(--mkh-border)',
            }}
          >
            {option}
          </Badge>
        );
      })}

      {(hiddenCount > 0 || expanded) && (
        <Button
          variant="link"
          size="sm"
          className="p-0 px-1 text-decoration-none"
          aria-expanded={expanded}
          onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
        >
          {expanded ? 'Show fewer' : `+${hiddenCount} more`}
        </Button>
      )}
    </div>
  );
};

export default ChipFilter;
