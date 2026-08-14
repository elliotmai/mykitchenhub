// src/pages/Login.jsx
// Authentication page with Login, Signup, and Password Reset functionality
// Uses Firebase Authentication via the useAuth hook

import React, { useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { Mail, Lock, User, Eye, EyeOff, ChefHat, ArrowLeft } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import './Login.css';

/**
 * AuthMode Enum
 */
const AUTH_MODE = {
  LOGIN: 'login',
  SIGNUP: 'signup',
  RESET: 'reset',
};

/**
 * Login Page Component
 *
 * Handles user authentication with three modes:
 * - Login: Sign in with email/password
 * - Signup: Create new account
 * - Reset: Send password reset email
 */
const Login = () => {
  const [mode, setMode] = useState(AUTH_MODE.LOGIN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { login, signup, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get redirect path from location state or default to dashboard
  const from = location.state?.from?.pathname || '/dashboard';

  /**
   * Handle form submission based on current mode
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === AUTH_MODE.LOGIN) {
        const result = await login(email, password);
        if (result.success) {
          navigate(from, { replace: true });
        } else {
          setError(result.error);
        }
      } else if (mode === AUTH_MODE.SIGNUP) {
        // Validate passwords match
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        // Validate password strength
        if (password.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }

        const result = await signup(email, password, displayName);
        if (result.success) {
          navigate(from, { replace: true });
        } else {
          setError(result.error);
        }
      } else if (mode === AUTH_MODE.RESET) {
        const result = await resetPassword(email);
        if (result.success) {
          setSuccess('Password reset email sent! Check your inbox.');
          setEmail('');
        } else {
          setError(result.error);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Switch between auth modes
   */
  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
  };

  /**
   * Get page title based on mode
   */
  const getTitle = () => {
    switch (mode) {
      case AUTH_MODE.SIGNUP:
        return 'Create Account';
      case AUTH_MODE.RESET:
        return 'Reset Password';
      default:
        return 'Welcome Back';
    }
  };

  /**
   * Get subtitle based on mode
   */
  const getSubtitle = () => {
    switch (mode) {
      case AUTH_MODE.SIGNUP:
        return 'Start managing your kitchen today';
      case AUTH_MODE.RESET:
        return 'Enter your email to receive a reset link';
      default:
        return 'Sign in to your MyKitchenHub account';
    }
  };

  return (
    <div className="login-page">
      <Container>
        <Row className="justify-content-center align-items-center min-vh-100">
          <Col xs={12} sm={10} md={8} lg={6} xl={5}>
            {/* Logo and Branding */}
            <div className="login-branding text-center mb-4">
              <div className="login-logo">
                <ChefHat size={48} strokeWidth={1.5} />
              </div>
              <h1 className="login-app-name">MyKitchenHub</h1>
              <p className="login-tagline">Reduce waste. Save money. Eat better.</p>
            </div>

            {/* Auth Card */}
            <Card className="login-card">
              <Card.Body className="login-card__body">
                {/* Back button for reset mode */}
                {mode === AUTH_MODE.RESET && (
                  <button
                    type="button"
                    className="login-back-btn"
                    onClick={() => switchMode(AUTH_MODE.LOGIN)}
                  >
                    <ArrowLeft size={18} />
                    Back to Login
                  </button>
                )}

                {/* Title */}
                <div className="login-header">
                  <h2 className="login-title">{getTitle()}</h2>
                  <p className="login-subtitle">{getSubtitle()}</p>
                </div>

                {/* Alerts */}
                {error && (
                  <Alert variant="danger" className="login-alert">
                    {error}
                  </Alert>
                )}
                {success && (
                  <Alert variant="success" className="login-alert">
                    {success}
                  </Alert>
                )}

                {/* Auth Form */}
                <Form onSubmit={handleSubmit}>
                  {/* Display Name (Signup only) */}
                  {mode === AUTH_MODE.SIGNUP && (
                    <Form.Group className="login-form-group">
                      <Form.Label className="login-label">Name</Form.Label>
                      <div className="login-input-wrapper">
                        <User size={18} className="login-input-icon" />
                        <Form.Control
                          type="text"
                          placeholder="Your name"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="login-input"
                          autoComplete="name"
                        />
                      </div>
                    </Form.Group>
                  )}

                  {/* Email */}
                  <Form.Group className="login-form-group">
                    <Form.Label className="login-label">Email</Form.Label>
                    <div className="login-input-wrapper">
                      <Mail size={18} className="login-input-icon" />
                      <Form.Control
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="login-input"
                        required
                        autoComplete="email"
                      />
                    </div>
                  </Form.Group>

                  {/* Password (Login & Signup) */}
                  {mode !== AUTH_MODE.RESET && (
                    <Form.Group className="login-form-group">
                      <Form.Label className="login-label">Password</Form.Label>
                      <div className="login-input-wrapper">
                        <Lock size={18} className="login-input-icon" />
                        <Form.Control
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="login-input login-input--password"
                          required
                          autoComplete={
                            mode === AUTH_MODE.SIGNUP ? 'new-password' : 'current-password'
                          }
                        />
                        <button
                          type="button"
                          className="login-password-toggle"
                          onClick={() => setShowPassword(!showPassword)}
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </Form.Group>
                  )}

                  {/* Confirm Password (Signup only) */}
                  {mode === AUTH_MODE.SIGNUP && (
                    <Form.Group className="login-form-group">
                      <Form.Label className="login-label">Confirm Password</Form.Label>
                      <div className="login-input-wrapper">
                        <Lock size={18} className="login-input-icon" />
                        <Form.Control
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="login-input"
                          required
                          autoComplete="new-password"
                        />
                      </div>
                    </Form.Group>
                  )}

                  {/* Forgot Password Link (Login only) */}
                  {mode === AUTH_MODE.LOGIN && (
                    <div className="login-forgot">
                      <button
                        type="button"
                        className="login-link"
                        onClick={() => switchMode(AUTH_MODE.RESET)}
                      >
                        Forgot your password?
                      </button>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    variant="primary"
                    className="login-submit-btn"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        {mode === AUTH_MODE.LOGIN && 'Signing in...'}
                        {mode === AUTH_MODE.SIGNUP && 'Creating account...'}
                        {mode === AUTH_MODE.RESET && 'Sending...'}
                      </>
                    ) : (
                      <>
                        {mode === AUTH_MODE.LOGIN && 'Sign In'}
                        {mode === AUTH_MODE.SIGNUP && 'Create Account'}
                        {mode === AUTH_MODE.RESET && 'Send Reset Link'}
                      </>
                    )}
                  </Button>
                </Form>

                {/* Mode Switch Links */}
                {mode !== AUTH_MODE.RESET && (
                  <div className="login-switch">
                    {mode === AUTH_MODE.LOGIN ? (
                      <p>
                        Don't have an account?{' '}
                        <button
                          type="button"
                          className="login-link"
                          onClick={() => switchMode(AUTH_MODE.SIGNUP)}
                        >
                          Sign up
                        </button>
                      </p>
                    ) : (
                      <p>
                        Already have an account?{' '}
                        <button
                          type="button"
                          className="login-link"
                          onClick={() => switchMode(AUTH_MODE.LOGIN)}
                        >
                          Sign in
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* Footer */}
            <p className="login-footer text-center mt-4">
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </p>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default Login;
