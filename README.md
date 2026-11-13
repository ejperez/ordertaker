# Ordertaker

A single-location food ordering application with guest checkout, secure order
tracking, and owner-managed order workflows.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- A Supabase project with PostgreSQL and Storage

## Local setup

1. Create Supabase Storage buckets named `product-images` (public) and
   `payment-proofs` (private).
2. Copy `.env.example` to `.env`. Set the Supabase project URL, service-role key,
   pooled `DATABASE_URL`, direct `DIRECT_URL`, and a private `OWNER_PASSWORD`.
   Keep the service-role key on the backend only.
3. Install dependencies with `npm install`.
4. Generate and apply Drizzle migrations:

   ```powershell
   npm run db:migrate
   ```

   `DATABASE_URL` uses Supabase's transaction pooler for runtime traffic.
   `DIRECT_URL` uses the direct database connection for migrations. Drizzle
   numeric columns remain decimal strings; checkout converts money to cents.

5. Seed the owner, starter categories/products, and store settings:

   ```powershell
   npm run db:seed
   ```

6. Start both applications with `npm run dev`.

The application uses Supabase-hosted PostgreSQL through Drizzle ORM. Product
and QR images use the public Storage bucket; payment proofs use the private bucket.
Never commit `.env` or expose the service-role key to Vite or browser code.

The storefront runs at <http://localhost:5173>; the public menu is at `/` and
the guest cart and checkout are at `/checkout`. The owner dashboard is at
`/admin`. The API health check is available at
<http://localhost:3000/api/health>. The owner dashboard supports category and
product management, including availability, archive/restore, and product image
uploads. The API validates image signatures and limits images to 5 MB before
uploading them to Supabase Storage.

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
PNG, or WebP payment-receipt image (up to 5 MB). Receipt files are stored in the
private Supabase bucket and served only through the authenticated owner endpoint.
The owner
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
served from the public Supabase bucket and shown during checkout.
Unpaid QR orders cannot enter the kitchen; COD orders can proceed while unpaid.

The API also serves authenticated Socket.IO connections at
`/api/admin/socket.io`. Owner connections require a valid admin session cookie;
customer connections require the private tracking token and can join only that
order's room. New orders, order/payment status changes, and persisted messages
are broadcast to the authorized rooms. The customer tracking page and owner
dashboard support order-linked messages. REST remains the source of truth:
clients refetch on socket reconnect and periodically poll while the connection
is unavailable.

`npm test` runs backend integration tests against PGlite; it does not require a
running PostgreSQL server. The suite covers delivery/COD and pickup/QR checkout,
idempotency, unavailable products, message isolation, admin authorization,
payment review and COD collection, fulfillment status transitions, private
receipt access, storage visibility, and owner/customer Socket.IO authentication.
`npm run build`, `npm run lint`, and `npm run format:check` provide additional
local quality checks.

The seed command requires `OWNER_NAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD` in
`.env`. No owner credentials are committed to the project. Seed data can be run
repeatedly without duplicating records; on an existing production database, be
aware that seeding updates the owner password and starter products.

## Production deployment

### Supabase setup

1. Create a Supabase project and create public `product-images` and private
   `payment-proofs` Storage buckets.
2. Copy the project URL and service-role key into the Render backend
   environment. Never add the service-role key to frontend variables.
3. Set `DATABASE_URL` to Supabase's transaction-pooler URI, normally port 6543.
   Set `DIRECT_URL` to the direct PostgreSQL URI for Drizzle migrations. If the
   direct database host is unreachable from Render, use Supabase's session
   pooler URI on port 5432 for `DIRECT_URL`.
4. URL-encode special characters in the database password. Keep both database
   URLs and storage credentials in Render's secret environment settings.

### Render deployment

1. Create a Render Blueprint from this repository and apply `render.yaml`.
   Render builds the Fastify API as a Web Service and React/Vite as a Static
   Site. The API build compiles TypeScript and committed Drizzle schema files.
2. Set `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `FRONTEND_ORIGIN` on the backend service.
   Set `VITE_API_URL` on the static site to the API's HTTPS URL.
3. Set `FRONTEND_ORIGIN` to the static site's exact HTTPS origin. Save and
   redeploy both services after setting their URLs.
4. Render runs `db:deploy` before starting the API. On a new database, this
   applies committed Drizzle SQL. On an existing complete database, the deploy
   script records a baseline instead of replaying initial table creation. It
   refuses partial schemas for manual review. Historical SQL migrations remain
   archived under `backend/drizzle/legacy-sql/` and are not replayed. Run
   `npm run db:seed -w @ordertaker/backend` once from the backend service shell
   for a new database, after setting `OWNER_NAME`, `OWNER_EMAIL`, and a unique
   `OWNER_PASSWORD` of at least 12 characters. Do not run seed as routine
   deployment; it updates owner and starter-product data.
5. Confirm `/api/health`, guest checkout, owner login, payment-proof review,
   and WebSocket upgrades at `/api/admin/socket.io`.

Render terminates HTTPS and supports WebSocket upgrades on the same API
service. Keep one backend instance because Socket.IO rooms use in-process
state. CORS and Socket.IO accept only `FRONTEND_ORIGIN`; production admin
cookies use `Secure`.

The Render Blueprint uses `npm ci --include=dev` and
`npm run build -w @ordertaker/backend` for the API.
It starts the API with `npm run db:deploy -w @ordertaker/backend` followed by
`npm run start -w @ordertaker/backend`. The frontend runs
`npm run build -w @ordertaker/frontend` and publishes `frontend/dist`; its
rewrite route supports React Router paths.

Before moving an existing local installation, back up PostgreSQL and local
uploads. Restore the database into Supabase, upload product and QR images to
the public bucket, upload payment proofs to the private bucket, and update
stored image URLs/object paths to the new Supabase locations. Verify this data
before switching production traffic. Configure and test Supabase database and
Storage backups separately; this repository does not schedule backups.

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
completion, private payment-proof authorization, and database/Storage restore
before handover. These provider-specific deployment and manual acceptance
steps remain outstanding until completed in the chosen hosting environment.
