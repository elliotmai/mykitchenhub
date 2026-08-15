// src/components/WasteAlerts/NothingAtRisk.jsx
// The good outcome, said once.
//
// With nothing expiring, the page used to render three zero-count tiles beside
// three separate "nothing here" panels — "Nothing is about to go off",
// "Nothing here would keep much longer in the freezer", "No recipes use what
// is expiring right now". Four ways of saying nothing is wrong reads like a
// page that failed to load, not like a kitchen in good order.

import React from 'react';
import { Card } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { PartyPopper } from 'lucide-react';

/**
 * NothingAtRisk
 *
 * @param {number} itemCount - how much is in the kitchen, to tell "all fresh"
 *                             apart from "nothing in here yet"
 * @param {number} windowDays - the horizon the page checks
 */
const NothingAtRisk = ({ itemCount = 0, windowDays = 5 }) => (
  <Card data-testid="nothing-at-risk">
    <Card.Body className="text-center py-5">
      <PartyPopper size={48} className="text-success mb-3" aria-hidden="true" />

      {itemCount === 0 ? (
        <>
          <h2 className="h5 mb-1">Nothing to keep an eye on yet</h2>
          <p className="text-muted mb-3">
            Once there is food in your kitchen, anything close to its date shows up here.
          </p>
          <Link to="/inventory" className="btn btn-outline-primary btn-sm">
            Add something to your inventory
          </Link>
        </>
      ) : (
        <>
          <h2 className="h5 mb-1">Nothing is going to waste</h2>
          <p className="text-muted mb-3">
            All {itemCount} item{itemCount === 1 ? '' : 's'} in your kitchen{' '}
            {itemCount === 1 ? 'has' : 'have'} more than {windowDays} days left. We will tell you
            when that changes.
          </p>
          <Link to="/meal-plan" className="btn btn-outline-primary btn-sm">
            Plan the week ahead
          </Link>
        </>
      )}
    </Card.Body>
  </Card>
);

export default NothingAtRisk;
