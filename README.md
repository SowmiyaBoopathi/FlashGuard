# FlashGuard — Flash Sale System

FlashGuard is a full-stack flash-sale application designed to handle concurrent checkout requests while protecting inventory from overselling.

## Features

- Product listing and stock display
- Transaction-based checkout using MySQL
- Idempotency keys to prevent duplicate orders on retries
- Row locking and conditional stock updates
- Order and checkout-request status APIs
- Request IDs and structured error handling
- Automated backend tests and k6 load-test scripts

## Technology Stack

- Frontend: React, Vite, JavaScript
- Backend: Node.js, Express
- Database: MySQL with InnoDB
- Testing: Node.js test runner and k6

## Project Structure

- `backend/database/` — database schema
- `backend/scripts/` — load-test and cleanup scripts
- `backend/src/config/` — database configuration
- `backend/src/middleware/` — middleware and error handling
- `backend/src/routes/` — API routes
- `backend/src/services/` — checkout logic
- `backend/tests/` — automated tests
- `frontend/src/` — React application

## Prerequisites

Install Node.js, npm, and MySQL.

## Backend Setup

From the project root, run:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edit `backend/.env` with your own local MySQL credentials. Never commit this file.

Initialize the schema only in a fresh development database. Review `backend/database/init.sql` before executing it. Do not run it against a database containing data you need to preserve.

Start the backend using the start script defined in `backend/package.json`:

```powershell
npm start
```

Health endpoint:

`http://localhost:5000/api/health`

## Frontend Setup

Open a second terminal from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Vite normally serves the frontend at `http://localhost:5173`.

## Automated Tests

From the backend directory:

```powershell
npm test
```

The latest local run passed all 24 tests. Re-run tests after changes to confirm the current result.

## Load Testing

The `backend/scripts/` directory includes k6 scripts for health checks, checkout bursts, sustained requests, temporary product preparation, and cleanup.

Use temporary test products for load tests. Never use the real sale product for destructive tests.

Previous local tests with stock of 20 observed:
- 20 requests: 20 confirmed orders.
- 50 requests: 20 confirmed orders and 30 sold-out responses.
- A short sustained test: 20 confirmed orders, with the remaining requests sold out.

These local results do not establish production-scale capacity.

## API Overview

The backend includes:
- `GET /api/health`
- `/api/products`
- `/api/checkout`
- `/api/orders`
- `/api/checkout-requests`

Refer to `backend/src/routes/` for the supported methods, request bodies, and response formats.

## Checkout Safety

Checkout processing uses transactions, row locking, conditional stock updates, and idempotency keys to help prevent overselling and duplicate orders.

## Security and Deployment

Before public deployment:

- Use strong database credentials and a least-privilege database account.
- Set `NODE_ENV=production`.
- Configure `FRONTEND_URL` for the deployed frontend.
- Keep `.env` and secrets out of Git.
- Use HTTPS and secure secret management.
- Review rate limits, logging, database backups, monitoring, and connection-pool sizing.
- Validate the schema and application in a separate deployment environment.

## Project Status

Core checkout functionality, automated backend tests, and initial local load tests are implemented. Production deployment and production-scale performance validation remain outstanding.
