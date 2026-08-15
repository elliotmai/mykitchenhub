// src/pages/WasteAlerts.jsx
// Waste alerts — roadmap 6.1 and 6.3.
//
// One page answering "what am I about to throw away, and what can I do about
// it tonight?": the at-risk list, the things the freezer would save, and the
// recipes that would use them up.

import React from 'react';
import { Alert, Col, Row, Spinner } from 'react-bootstrap';
import { AlertTriangle } from 'lucide-react';

import useWasteAlerts, { DEFAULT_ALERT_WINDOW_DAYS } from '../hooks/useWasteAlerts';
import useRecipeSuggestions from '../hooks/useRecipeSuggestions';
import useNotifications from '../hooks/useNotifications';
import {
  ExpirationSummary,
  ExpiringItemsList,
  FreezerSuggestions,
  NothingAtRisk,
  RecipeSuggestions,
  WasteAlertNotifications,
} from '../components/WasteAlerts';

const WasteAlerts = () => {
  const {
    loading,
    error,
    items,
    locations,
    expiringItems,
    counts,
    freezerLocation,
    freezerSuggestions,
    freezeAll,
    freezeHalf,
  } = useWasteAlerts();

  const {
    suggestions,
    loading: recipesLoading,
    error: recipesError,
    addToMealPlan,
  } = useRecipeSuggestions(expiringItems);

  const {
    notifications,
    error: notificationsError,
    markAsRead,
    dismiss,
  } = useNotifications({ type: 'waste-alert' });

  // Nothing expiring is the good outcome, and it gets said once — see
  // NothingAtRisk — rather than as three separate empty panels.
  const nothingAtRisk = !loading && counts.total === 0;

  return (
    <div className="waste-alerts-page">
      <div className="mb-4">
        <h1 className="h3 mb-1 d-flex align-items-center gap-2">
          <AlertTriangle size={24} className="text-warning" aria-hidden="true" />
          Waste Alerts
        </h1>
        <p className="text-muted mb-0">
          {counts.total === 0
            ? 'Nothing needs rescuing today.'
            : `${counts.total} item${counts.total === 1 ? '' : 's'} to use, freeze or cook soon.`}
        </p>
      </div>

      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {/*
        Both of these used to fail silently: the hooks tracked the error and
        the page never read it, so a recipe collection that would not load
        showed as "No recipes use what is expiring right now" — a wrong answer
        rather than a problem.
      */}
      {notificationsError && (
        <Alert variant="warning" className="mb-3">
          {notificationsError}. Anything expiring is still listed below.
        </Alert>
      )}

      {recipesError && (
        <Alert variant="warning" className="mb-3">
          {recipesError}. The freezer suggestions below still work.
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner role="status" aria-label="Checking your kitchen" />
          <p className="text-muted mt-2 mb-0">Checking your kitchen…</p>
        </div>
      ) : (
        <>
          <WasteAlertNotifications
            notifications={notifications}
            onMarkRead={markAsRead}
            onDismiss={dismiss}
          />

          {nothingAtRisk ? (
            <NothingAtRisk itemCount={items.length} windowDays={DEFAULT_ALERT_WINDOW_DAYS} />
          ) : (
            <>
              <ExpirationSummary counts={counts} />

              <Row className="g-4">
                <Col lg={6}>
                  <ExpiringItemsList items={expiringItems} locations={locations} />
                </Col>
                <Col lg={6}>
                  <div className="d-flex flex-column gap-4">
                    <FreezerSuggestions
                      suggestions={freezerSuggestions}
                      freezerLocation={freezerLocation}
                      onFreezeAll={freezeAll}
                      onFreezeHalf={freezeHalf}
                    />
                    <RecipeSuggestions
                      suggestions={suggestions}
                      loading={recipesLoading}
                      onAddToMealPlan={addToMealPlan}
                    />
                  </div>
                </Col>
              </Row>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default WasteAlerts;
