# Ordertaker

A single-location food ordering application with guest checkout, secure order
tracking, and owner-managed order workflows.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- MySQL 8.0.13+ on the same host as the API

## Local setup

1. Create a database and restricted application user in MySQL:

   ```sql
   CREATE DATABASE ordertaker CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
   CREATE USER 'ordertaker'@'localhost' IDENTIFIED BY 'use-a-unique-password';
   GRANT ALL PRIVILEGES ON ordertaker.* TO 'ordertaker'@'localhost';
   ```

2. Copy `.env.example` to `.env`. Set `DATABASE_URL`, `UPLOADS_DIR`, and a
   private `OWNER_PASSWORD`. Use an absolute `UPLOADS_DIR` in production.
3. Install dependencies with `npm install`.
4. Apply the committed MySQL Drizzle migrations:

   ```powershell
   npm run db:deploy
   ```

5. Seed the owner, starter categories/products, and store settings:

   ```powershell
   npm run db:seed
   ```

   Set `OWNER_NAME`, `OWNER_EMAIL`, and a unique `OWNER_PASSWORD` of at least
   12 characters first. Seeding updates the owner password and starter
   products. Do not run it as a routine deployment.

6. Start both applications with `npm run dev`.

The backend uses local MySQL through Drizzle ORM. MySQL schema and migrations
live in `backend/src/db/schema/` and `backend/drizzle-mysql/`. The former
PostgreSQL migrations remain unused historical files under `backend/drizzle/`.
Drizzle numeric columns remain decimal strings; checkout converts money to cents.

The API stores public product and store QR images under
`UPLOADS_DIR/public/`. It serves those files from `/api/uploads/`. Payment
proofs stay under `UPLOADS_DIR/private/payment-proofs/` and are served only
through the authenticated owner endpoint. Back up `UPLOADS_DIR` with MySQL.
Do not expose the private directory through a web server or static-file mount.

The local Vite storefront runs at <http://localhost:5173>; the public menu is at
`/` and the guest cart and checkout are at `/checkout`. The owner dashboard is
at `/admin`. The API health check is available at
<http://localhost:3000/api/health>. The owner dashboard supports category and
product management, including availability, archive/restore, and product image
uploads. The API validates image signatures and limits images to 5 MB.

Admin sessions use random opaque tokens stored as hashes in MySQL, with
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
PNG, or WebP payment-receipt image (up to 5 MB). Receipt files are stored
privately and served only through the authenticated owner endpoint. The owner
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
served locally and shown during checkout. Unpaid QR orders cannot enter the
kitchen; COD orders can proceed while unpaid.

The API also serves authenticated Socket.IO connections at
`/api/admin/socket.io`. Owner connections require a valid admin session cookie;
customer connections require the private tracking token and can join only that
order's room. New orders, order/payment status changes, and persisted messages
are broadcast to the authorized rooms. REST remains the source of truth:
clients refetch on socket reconnect and periodically poll while the connection
is unavailable.

`npm test` requires a disposable MySQL database whose name ends in `_test`.
Tests drop all tables from that database before each test. Set
`TEST_DATABASE_URL` to that database; never point it at production. The suite
covers checkout, idempotency, authorization, payment review, status
transitions, local file visibility, and Socket.IO authentication.

Create a separate test database and grant test access before running tests:

```sql
CREATE DATABASE ordertaker_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
GRANT ALL PRIVILEGES ON ordertaker_test.* TO 'ordertaker'@'localhost';
```

Set `TEST_DATABASE_URL` to its connection URI:

```powershell
$env:TEST_DATABASE_URL = "mysql://ordertaker:change-me@127.0.0.1:3306/ordertaker_test"
npm test
```

Tests drop all tables in that database before each test.

`npm run build`, `npm run lint`, and `npm run format:check` provide additional
local quality checks.

## Production setup

Run the API and MySQL on one server or VM with persistent storage. Do not use
ephemeral filesystems for MySQL data or `UPLOADS_DIR`.

1. Install and secure MySQL. Create a production database and a dedicated
   application user with privileges only on that database.
2. Configure service environment variables. Set `NODE_ENV=production`,
   `DATABASE_URL` to the local MySQL URI, `UPLOADS_DIR` to a backed-up
   persistent directory, `FRONTEND_ORIGIN` to the site's HTTPS origin, and
   `OWNER_NAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD`. If the API uses a separate
   public origin, set `API_PUBLIC_ORIGIN` to its HTTPS origin.
3. Build from the repository root with `npm ci --include=dev` and
   `npm run build`.
4. Run `npm run db:deploy -w @ordertaker/backend` on a new, empty database.
   The deploy script rejects non-empty schemas without Drizzle history. Seed
   only a new database with `npm run db:seed -w @ordertaker/backend`.
5. Start with `npm run start -w @ordertaker/backend`. Put the service behind
   HTTPS and allow WebSocket upgrades. Run one API instance because Socket.IO
   rooms use in-process state.
6. Verify `/api/health`, guest checkout, owner login, payment-proof review,
   product and QR image delivery, and WebSocket upgrades.

The old Supabase/PostgreSQL database and Storage objects are not modified or
copied by this code change. Keep them intact during cutover. Back them up, move
all database rows and image files to MySQL and `UPLOADS_DIR`, then compare row
counts, order/payment histories, and every stored image path before switching
traffic. Map product and QR image paths to
`{API_PUBLIC_ORIGIN}/api/uploads/products/{filename}` and
`{API_PUBLIC_ORIGIN}/api/uploads/store/{filename}`. Keep payment proof paths in
`payment-proofs/{filename}`. Do not retire the old services until the new
database, uploads, and restore procedure pass verification.

MySQL commits DDL outside normal transactions. If a migration fails, inspect
schema and migration history before retrying.

Freeze writes to the old app during transfer and verification. Do not run both
app versions against different databases. After accepting orders on MySQL,
rollback requires reconciling those new writes; switching back to PostgreSQL
alone would lose them.

Back up MySQL and the complete `UPLOADS_DIR` together. Test restoring both
before accepting orders. The repository does not schedule backups.

## Owner handover

Before opening the store, sign in at `/admin` and verify the store QR image and
payment instructions, pickup address/instructions, delivery fee, product
availability, and a full test order. The application has no password-change
screen, so establish an approved account/password rotation procedure before
handover. Remove test orders and disable or rotate temporary credentials
before accepting customer orders.

Complete a manual responsive/browser acceptance pass at narrow phone, tablet,
and desktop widths. Check empty menu/cart/order states, loading indicators,
validation and API errors, offline/reconnect behavior, guest checkout,
tracking, owner payment review, and mobile order-status controls. Verify
production HTTPS cookies, WebSocket upgrade, MySQL migrations, private
payment-proof authorization, and database/upload restore before handover.
