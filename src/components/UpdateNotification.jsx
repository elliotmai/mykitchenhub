import React from 'react';
import { Toast, ToastContainer, Button } from 'react-bootstrap';
import { RefreshCw } from 'lucide-react';

const UpdateNotification = ({ show, onUpdate, onDismiss }) => {
    return (
        <ToastContainer position="bottom-center" className="p-3">
            <Toast show={show} onClose={onDismiss} bg="primary">
                <Toast.Header closeButton={false}>
                    <RefreshCw size={18} className="me-2" />
                    <strong className="me-auto">Update Available</strong>
                </Toast.Header>
                <Toast.Body className="text-white">
                    <p className="mb-2">A new version of MyKitchenHub is available!</p>
                    <div className="d-flex gap-2">
                        <Button
                            variant="light"
                            size="sm"
                            onClick={onUpdate}
                        >
                            Update Now
                        </Button>
                        <Button
                            variant="outline-light"
                            size="sm"
                            onClick={onDismiss}
                        >
                            Later
                        </Button>
                    </div>
                </Toast.Body>
            </Toast>
        </ToastContainer>
    );
};

export default UpdateNotification;