// src/dishes/DishCard.jsx
// One dish in the recipe library: its name, how many recipes, and the one
// you'd cook (the favourite, else the most cooked).

import React from 'react';
import { Card } from 'react-bootstrap';
import { BookOpen, Star } from 'lucide-react';

const DishCard = ({ dish, onOpen }) => {
  const count = dish.recipes.length;
  const lead = dish.favorite;
  return (
    <Card
      className="h-100 shadow-sm dish-card"
      style={{
        borderRadius: 'var(--mkh-radius-lg)',
        border: '1px solid var(--mkh-border)',
        overflow: 'hidden',
      }}
    >
      {lead?.imageUrl ? (
        <Card.Img
          variant="top"
          src={lead.imageUrl}
          alt=""
          style={{ height: 140, objectFit: 'cover' }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="d-flex align-items-center justify-content-center"
          style={{ height: 80, background: 'var(--mkh-bg-hover)', color: 'var(--mkh-text-muted)' }}
        >
          <BookOpen size={28} />
        </div>
      )}
      <Card.Body className="d-flex flex-column">
        <Card.Title as="div" className="mb-1">
          <button
            type="button"
            className="stretched-link btn btn-link p-0 text-start text-reset text-decoration-none fw-semibold"
            onClick={() => onOpen(dish)}
          >
            {dish.name}
          </button>
        </Card.Title>
        <div className="text-muted" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
          {count === 1 ? '1 recipe' : `${count} recipes`}
        </div>
        {count > 1 && lead && (dish.favoriteId || lead.name !== dish.name) && (
          <div
            className="mt-auto pt-2 d-flex align-items-center gap-1"
            style={{ fontSize: 'var(--mkh-font-size-small)' }}
          >
            {dish.favoriteId ? <Star size={14} aria-label="Favourite" /> : null}
            <span className="text-truncate">{lead.name}</span>
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default DishCard;
