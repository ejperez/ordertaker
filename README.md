# Ordertaker

A single-location food ordering application with guest checkout, secure order
tracking, and owner-managed order workflows.

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

The storefront runs at <http://localhost:5173>; the public menu is at `/` and
the guest cart and checkout are at `/checkout`. The owner dashboard is at
`/admin`. The API health check is available at
<http://localhost:3000/api/health>. The owner dashboard supports category and
product management, including availability, archive/restore, and product image
uploads. Product image files are stored under
`backend/public/uploads/products/`; the API validates the decoded file signature
and limits images to 5 MB. Fastify Static serves files from
`backend/public/uploads/` at `/uploads/`.

Admin sessions use random opaque tokens stored as hashes in the database, with
12-hour expiry. The HTTP-only cookie is `SameSite=Lax`, uses `Secure` in
production, and admin write requests must originate from `FRONTEND_ORIGIN`.
Login is limited to five attempts per client IP per 15-minute window.
Guest orders are created at `POST /api/orders`; prices and delivery fees are
recalculated from the database, and product availability is rechecked in a
serializable transaction. Orders, items, payment records, and initial status
history are committed together. Checkout uses a UUID `Idempotency-Key`; the
database stores only its hash, and duplicate requests do not create another
order. The tracking token is random and only its hash is stored.
QR checkout accepts an optional payment reference number and requires a JPEG,
PNG, or WebP payment-receipt image (up to 5 MB). Receipt files are stored under
`backend/private/uploads/payment-proofs/`, outside the public static-file
directory, and served only through an authenticated owner endpoint. The owner
can review and approve/reject QR payments or mark COD orders as collected; each
payment status change records its actor, timestamp, and note. Customers can see
payment status and rejection reasons through their secure tracking link and
resubmit a rejected QR payment with an updated reference and receipt.

Customers can track an order at the one-time `/track/:token` URL returned after
checkout. The API stores only a hash of the tracking token and returns order
status history, fulfillment details, and an itemized total to its bearer. The
owner dashboard at `/admin` includes a filterable order board with validated
drag-and-drop and mobile status controls; each status update is recorded in
order history. The QR payment tab lets the owner upload, replace, or remove the
store payment QR image and configure customer instructions. The QR image is
served from the public `/uploads/` static-file mount and shown during checkout.
Unpaid QR orders cannot enter the kitchen; COD orders can proceed while unpaid.

The API also serves authenticated Socket.IO connections at
`/api/admin/socket.io`. Owner connections require a valid admin session cookie;
customer connections require the private tracking token and can join only that
order's room. New orders, order/payment status changes, and persisted messages
are broadcast to the authorized rooms. The customer tracking page and owner
dashboard support order-linked messages. REST remains the source of truth:
clients refetch on socket reconnect and periodically poll while the connection
is unavailable.

`npm run build`, `npm run lint`, and `npm run format:check` provide local
quality checks.

The seed command requires `OWNER_NAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD` in
`.env`. No owner credentials are committed to the project. Seed data can be run
repeatedly without duplicating records.
