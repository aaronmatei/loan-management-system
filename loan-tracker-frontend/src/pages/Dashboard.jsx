import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

function Dashboard() {
  const { user } = useAuth();
  const [metrics] = useState({
    total_active_loans: 0,
    total_loans_amount: 0,
    total_amount_paid: 0,
    outstanding_balance: 0,
    total_overdue_accounts: 0,
    collection_rate: 0,
  });

  const cards = [
    { title: 'Active Loans', value: metrics.total_active_loans, color: 'from-blue-500 to-blue-600' },
    { title: 'Total Portfolio', value: `KES ${metrics.total_loans_amount.toLocaleString()}`, color: 'from-purple-500 to-purple-600' },
    { title: 'Amount Collected', value: `KES ${metrics.total_amount_paid.toLocaleString()}`, color: 'from-pink-500 to-pink-600' },
    { title: 'Outstanding', value: `KES ${metrics.outstanding_balance.toLocaleString()}`, color: 'from-cyan-500 to-cyan-600' },
    { title: 'Overdue Accounts', value: metrics.total_overdue_accounts, color: 'from-red-500 to-red-600' },
    { title: 'Collection Rate', value: `${metrics.collection_rate}%`, color: 'from-green-500 to-green-600' },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Welcome back, <span className="font-semibold">{user?.first_name}</span>! 👋
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {cards.map((card, index) => (
          <div
            key={index}
            className="bg-white rounded-xl shadow-md hover:shadow-xl transition p-6 border-l-4 border-indigo-500"
          >
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {card.title}
            </h3>
            <p className="text-3xl font-bold text-gray-800">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Welcome Message */}
      <div className="bg-white rounded-xl shadow-md p-8">
        <h3 className="text-xl font-bold text-gray-800 mb-4">
          🎉 Successfully Logged In!
        </h3>
        <p className="text-gray-600 mb-4">
          Welcome to the Loan Management System.
        </p>
        <ul className="space-y-2 text-gray-700">
          <li className="flex items-center gap-2">
            <span className="text-green-500">✅</span> Backend connected
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-500">✅</span> Database working
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-500">✅</span> Authentication functional
          </li>
          <li className="flex items-center gap-2">
            <span className="text-yellow-500">⏳</span> Add clients & loans to see real data
          </li>
        </ul>
      </div>
    </div>
  );
}

export default Dashboard;