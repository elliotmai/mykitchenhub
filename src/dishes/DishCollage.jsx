// src/dishes/DishCollage.jsx
// A dish's cover, worked out from its recipes' photos each time (dishCover in
// ./dishLogic.js): one fills it; two sit side by side; three are one large and
// two stacked; four or more are a 2×2 of the first four with "+N" for the
// rest. A dish with no photos gets a plain placeholder.

import React from 'react';
import { BookOpen } from 'lucide-react';

import { dishCover } from './dishLogic';

const GAP = 2;

const Tile = ({ image, style, more = 0 }) => (
  <div style={{ position: 'relative', overflow: 'hidden', minWidth: 0, minHeight: 0, ...style }}>
    <img
      src={image.url}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
    {more > 0 && (
      <span
        className="d-flex align-items-center justify-content-center fw-semibold"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          color: '#fff',
        }}
      >
        +{more}
      </span>
    )}
  </div>
);

const LAYOUTS = {
  1: { columns: '1fr', rows: '1fr', areas: ['1 / 1 / 2 / 2'] },
  2: { columns: '1fr 1fr', rows: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
  3: {
    columns: '2fr 1fr',
    rows: '1fr 1fr',
    areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'],
  },
  4: {
    columns: '1fr 1fr',
    rows: '1fr 1fr',
    areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'],
  },
};

const DishCollage = ({ dish, height = 140, radius = 0 }) => {
  const { images, more } = dishCover(dish);
  const frame = { height, borderRadius: radius, overflow: 'hidden' };
  if (!images.length) {
    return (
      <div
        aria-hidden="true"
        className="dish-collage d-flex align-items-center justify-content-center"
        style={{ ...frame, background: 'var(--mkh-bg-hover)', color: 'var(--mkh-text-muted)' }}
      >
        <BookOpen size={28} />
      </div>
    );
  }
  const layout = LAYOUTS[images.length];
  return (
    <div
      className="dish-collage"
      data-count={images.length}
      style={{
        ...frame,
        display: 'grid',
        gap: GAP,
        gridTemplateColumns: layout.columns,
        gridTemplateRows: layout.rows,
        background: 'var(--mkh-border)',
      }}
    >
      {images.map((image, i) => (
        <Tile
          key={`${image.url}-${i}`}
          image={image}
          style={{ gridArea: layout.areas[i] }}
          more={i === images.length - 1 ? more : 0}
        />
      ))}
    </div>
  );
};

export default DishCollage;
