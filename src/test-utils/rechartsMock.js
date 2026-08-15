// src/test-utils/rechartsMock.js
// recharts sizes itself from its parent, and jsdom reports every element as
// 0×0 — so <ResponsiveContainer> renders nothing and no mark is ever drawn.
//
// This swaps only that one component for a fixed-size box, leaving the rest of
// recharts real, so tests exercise the actual chart code rather than a stub.
//
// Usage, at the top of a chart test file:
//   jest.mock('recharts', () => require('../../../test-utils/rechartsMock')());

module.exports = () => {
  const actual = jest.requireActual('recharts');
  const React = require('react');

  const FIXED_WIDTH = 600;
  const FIXED_HEIGHT = 300;

  const ResponsiveContainer = ({ children, height }) => {
    // The real component takes width="100%"; recharts charts need numbers, so
    // the percentage is dropped rather than passed through.
    const px = typeof height === 'number' ? height : FIXED_HEIGHT;

    return React.createElement(
      'div',
      { style: { width: FIXED_WIDTH, height: px }, 'data-testid': 'responsive-container' },
      React.isValidElement(children)
        ? React.cloneElement(children, { width: FIXED_WIDTH, height: px })
        : children
    );
  };

  return { ...actual, ResponsiveContainer };
};
