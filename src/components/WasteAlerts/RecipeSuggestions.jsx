// src/components/WasteAlerts/RecipeSuggestions.jsx
// "Cook this and three things stop being a problem" — roadmap 6.3.
//
// Recipes are ranked by how many expiring items they use. The button writes a
// meal-plan entry and links out to the meal plan; the meal-plan page itself is
// Phase 7's.

import React, { useState } from 'react';
import { Alert, Badge, Button, Card, ListGroup, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChefHat } from 'lucide-react';

/**
 * RecipeSuggestions
 *
 * @param {Array}    suggestions   - [{ recipe, title, usesItems, matchCount }]
 * @param {boolean}  loading
 * @param {function} onAddToMealPlan - async (match) => { success, error }
 */
const RecipeSuggestions = ({ suggestions = [], loading = false, onAddToMealPlan }) => {
  const [busyId, setBusyId] = useState(null);
  const [added, setAdded] = useState([]);
  const [error, setError] = useState('');

  const handleAdd = async (match) => {
    setBusyId(match.recipe.id);
    setError('');
    const result = await onAddToMealPlan?.(match);
    setBusyId(null);

    if (result?.success) {
      setAdded((prev) => [...prev, match.recipe.id]);
    } else {
      setError(result?.error || 'Could not add that to your meal plan. Please try again.');
    }
  };

  return (
    <Card data-testid="recipe-suggestions">
      <Card.Header className="bg-transparent d-flex align-items-center gap-2">
        <ChefHat size={18} className="text-secondary" />
        <h5 className="mb-0">Cook it before it goes</h5>
      </Card.Header>
      <Card.Body className="p-0">
        {error && (
          <Alert variant="warning" className="m-3 mb-0 py-2">
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-4">
            <Spinner size="sm" className="me-2" />
            Finding recipes…
          </div>
        ) : suggestions.length === 0 ? (
          <div className="text-center text-muted py-4 px-3">
            <p className="mb-1">No recipes use what is expiring right now.</p>
            <Link to="/recipes">Browse the recipe library</Link>
          </div>
        ) : (
          <ListGroup variant="flush">
            {suggestions.map((match) => (
              <ListGroup.Item key={match.recipe.id} data-testid="recipe-suggestion">
                <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="fw-semibold">{match.title}</div>
                    <div className="text-muted small text-capitalize">
                      Uses {match.usesItems.map((item) => item.name).join(', ')}
                    </div>
                    <Badge bg="secondary" className="mt-1">
                      {match.matchCount} expiring item{match.matchCount === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  <Button
                    size="sm"
                    variant={added.includes(match.recipe.id) ? 'success' : 'outline-primary'}
                    className="d-flex align-items-center gap-1 flex-shrink-0"
                    disabled={busyId === match.recipe.id || added.includes(match.recipe.id)}
                    onClick={() => handleAdd(match)}
                  >
                    {busyId === match.recipe.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <CalendarPlus size={14} />
                    )}
                    {added.includes(match.recipe.id) ? 'On the plan' : 'Add to Meal Plan'}
                  </Button>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Card.Body>

      {added.length > 0 && (
        <Card.Footer className="bg-transparent">
          <Link to="/meal-plan">See your meal plan →</Link>
        </Card.Footer>
      )}
    </Card>
  );
};

export default RecipeSuggestions;
