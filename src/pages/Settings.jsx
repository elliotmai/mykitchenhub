// src/pages/Settings.jsx
// User settings page — now includes Storage Locations management (Step 3.1)

import React, { useState } from 'react';
import { Card, Form, Button, Row, Col, Alert, Spinner, Nav } from 'react-bootstrap';
import { User, Lock, MapPin } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import useStorageLocations from '../hooks/useStorageLocations';
import { StorageLocationsList } from '../components/StorageLocations';

// ─── Section constants ───────────────────────────────────────────────────────
const SECTIONS = {
  PROFILE:   'profile',
  PASSWORD:  'password',
  LOCATIONS: 'locations',
};

const Settings = () => {
  const { user, userProfile, updateUserProfile, updateUserPassword } = useAuth();
  const {
    locations,
    loading: locationsLoading,
    createLocation,
    updateLocation,
    deleteLocation,
  } = useStorageLocations();

  // ─── Active section ──────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState(SECTIONS.PROFILE);

  // ─── Profile form state ──────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(userProfile?.preferences?.phoneNumber || '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError,   setProfileError]   = useState('');

  // ─── Password form state ─────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]      = useState('');
  const [confirmPassword, setConfirmPassword]  = useState('');
  const [pwLoading, setPwLoading]   = useState(false);
  const [pwSuccess, setPwSuccess]   = useState('');
  const [pwError,   setPwError]     = useState('');

  // ─── Profile submit ──────────────────────────────────────────────────────
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');

    const result = await updateUserProfile({
      displayName,
      preferences: { ...userProfile?.preferences, phoneNumber },
    });

    setProfileLoading(false);
    if (result.success) setProfileSuccess('Profile updated successfully!');
    else setProfileError(result.error);
  };

  // ─── Password submit ─────────────────────────────────────────────────────
  const handlePasswordUpdate = async (e) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
    if (newPassword.length < 6)          { setPwError('Password must be at least 6 characters'); return; }

    setPwLoading(true);
    setPwError('');
    setPwSuccess('');

    const result = await updateUserPassword(currentPassword, newPassword);

    setPwLoading(false);
    if (result.success) {
      setPwSuccess('Password updated successfully!');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } else {
      setPwError(result.error);
    }
  };

  // ─── Storage location handlers ───────────────────────────────────────────
  const handleAddLocation = (data) => createLocation(data);

  const handleEditLocation = (locationId, data) => updateLocation(locationId, data);

  const handleDeleteLocation = (locationId) => deleteLocation(locationId);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="settings-page">
      <h1 className="h3 mb-4">Settings</h1>

      <Row>
        {/* Sidebar nav */}
        <Col md={3} className="mb-3 mb-md-0">
          <Card>
            <Card.Body className="p-2">
              <Nav className="flex-column">
                <Nav.Link
                  active={activeSection === SECTIONS.PROFILE}
                  onClick={() => setActiveSection(SECTIONS.PROFILE)}
                  className="d-flex align-items-center gap-2 rounded-2 px-3 py-2"
                >
                  <User size={16} /> Profile
                </Nav.Link>
                <Nav.Link
                  active={activeSection === SECTIONS.PASSWORD}
                  onClick={() => setActiveSection(SECTIONS.PASSWORD)}
                  className="d-flex align-items-center gap-2 rounded-2 px-3 py-2"
                >
                  <Lock size={16} /> Password
                </Nav.Link>
                <Nav.Link
                  active={activeSection === SECTIONS.LOCATIONS}
                  onClick={() => setActiveSection(SECTIONS.LOCATIONS)}
                  className="d-flex align-items-center gap-2 rounded-2 px-3 py-2"
                >
                  <MapPin size={16} /> Storage Locations
                  {locations.length > 0 && (
                    <span
                      className="ms-auto badge bg-secondary"
                      style={{ fontSize: '0.7rem' }}
                    >
                      {locations.length}
                    </span>
                  )}
                </Nav.Link>
              </Nav>
            </Card.Body>
          </Card>
        </Col>

        {/* Content panel */}
        <Col md={9}>

          {/* ── Profile ─────────────────────────────────────────────────── */}
          {activeSection === SECTIONS.PROFILE && (
            <Card>
              <Card.Header className="bg-white border-bottom-0 pt-4 pb-2">
                <h5 className="mb-0 d-flex align-items-center gap-2">
                  <User size={18} /> Profile
                </h5>
                <small className="text-muted">Signed in as {user?.email}</small>
              </Card.Header>
              <Card.Body>
                {profileSuccess && <Alert variant="success" className="py-2">{profileSuccess}</Alert>}
                {profileError   && <Alert variant="danger"  className="py-2">{profileError}</Alert>}

                <Form onSubmit={handleProfileUpdate}>
                  <Form.Group className="mb-3">
                    <Form.Label>Display Name</Form.Label>
                    <Form.Control
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                    />
                  </Form.Group>
                  <Form.Group className="mb-4">
                    <Form.Label>Phone Number <span className="text-muted">(for SMS alerts)</span></Form.Label>
                    <Form.Control
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                    />
                  </Form.Group>
                  <Button type="submit" variant="primary" disabled={profileLoading}>
                    {profileLoading ? <><Spinner size="sm" className="me-2" />Saving…</> : 'Save Changes'}
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          )}

          {/* ── Password ────────────────────────────────────────────────── */}
          {activeSection === SECTIONS.PASSWORD && (
            <Card>
              <Card.Header className="bg-white border-bottom-0 pt-4 pb-2">
                <h5 className="mb-0 d-flex align-items-center gap-2">
                  <Lock size={18} /> Change Password
                </h5>
              </Card.Header>
              <Card.Body>
                {pwSuccess && <Alert variant="success" className="py-2">{pwSuccess}</Alert>}
                {pwError   && <Alert variant="danger"  className="py-2">{pwError}</Alert>}

                <Form onSubmit={handlePasswordUpdate}>
                  <Form.Group className="mb-3">
                    <Form.Label>Current Password</Form.Label>
                    <Form.Control
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>New Password</Form.Label>
                    <Form.Control
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </Form.Group>
                  <Form.Group className="mb-4">
                    <Form.Label>Confirm New Password</Form.Label>
                    <Form.Control
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </Form.Group>
                  <Button type="submit" variant="primary" disabled={pwLoading}>
                    {pwLoading ? <><Spinner size="sm" className="me-2" />Updating…</> : 'Update Password'}
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          )}

          {/* ── Storage Locations ───────────────────────────────────────── */}
          {activeSection === SECTIONS.LOCATIONS && (
            <Card>
              <Card.Header className="bg-white border-bottom-0 pt-4 pb-2">
                <h5 className="mb-0 d-flex align-items-center gap-2">
                  <MapPin size={18} /> Storage Locations
                </h5>
                <small className="text-muted">
                  Manage where you store food. Default locations cannot be deleted.
                </small>
              </Card.Header>
              <Card.Body>
                <StorageLocationsList
                  locations={locations}
                  loading={locationsLoading}
                  onAdd={handleAddLocation}
                  onEdit={handleEditLocation}
                  onDelete={handleDeleteLocation}
                />
              </Card.Body>
            </Card>
          )}

        </Col>
      </Row>
    </div>
  );
};

export default Settings;
