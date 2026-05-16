import React from 'react';

function MetricCard({ title, value, color }) {
  return (
    <div
      style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        borderLeft: `4px solid ${color}`,
      }}
    >
      <h3 style={{ 
        margin: '0 0 10px 0', 
        color: '#666', 
        fontSize: '14px',
        fontWeight: 600,
        textTransform: 'uppercase',
      }}>
        {title}
      </h3>
      <p style={{ 
        margin: 0, 
        color: '#333', 
        fontSize: '24px',
        fontWeight: 700,
      }}>
        {value}
      </p>
    </div>
  );
}

export default MetricCard;