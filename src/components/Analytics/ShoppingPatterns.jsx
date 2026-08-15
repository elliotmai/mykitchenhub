// src/components/Analytics/ShoppingPatterns.jsx
// The Analytics page's one component: headline numbers, three charts and the
// regulars table, all derived from inventory purchase history.
//
// Nothing here assumes there *is* any history. With an empty kitchen it renders
// a single explanatory panel; with items but no prices it still shows what gets
// bought most and says plainly why the money charts are blank.

import React from 'react';
import { Row, Col, Card, Alert } from 'react-bootstrap';
import { ShoppingBasket, Receipt, Store } from 'lucide-react';
import TopItemsChart from './TopItemsChart';
import SpendTrendChart from './SpendTrendChart';
import StoreChart from './StoreChart';
import FrequentItemsTable from './FrequentItemsTable';
import { formatCurrency } from './chartTheme';

/**
 * ShoppingPatterns
 *
 * @param {object} analytics - the whole return value of useShoppingAnalytics()
 */
const ShoppingPatterns = ({ analytics }) => {
  const {
    loading = false,
    error = null,
    totals,
    frequentItems = [],
    stores = [],
    monthlySpend = [],
    hasPurchaseData = false,
    hasPriceData = false,
  } = analytics ?? {};

  if (loading) {
    return (
      <Card>
        <Card.Body className="text-center py-5 text-muted">
          Working out your shopping patterns…
        </Card.Body>
      </Card>
    );
  }

  if (!hasPurchaseData) {
    return (
      <>
        {error ? <Alert variant="warning">{error}.</Alert> : null}
        <Card className="shopping-patterns__intro">
          <Card.Body className="text-center py-5">
            <ShoppingBasket size={48} className="text-muted mb-3 opacity-50" aria-hidden="true" />
            <h2 className="h5">No shopping history yet</h2>
            <p className="text-muted mb-0">
              Every item you add to your inventory is recorded as a purchase. Add a price and a
              store and this page will show what you buy most, what it costs, and where it is
              cheapest.
            </p>
          </Card.Body>
        </Card>
      </>
    );
  }

  return (
    <div className="shopping-patterns">
      {error ? <Alert variant="warning">{error}. Figures may be incomplete.</Alert> : null}

      {/* Hero figure — the one number the page leads with. */}
      <Card className="mb-4 shopping-patterns__hero">
        <Card.Body>
          <p className="shopping-patterns__hero-label">Recorded grocery spend</p>
          <p className="shopping-patterns__hero-value">{formatCurrency(totals.spend)}</p>
          <p className="shopping-patterns__hero-hint">
            across {totals.pricedPurchases} priced{' '}
            {totals.pricedPurchases === 1 ? 'purchase' : 'purchases'}
          </p>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-4">
        <Col xs={6} lg={4}>
          <Card className="h-100 shopping-stat">
            <Card.Body>
              <ShoppingBasket size={20} aria-hidden="true" className="shopping-stat__icon" />
              <span className="shopping-stat__value">{totals.purchases}</span>
              <span className="shopping-stat__label">Purchases logged</span>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={6} lg={4}>
          <Card className="h-100 shopping-stat">
            <Card.Body>
              <Receipt size={20} aria-hidden="true" className="shopping-stat__icon" />
              <span className="shopping-stat__value">{formatCurrency(totals.averagePrice)}</span>
              <span className="shopping-stat__label">Average item price</span>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="h-100 shopping-stat">
            <Card.Body>
              <Store size={20} aria-hidden="true" className="shopping-stat__icon" />
              <span className="shopping-stat__value">{totals.storesUsed}</span>
              <span className="shopping-stat__label">
                {totals.storesUsed === 1 ? 'Store shopped' : 'Stores shopped'}
              </span>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {!hasPriceData ? (
        <Alert variant="info" className="shopping-patterns__price-hint">
          Add a price when you add an item and the spending charts below start filling in.
        </Alert>
      ) : null}

      <Row className="g-4">
        <Col lg={6}>
          <TopItemsChart items={frequentItems} />
        </Col>
        <Col lg={6}>
          <SpendTrendChart months={hasPriceData ? monthlySpend : []} />
        </Col>
        <Col lg={6}>
          <StoreChart stores={stores} />
        </Col>
        <Col lg={6}>
          <FrequentItemsTable items={frequentItems} />
        </Col>
      </Row>
    </div>
  );
};

export default ShoppingPatterns;
