# Neighborhood Food Ordering

Phase 1 foundation for a small, single-location food ordering application.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- PostgreSQL 16+ installed and running locally

## Local setup

1. Install PostgreSQL and make sure its service is running and accepting
   connections on `localhost:5432`.
2. Create a database and a dedicated application role. For example, connect
   with a PostgreSQL administrator account using `psql` or pgAdmin and run:

   ```sql
   CREATE ROLE food_ordering LOGIN PASSWORD 'replace-with-a-private-password';
   CREATE DATABASE food_ordering OWNER food_ordering;
   ```

3. Copy `.env.example` to `.env`. Set `DATABASE_URL` to use the password you
   chose for the PostgreSQL role, and set a private `OWNER_PASSWORD`.
4. Install dependencies with `npm install`.
5. Generate the Prisma client and apply the database migration:

   ```powershell
   npm run db:generate
   npm run db:migrate
   ```

6. Seed the owner, starter categories/products, and store settings:

   ```powershell
   npm run db:seed
   ```

7. Start both applications with `npm run dev`.

The application connects to the PostgreSQL server through `DATABASE_URL`; it
does not install, start, or manage the PostgreSQL service. Use the same
configuration for a production PostgreSQL instance and provide production
environment variables through the server's environment rather than committing
credentials.

The storefront runs at <http://localhost:5173>. Its home page checks the API at
<http://localhost:3000/api/health>. `npm run build`, `npm run lint`, and
`npm run format:check` provide local quality checks.

The seed command requires `OWNER_NAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD` in
`.env`. No owner credentials are committed to the project. Seed data can be run
repeatedly without duplicating records.
