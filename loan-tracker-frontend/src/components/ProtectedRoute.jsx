import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function ProtectedRoute({ element, allowedRoles = [] }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Platform admins are confined to /admin/* — bounce them out of
  // any tenant-staff route they land on (typed URL, stale bookmark,
  // etc.). The backend tenant routes still bypass-scope for them via
  // is_platform_admin, but UX-wise we want them in the platform UI.
  if (user.is_platform_admin) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5',
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <h1 style={{ color: '#c33' }}>Access Denied</h1>
          <p>You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  return element;
}

export default ProtectedRoute;