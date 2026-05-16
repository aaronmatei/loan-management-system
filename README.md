# Loan Management System

A complete loan management system for Kenyan lending institutions.

## Features

- 👥 **Client Management** - Add and manage clients with KYC details
- 💰 **Loan Management** - Create loans with automatic payment schedules
- 💵 **Payment Tracking** - Record payments and track balances
- 📊 **Dashboard** - View key metrics and analytics
- 🔄 **Overpayment Handling** - Automatic refund tracking
- 🔍 **Search** - Find clients and loans quickly
- 🇰🇪 **Kenya-Ready** - All 47 counties, M-Pesa support

## Tech Stack

### Backend

- Node.js + Express.js
- PostgreSQL
- JWT Authentication
- bcrypt for password hashing

### Frontend

- React 18
- Vite
- Tailwind CSS
- React Router
- Axios

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Backend Setup

```bash
cd loan-tracker-backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

### Frontend Setup

```bash
cd loan-tracker-frontend
npm install
npm run dev
```

### Database Setup

```bash
# Create database
createdb loan_tracker
createuser loan_user

# Grant permissions
psql -U postgres -d loan_tracker -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO loan_user;"
psql -U postgres -d loan_tracker -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO loan_user;"

# Run migrations
psql -U loan_user -d loan_tracker -f loan-tracker-backend/migrations/init.sql
```

## Default Login

- **Email:** admin@yourcompany.com
- **Password:** (set in your database)

## License

Proprietary - All rights reserved

## Author

Built with ❤️ for Kenyan lenders
