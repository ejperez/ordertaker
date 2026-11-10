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

`npm test` runs backend route and authorization tests using mocked persistence;
it does not require a running PostgreSQL server. The suite covers delivery and
pickup checkout with COD and QR, server-side totals and delivery fees, order
status transitions and payment rules, tracking-token isolation, private receipt
access, image validation, admin routes, and Socket.IO authentication.
`npm run build`, `npm run lint`, and `npm run format:check` provide additional
local quality checks.

The seed command requires `OWNER_NAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD` in
`.env`. No owner credentials are committed to the project. Seed data can be run
repeatedly without duplicating records; on an existing production database, be
aware that seeding updates the owner password and starter products.

## Production deployment

No hosting provider is assumed by this repository. Before deploying, choose a
provider that supplies PostgreSQL and persistent application storage, and
configure the following values through its secret/environment settings:

- `NODE_ENV=production`
- `DATABASE_URL` for the production PostgreSQL database, using the provider's
  required TLS options and a least-privilege application role
- `API_HOST` and `API_PORT` for the provider's network interface
- `FRONTEND_ORIGIN=https://<public-storefront-host>` (the API rejects an
  insecure frontend origin in production)
- `VITE_API_URL=https://<public-api-host>` when building the frontend
- `OWNER_NAME`, `OWNER_EMAIL`, and a unique `OWNER_PASSWORD` of at least 12
  characters for the initial seed only

Terminate HTTPS at the platform or reverse proxy for both the storefront and
API. Configure it to forward Socket.IO/WebSocket upgrades for
`/api/admin/socket.io`, allow the exact storefront origin, and preserve
credentials/cookies. The admin cookie is marked `Secure` in production.
Run a single backend instance unless shared Socket.IO, database, and upload
storage are configured for multiple instances.

From a clean deployment checkout, install the locked dependencies, generate
the Prisma client, apply committed migrations, build, and start the backend:

```powershell
npm ci
npm run db:generate
npm run db:deploy
npm run build
npm run start -w @ordertaker/backend
```

Build the frontend with `VITE_API_URL` set to the HTTPS API URL and publish
`frontend/dist` using the selected static hosting provider. Run `npm run
db:seed` once for a new database, after setting the owner seed values; do not
run it as a routine deployment because it updates the owner password and
starter-product fields. Do not use the development-only `npm run db:migrate`
command in production.

The backend stores product/QR images under `backend/public/uploads/` and
private payment proofs under `backend/private/uploads/`. Mount persistent
storage for both directories; the private directory must not be served as
static content. Schedule encrypted, access-controlled backups of the database
and both upload directories, retain multiple restore points, and periodically
test restoring them together. For a Windows host with PostgreSQL client tools,
one manual backup sequence is:

```powershell
$backup = "C:\backups\ordertaker\$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force $backup | Out-Null
pg_dump --dbname="$env:DATABASE_URL" --format=custom --file "$backup\database.dump"
New-Item -ItemType Directory -Force "backend\private\uploads" | Out-Null
Compress-Archive -Path "backend\public\uploads","backend\private\uploads" -DestinationPath "$backup\uploads.zip"
```

Keep the backup destination outside the application tree and protect it with
the same access controls as the database credentials. To restore, stop writes,
restore the database dump with `pg_restore --no-owner --clean --if-exists`,
restore the matching upload archive to the corresponding public and private
directories, verify file permissions, and then restart the application.
Adapt the commands and scheduling to the selected host; backups are not
automatically configured by this repository.

## Owner handover and acceptance

Before opening the store, set a unique owner password before the initial seed
and sign in at `/admin`. The application has no password-change screen, so
establish an approved account/password rotation procedure before handover.
Verify the store QR image and payment instructions, pickup address/instructions,
delivery fee, product availability, and a full test order. Remove test orders
and disable or rotate any temporary credentials before accepting customer
orders.

Complete a manual responsive/browser acceptance pass at narrow phone, tablet,
and desktop widths. Check empty menu/cart/order states, loading indicators,
validation and API errors, offline/reconnect behavior, guest checkout, tracking,
owner payment review, and mobile order-status controls. Also verify the
production health endpoint, HTTPS cookies, WebSocket upgrade, migration
completion, and a database-plus-uploads restore before handover. These
provider-specific deployment and manual acceptance steps remain outstanding
until completed in the chosen hosting environment.
