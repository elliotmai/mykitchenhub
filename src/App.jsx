import React, { useState } from 'react';
import { Container, Row, Col, Card, Button, Form, Badge, Alert, Nav, Tab } from 'react-bootstrap';

// Import styles
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/index.css';

// Import common components
import {
  LoadingSpinner,
  PageLoader,
  ButtonLoader,
  CardLoader,
  ErrorBoundary,
  ConfirmModal,
  DeleteConfirmModal,
  ToastProvider,
  useToast
} from './components/Common';

// Icons
import { 
  Plus, 
  Trash2, 
  Edit, 
  Search, 
  Home, 
  ShoppingCart, 
  Calendar,
  AlertTriangle,
  Snowflake,
  Package
} from 'lucide-react';

/**
 * Design System Demo Component
 * 
 * This component demonstrates all the design system elements
 * and common components available in MyKitchenHub.
 */
const DesignSystemDemo = () => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { showSuccess, showError, showWarning, showInfo } = useToast();

  // Demo handlers
  const handleDelete = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setShowDeleteModal(false);
      showSuccess('Item deleted successfully!');
    }, 1500);
  };

  const handleConfirm = () => {
    setShowConfirmModal(false);
    showInfo('Action confirmed');
  };

  return (
    <div className="app-container">
      {/* Navigation Example */}
      <nav className="navbar navbar-expand-lg">
        <Container>
          <a className="navbar-brand" href="/">
            🍳 MyKitchenHub
          </a>
          <Nav className="ms-auto">
            <Nav.Link href="#" className="active"><Home size={18} /> Dashboard</Nav.Link>
            <Nav.Link href="#"><Package size={18} /> Inventory</Nav.Link>
            <Nav.Link href="#"><Calendar size={18} /> Meal Plan</Nav.Link>
          </Nav>
        </Container>
      </nav>

      <main className="app-main">
        <Container>
          <h1 className="mb-4">Design System Demo</h1>
          <p className="text-muted mb-5">
            Demonstrating the muted pastel theme and common components for MyKitchenHub.
          </p>

          {/* Color Palette Section */}
          <section className="mb-5">
            <h2 className="mb-4">Color Palette</h2>
            <Row className="g-3">
              {[
                { name: 'Primary', color: '#A8D5E2', textDark: true },
                { name: 'Secondary', color: '#B8D4B8', textDark: true },
                { name: 'Accent', color: '#F5C6AA', textDark: true },
                { name: 'Danger', color: '#E8B4B8', textDark: true },
                { name: 'Info', color: '#D4C5E2', textDark: true },
                { name: 'Background', color: '#FAF8F3', textDark: true },
              ].map(({ name, color, textDark }) => (
                <Col key={name} xs={6} md={4} lg={2}>
                  <div 
                    className="rounded-lg p-3 text-center"
                    style={{ 
                      backgroundColor: color,
                      color: textDark ? '#2C3E50' : '#FFFFFF'
                    }}
                  >
                    <div className="fw-semibold">{name}</div>
                    <small>{color}</small>
                  </div>
                </Col>
              ))}
            </Row>
          </section>

          {/* Typography Section */}
          <section className="mb-5">
            <h2 className="mb-4">Typography</h2>
            <Card>
              <Card.Body>
                <h1>Heading 1 (2.5rem)</h1>
                <h2>Heading 2 (2rem)</h2>
                <h3>Heading 3 (1.5rem)</h3>
                <h4>Heading 4 (1.25rem)</h4>
                <h5>Heading 5 (1.125rem)</h5>
                <h6>Heading 6 (1rem)</h6>
                <p>
                  Body text (1rem) - Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
                  Nullam euismod, nisi vel consectetur interdum.
                </p>
                <p className="text-small text-muted">
                  Small text (0.875rem) - Secondary information and labels.
                </p>
                <p className="text-tiny text-muted">
                  Tiny text (0.75rem) - Timestamps and metadata.
                </p>
              </Card.Body>
            </Card>
          </section>

          {/* Buttons Section */}
          <section className="mb-5">
            <h2 className="mb-4">Buttons</h2>
            <Card>
              <Card.Body>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <Button variant="primary"><Plus size={18} /> Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="success">Success</Button>
                  <Button variant="danger"><Trash2 size={18} /> Danger</Button>
                  <Button variant="warning">Warning</Button>
                  <Button variant="info">Info</Button>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <Button variant="outline-primary">Outline Primary</Button>
                  <Button variant="outline-secondary">Outline Secondary</Button>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Button variant="primary" disabled>
                    <ButtonLoader /> Loading...
                  </Button>
                  <Button variant="primary" size="sm">Small</Button>
                  <Button variant="primary" size="lg">Large</Button>
                </div>
              </Card.Body>
            </Card>
          </section>

          {/* Form Controls */}
          <section className="mb-5">
            <h2 className="mb-4">Form Controls</h2>
            <Card>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Item Name</Form.Label>
                      <Form.Control type="text" placeholder="Enter item name" />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Storage Location</Form.Label>
                      <Form.Select>
                        <option>Main Fridge</option>
                        <option>Garage Freezer</option>
                        <option>Pantry</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Quantity</Form.Label>
                      <Form.Control type="number" placeholder="0" />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Notes</Form.Label>
                      <Form.Control as="textarea" rows={2} placeholder="Optional notes..." />
                    </Form.Group>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </section>

          {/* Badges */}
          <section className="mb-5">
            <h2 className="mb-4">Badges</h2>
            <Card>
              <Card.Body>
                <div className="d-flex flex-wrap gap-2">
                  <Badge bg="primary">Primary</Badge>
                  <Badge bg="secondary">Secondary</Badge>
                  <Badge bg="success">Fresh</Badge>
                  <Badge bg="danger">Expired</Badge>
                  <Badge bg="warning">Expiring Soon</Badge>
                  <Badge bg="info">Info</Badge>
                </div>
              </Card.Body>
            </Card>
          </section>

          {/* Alerts */}
          <section className="mb-5">
            <h2 className="mb-4">Alerts</h2>
            <Alert variant="primary">
              <strong>Primary Alert:</strong> General information message.
            </Alert>
            <Alert variant="success">
              <strong>Success!</strong> Your item has been added to inventory.
            </Alert>
            <Alert variant="danger">
              <AlertTriangle size={18} className="me-2" />
              <strong>Warning!</strong> 3 items are expiring today.
            </Alert>
            <Alert variant="warning">
              <Snowflake size={18} className="me-2" />
              <strong>Suggestion:</strong> Consider freezing chicken breast to extend shelf life.
            </Alert>
          </section>

          {/* Inventory Item Cards Example */}
          <section className="mb-5">
            <h2 className="mb-4">Inventory Item Cards</h2>
            <Row className="g-3">
              {[
                { name: 'Chicken Breast', qty: '2 lbs', exp: 'Expires today', status: 'critical' },
                { name: 'Bell Peppers', qty: '3 count', exp: 'Expires in 3 days', status: 'warning' },
                { name: 'Frozen Peas', qty: '1 bag', exp: 'Expires in 6 months', status: 'safe' },
              ].map((item, i) => (
                <Col key={i} md={4}>
                  <Card className={`expiration-${item.status}`}>
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h5 className="mb-0">{item.name}</h5>
                        <Badge bg={item.status === 'critical' ? 'danger' : item.status === 'warning' ? 'warning' : 'success'}>
                          {item.status === 'critical' ? 'Urgent' : item.status === 'warning' ? 'Soon' : 'Fresh'}
                        </Badge>
                      </div>
                      <p className="text-muted mb-2">{item.qty}</p>
                      <small className="text-muted">{item.exp}</small>
                      <div className="mt-3 d-flex gap-2">
                        <Button variant="outline-primary" size="sm">
                          <Edit size={14} /> Edit
                        </Button>
                        <Button 
                          variant="outline-danger" 
                          size="sm"
                          onClick={() => setShowDeleteModal(true)}
                        >
                          <Trash2 size={14} /> Delete
                        </Button>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          </section>

          {/* Tabs Example */}
          <section className="mb-5">
            <h2 className="mb-4">Location Tabs</h2>
            <Card>
              <Card.Body>
                <Tab.Container defaultActiveKey="fridge">
                  <Nav variant="tabs" className="mb-3">
                    <Nav.Item>
                      <Nav.Link eventKey="fridge">🧊 Main Fridge</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                      <Nav.Link eventKey="freezer">❄️ Freezer</Nav.Link>
                    </Nav.Item>
                    <Nav.Item>
                      <Nav.Link eventKey="pantry">🏠 Pantry</Nav.Link>
                    </Nav.Item>
                  </Nav>
                  <Tab.Content>
                    <Tab.Pane eventKey="fridge">
                      <p>12 items in Main Fridge</p>
                    </Tab.Pane>
                    <Tab.Pane eventKey="freezer">
                      <p>45 items in Freezer</p>
                    </Tab.Pane>
                    <Tab.Pane eventKey="pantry">
                      <p>28 items in Pantry</p>
                    </Tab.Pane>
                  </Tab.Content>
                </Tab.Container>
              </Card.Body>
            </Card>
          </section>

          {/* Loading States */}
          <section className="mb-5">
            <h2 className="mb-4">Loading States</h2>
            <Row className="g-3">
              <Col md={4}>
                <Card>
                  <Card.Body className="text-center">
                    <LoadingSpinner size="sm" text="Small" />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4}>
                <Card>
                  <Card.Body className="text-center">
                    <LoadingSpinner size="md" text="Medium" />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4}>
                <Card>
                  <Card.Body className="text-center">
                    <LoadingSpinner size="lg" text="Large" />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            <Card className="mt-3">
              <Card.Header>Skeleton Loading</Card.Header>
              <CardLoader lines={4} />
            </Card>
          </section>

          {/* Toast Demos */}
          <section className="mb-5">
            <h2 className="mb-4">Toast Notifications</h2>
            <Card>
              <Card.Body>
                <div className="d-flex flex-wrap gap-2">
                  <Button 
                    variant="success" 
                    onClick={() => showSuccess('Item saved successfully!', 'Success')}
                  >
                    Show Success
                  </Button>
                  <Button 
                    variant="danger" 
                    onClick={() => showError('Failed to save item. Please try again.', 'Error')}
                  >
                    Show Error
                  </Button>
                  <Button 
                    variant="warning" 
                    onClick={() => showWarning('3 items expiring tomorrow!', 'Warning')}
                  >
                    Show Warning
                  </Button>
                  <Button 
                    variant="info" 
                    onClick={() => showInfo('New HelloFresh recipes available', 'Info')}
                  >
                    Show Info
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </section>

          {/* Modal Demos */}
          <section className="mb-5">
            <h2 className="mb-4">Modals</h2>
            <Card>
              <Card.Body>
                <div className="d-flex flex-wrap gap-2">
                  <Button 
                    variant="danger" 
                    onClick={() => setShowDeleteModal(true)}
                  >
                    <Trash2 size={18} /> Delete Item Modal
                  </Button>
                  <Button 
                    variant="primary" 
                    onClick={() => setShowConfirmModal(true)}
                  >
                    Confirm Action Modal
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </section>

        </Container>
      </main>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        itemName="Chicken Breast"
        loading={isLoading}
      />

      {/* General Confirm Modal */}
      <ConfirmModal
        show={showConfirmModal}
        onHide={() => setShowConfirmModal(false)}
        onConfirm={handleConfirm}
        title="Confirm Action"
        message="Are you sure you want to freeze all expiring items? They will be moved to the freezer."
        confirmText="Yes, Freeze All"
        cancelText="Cancel"
        variant="info"
      />
    </div>
  );
};

/**
 * App Component
 * 
 * Root component wrapped with necessary providers.
 */
const App = () => {
  return (
    <ErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
      <ToastProvider position="top-end">
        <DesignSystemDemo />
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
