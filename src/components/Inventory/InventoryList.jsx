// src/components/Inventory/InventoryList.jsx
// Main inventory display: location tabs, search bar, expiration filter,
// and a responsive card grid. Delegates item add/edit/delete to parent.

import React, { useState, useMemo } from 'react';
import { Row, Col, Form, Nav, Spinner, Alert, Button, Badge, InputGroup } from 'react-bootstrap';
import { Search, Plus, Package, X } from 'lucide-react';
import ItemCard from './ItemCard';

const ALL_TAB = '__all__';

const EXPIRY_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'expired', label: '🔴 Expired' },
  { value: 'critical', label: '🟠 ≤ 2 days' },
  { value: 'warning', label: '🟡 ≤ 5 days' },
  { value: 'safe', label: '🟢 Fresh' },
];

/**
 * InventoryList
 *
 * @param {array}    items       - All inventory items from useInventory
 * @param {array}    locations   - All storage locations from useStorageLocations
 * @param {boolean}  loading     - True while data is loading
 * @param {function} onAdd       - () => void — opens AddItemModal
 * @param {function} onEdit      - (item) => void
 * @param {function} onDelete    - (item) => void
 */
const InventoryList = ({ items = [], locations = [], loading, onAdd, onEdit, onDelete }) => {
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const [search, setSearch] = useState('');
  const [expiryFilter, setExpiryFilter] = useState('all');

  // ---------------------------------------------------------------------------
  // Build location lookup map for ItemCard
  // ---------------------------------------------------------------------------
  const locationMap = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l])),
    [locations]
  );

  // ---------------------------------------------------------------------------
  // Count items per location (for tab badges)
  // ---------------------------------------------------------------------------
  const countsByLocation = useMemo(() => {
    const counts = { [ALL_TAB]: items.length };
    for (const item of items) {
      counts[item.locationId] = (counts[item.locationId] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  // ---------------------------------------------------------------------------
  // Filtered items
  // ---------------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    let result = items;

    // Location tab filter
    if (activeTab !== ALL_TAB) {
      result = result.filter((i) => i.locationId === activeTab);
    }

    // Text search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (i) =>
          i.name?.toLowerCase().includes(q) ||
          i.notes?.toLowerCase().includes(q) ||
          locationMap[i.locationId]?.label?.toLowerCase().includes(q)
      );
    }

    // Expiry filter
    if (expiryFilter !== 'all') {
      result = result.filter((i) => {
        if (!i.expiresAt) return expiryFilter === 'safe';
        const exp = i.expiresAt?.toDate ? i.expiresAt.toDate() : new Date(i.expiresAt);
        const days = Math.ceil((exp - new Date()) / (1000 * 60 * 60 * 24));
        if (expiryFilter === 'expired') return days < 0;
        if (expiryFilter === 'critical') return days >= 0 && days <= 2;
        if (expiryFilter === 'warning') return days >= 0 && days <= 5;
        if (expiryFilter === 'safe') return days > 5;
        return true;
      });
    }

    // Sort: expired first, then by expiresAt ascending
    result = [...result].sort((a, b) => {
      const toMs = (ts) => {
        if (!ts) return Infinity;
        return (ts?.toDate ? ts.toDate() : new Date(ts)).getTime();
      };
      return toMs(a.expiresAt) - toMs(b.expiresAt);
    });

    return result;
  }, [items, activeTab, search, expiryFilter, locationMap]);

  // ---------------------------------------------------------------------------
  // Render: loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5 text-muted gap-2">
        <Spinner size="sm" /> Loading inventory…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="inventory-list">
      {/* ── Page header ── */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-0">Inventory</h1>
          <small className="text-muted">
            {items.length} item{items.length !== 1 ? 's' : ''} across {locations.length} location
            {locations.length !== 1 ? 's' : ''}
          </small>
        </div>
        <Button variant="primary" className="d-flex align-items-center gap-2" onClick={onAdd}>
          <Plus size={18} />
          Add Item
        </Button>
      </div>

      {/* ── No locations warning ── */}
      {locations.length === 0 && (
        <Alert variant="warning" className="mb-3">
          You have no storage locations yet. Go to <strong>Settings</strong> to add a location
          before adding items.
        </Alert>
      )}

      {/* ── Location tabs ── */}
      {locations.length > 0 && (
        <Nav
          variant="tabs"
          className="mb-3 flex-nowrap overflow-auto"
          style={{ borderBottom: '2px solid var(--mkh-border-light)' }}
        >
          <Nav.Item>
            <Nav.Link
              eventKey={ALL_TAB}
              active={activeTab === ALL_TAB}
              onClick={() => setActiveTab(ALL_TAB)}
              className="d-flex align-items-center gap-2"
            >
              All
              <Badge bg="secondary" style={{ borderRadius: 'var(--mkh-radius-full)' }}>
                {countsByLocation[ALL_TAB] ?? 0}
              </Badge>
            </Nav.Link>
          </Nav.Item>

          {locations.map((loc) => (
            <Nav.Item key={loc.id}>
              <Nav.Link
                active={activeTab === loc.id}
                onClick={() => setActiveTab(loc.id)}
                className="d-flex align-items-center gap-2 text-nowrap"
              >
                <span>{loc.icon}</span>
                {loc.label}
                <Badge bg="secondary" style={{ borderRadius: 'var(--mkh-radius-full)' }}>
                  {countsByLocation[loc.id] ?? 0}
                </Badge>
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
      )}

      {/* ── Search + Expiry filter bar ── */}
      <Row className="mb-3 g-2 align-items-center">
        <Col xs={12} sm={7} md={8}>
          <InputGroup>
            <InputGroup.Text
              style={{ background: 'var(--mkh-bg-card)', border: '1px solid var(--mkh-border)' }}
            >
              <Search size={16} className="text-muted" />
            </InputGroup.Text>
            <Form.Control
              type="text"
              placeholder="Search items…"
              aria-label="Search items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: '1px solid var(--mkh-border)', borderLeft: 'none' }}
            />
            {search && (
              <Button
                variant="light"
                onClick={() => setSearch('')}
                style={{ border: '1px solid var(--mkh-border)', borderLeft: 'none' }}
              >
                <X size={14} />
              </Button>
            )}
          </InputGroup>
        </Col>

        <Col xs={12} sm={5} md={4}>
          <Form.Select
            aria-label="Filter by expiry"
            value={expiryFilter}
            onChange={(e) => setExpiryFilter(e.target.value)}
            style={{ border: '1px solid var(--mkh-border)' }}
          >
            {EXPIRY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {/* ── Active filter chips ── */}
      {(search || expiryFilter !== 'all') && (
        <div className="d-flex gap-2 flex-wrap mb-3">
          {search && (
            <Badge
              bg="light"
              text="dark"
              className="d-flex align-items-center gap-1 px-2 py-1"
              style={{
                border: '1px solid var(--mkh-border)',
                borderRadius: 'var(--mkh-radius-full)',
                cursor: 'pointer',
              }}
              onClick={() => setSearch('')}
            >
              "{search}" <X size={10} />
            </Badge>
          )}
          {expiryFilter !== 'all' && (
            <Badge
              bg="light"
              text="dark"
              className="d-flex align-items-center gap-1 px-2 py-1"
              style={{
                border: '1px solid var(--mkh-border)',
                borderRadius: 'var(--mkh-radius-full)',
                cursor: 'pointer',
              }}
              onClick={() => setExpiryFilter('all')}
            >
              {EXPIRY_FILTERS.find((f) => f.value === expiryFilter)?.label} <X size={10} />
            </Badge>
          )}
        </div>
      )}

      {/* ── Results summary ── */}
      {filteredItems.length !== items.length && (
        <p className="text-muted mb-2" style={{ fontSize: 'var(--mkh-font-size-small)' }}>
          Showing {filteredItems.length} of {items.length} items
        </p>
      )}

      {/* ── Empty state ── */}
      {items.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <Package size={56} className="mb-3 opacity-50" />
          <h5>Your inventory is empty</h5>
          <p className="mb-3">Add your first item to get started.</p>
          <Button variant="primary" onClick={onAdd}>
            <Plus size={16} className="me-1" /> Add Item
          </Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <Search size={48} className="mb-3 opacity-50" />
          <h6>No items match your filters</h6>
          <Button
            variant="link"
            onClick={() => {
              setSearch('');
              setExpiryFilter('all');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        /* ── Item grid ── */
        <Row xs={1} sm={2} md={3} lg={4} className="g-3">
          {filteredItems.map((item) => (
            <Col key={item.id}>
              <ItemCard
                item={item}
                location={locationMap[item.locationId]}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default InventoryList;
