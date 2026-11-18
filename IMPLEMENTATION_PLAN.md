# Implementation Plan --- Ordertaker POC (Historical)

> Current setup and deployment steps live in [README.md](./README.md). The app
> now uses local MySQL through Drizzle ORM and local files on a persistent
> server or VM. Supabase, PostgreSQL, and Render guidance below describes the
> previous deployment only. Existing Supabase data and files remain untouched;
> transfer and verify them before production cutover.

## 1. Project Overview

Build a mobile-first online ordering application for a small,
single-location coffee and pasta business serving customers in a
subdivision.

The app replaces order-taking through Facebook Messenger with a simple
storefront and an owner dashboard. Customers can browse products, place
guest orders, choose delivery or pickup, pay by cash on delivery or QR
transfer, and track order progress. The owner can manage products,
orders, payments, and customer conversations.

This is a **single-business proof of concept (POC)**. Keep the
architecture modular and secure, but avoid premature complexity such as
multi-tenant support, customer accounts, microservices, or automated
payment integration in the first release.

### Primary goals

-   Make ordering straightforward on mobile.
-   Let customers check out without creating an account.
-   Support both delivery and store pickup.
-   Give the owner one place to manage products, orders, and payment
    verification.
-   Update order progress in real time.
-   Keep the codebase maintainable so features can be added later.

### Out of scope for the initial POC

-   Customer registration and login.
-   Multiple stores or merchants.
-   Automated payment-gateway integration.
-   Driver assignment, route optimization, or live driver GPS.
-   Loyalty points, coupons, and complex promotions.
-   Multi-language support.
-   Native mobile applications.

------------------------------------------------------------------------

## 2. Technology Stack

Use a TypeScript-first stack.

### Frontend

-   React
-   Vite
-   TypeScript
-   Tailwind CSS
-   React Router
-   TanStack Query for server state and cache management
-   dnd-kit for the admin Kanban board
-   Socket.IO Client for real-time notifications and updates
-   Zod for client-side form/schema validation where appropriate

### Backend

-   Node.js
-   Fastify
-   TypeScript
-   Supabase-hosted PostgreSQL
-   Drizzle ORM with the `postgres` (postgres.js) driver
-   Zod or Fastify-compatible schema validation for request validation
-   Socket.IO hosted on the same HTTP server as Fastify
-   Supabase Storage for public product/QR images and private payment proofs
-   Supabase Storage REST API only for object operations; use direct PostgreSQL
    connections for application queries, not Supabase's data API
-   Drizzle Kit for versioned SQL migrations
-   Secure HTTP-only cookie sessions for owner authentication

### Hosting and production configuration

-   One Render Web Service for Fastify, Socket.IO, and the built React/Vite
    frontend.
-   Fastify serves `frontend/dist` in production; local development keeps Vite
    on its own development server.
-   Supabase transaction-pooler URL for Render runtime connections.
-   Use `prepare: false` with postgres.js over the transaction pooler.
-   Use a direct PostgreSQL URL for Drizzle Kit migrations when supported;
    otherwise use Supabase's session pooler.
-   Backend-only Supabase service-role credentials. Never expose this key to
    Vite or browser code.
-   Environment variables for database URLs, Supabase Storage, API origin,
    frontend origin, and owner seed credentials. Do not commit credentials.
-   Keep one backend instance so Socket.IO rooms remain shared in process.

### Development and quality

-   ESLint and Prettier
-   Environment variables managed through `.env`
-   Drizzle Kit SQL migrations and seed scripts
-   Infer database row and insert types from Drizzle table definitions
-   Vitest for unit/integration tests where practical
-   Playwright for critical end-to-end flows if time allows

### Suggested repository layout

A simple monorepo is sufficient:

``` text
ordertaker/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── catalog/
│   │   │   ├── cart/
│   │   │   ├── checkout/
│   │   │   ├── tracking/
│   │   │   └── admin/
│   │   ├── lib/
│   │   └── routes/
│   └── ...
├── backend/
│   ├── drizzle/
│   │   ├── meta/
│   │   └── *.sql
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   │   ├── schema/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── catalog.ts
│   │   │   │   ├── orders.ts
│   │   │   │   ├── payments.ts
│   │   │   │   ├── messaging.ts
│   │   │   │   ├── settings.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── plugins/
│   │   │   └── database.ts
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.ts
│   └── ...
├── backend/drizzle.config.ts
├── render.yaml
├── docs/
├── .gitignore
└── README.md
```

Keep feature queries in existing route/service boundaries. Put reusable
database initialization and typed schema in `src/db/`; expose the Drizzle
instance through one Fastify database plugin. The plugin owns the postgres.js
pool lifecycle and decorates Fastify with the typed database. Add the required
Fastify type augmentation. Keep all database access in the backend. Do not
create separate services.

------------------------------------------------------------------------

## 3. User Roles and Access

### Customer

Customers do not need accounts. They can:

-   Browse the public product catalog.
-   Add products to a cart.
-   Check out as a guest.
-   Select delivery or pickup.
-   Select COD or QR payment.
-   View their order using a secure tracking link.
-   Submit payment proof for QR payments.
-   Send and receive messages associated with their order.

### Owner/admin

The owner is the only authenticated user in the initial POC. The owner
can:

-   Sign in and sign out.
-   View and manage orders.
-   Update order statuses.
-   Manage products and categories.
-   Upload product images.
-   Review and verify QR payment submissions.
-   View customer and fulfillment details.
-   Reply to order-related messages.
-   Configure basic store settings.

Protect all admin routes and actions on the backend, not only in the
frontend.

------------------------------------------------------------------------

## 4. Customer Storefront Requirements

### 4.1 Product catalog

-   Display active products grouped by category.
-   Each product should show its image, name, description, and price.
-   Clearly indicate unavailable products.
-   Prevent unavailable products from being added to the cart or
    ordered.
-   Provide a clear empty state when a category has no available
    products.
-   Optimize the layout for mobile screens.

### 4.2 Cart

-   Add products to the cart.
-   Increase or decrease item quantities.
-   Remove items.
-   Display item subtotal and order subtotal.
-   Persist the cart in browser storage so a refresh does not
    immediately clear it.
-   Revalidate product availability and current prices on the server
    during checkout.

The frontend cart is only a convenience. The backend must calculate the
authoritative prices and totals.

### 4.3 Guest checkout

Do not require customer registration or login.

Collect these common fields:

-   Customer name
-   Contact number

Show a fulfillment selector near the top of checkout:

-   Delivery
-   Pickup

#### Delivery fields

When Delivery is selected, require:

-   Block
-   Lot

Allow optional fields such as:

-   Street or phase
-   Delivery instructions or landmarks

Apply the configured delivery fee.

#### Pickup fields

When Pickup is selected:

-   Do not show or require delivery address fields.
-   Set the delivery fee to zero.
-   Show the store pickup address and pickup instructions.
-   Keep the customer name and contact number required.

The pickup location and instructions should be configurable in owner
settings, or seeded as initial store configuration for the POC.

### 4.4 Order review and submission

Before submission, show:

-   Products and quantities
-   Item subtotal
-   Fulfillment type
-   Delivery fee, if applicable
-   Total
-   Customer contact details
-   Delivery address or pickup location
-   Payment method

Prevent duplicate submissions while an order is being created. Use an
idempotency key or another reliable duplicate-submission safeguard.

After a successful order, show:

-   Order number
-   Order summary
-   Payment instructions, if QR payment was selected
-   Secure order-tracking link

Do not expose sequential order IDs as authorization credentials.

### 4.5 Order tracking

Provide a public tracking page accessible through a high-entropy,
unguessable tracking token.

Example URL shape:

``` text
/track/<secure-token>
```

The token is a credential: anyone possessing it may be able to view the
associated order. Generate it with a cryptographically secure random
generator. Store only a hash of the token in the database and compare
hashes securely on lookup.

The tracking page should show:

-   Order number
-   Items and quantities
-   Fulfillment type
-   Current order status and status timeline
-   Payment method and payment status
-   Delivery address or pickup instructions, as appropriate
-   Relevant messages

Do not return unrelated orders or expose customer information through
predictable IDs.

------------------------------------------------------------------------

## 5. Fulfillment: Delivery and Pickup

Fulfillment type is a first-class property of an order.

Use values such as:

``` text
DELIVERY
PICKUP
```

### Delivery workflow

``` text
PENDING
   |
IN_KITCHEN
   |
OUT_FOR_DELIVERY
   |
DELIVERED
```

### Pickup workflow

``` text
PENDING
   |
IN_KITCHEN
   |
READY_FOR_PICKUP
   |
PICKED_UP
```

Both workflows should support cancellation where allowed.

Enforce valid status transitions on the backend. Do not let a pickup
order move to `OUT_FOR_DELIVERY`, or a delivery order move to
`READY_FOR_PICKUP`.

### Delivery fee

-   Store the current delivery fee in store settings.
-   Calculate the fee on the backend.
-   Apply no delivery fee to pickup orders.
-   Snapshot the applied delivery fee on each order so older orders
    remain historically accurate if the store later changes its fee.

### Admin presentation

-   Show a clear Delivery or Pickup label on each order card.
-   Show the delivery address for delivery orders.
-   Show pickup details for pickup orders.
-   Allow filtering by fulfillment type.
-   Display the appropriate status actions for each fulfillment
    workflow.

### Customer notifications

-   For delivery, notify the customer when the order is out for delivery
    and when it is delivered.
-   For pickup, notify the customer when the order is ready for pickup
    and when it has been picked up.

------------------------------------------------------------------------

## 6. Payment Requirements

Support two methods initially:

### 6.1 Cash on delivery (COD)

-   Customer selects COD at checkout.
-   Order can enter the kitchen workflow while payment remains unpaid.
-   Owner can mark payment as collected.
-   Record who marked it collected and when.

### 6.2 QR payment with manual verification

-   Display the store's configured QR payment image and instructions.
-   Customer submits a payment reference number if available.
-   Allow customer to upload payment proof.
-   Set payment status to `AWAITING_VERIFICATION`.
-   Owner can view the proof and approve or reject the payment.
-   On approval, record verifier and verification timestamp.
-   On rejection, retain the reason and allow the customer to submit an
    updated payment proof and, if available, reference number through the
    secure tracking link.

Suggested payment statuses:

``` text
UNPAID
AWAITING_VERIFICATION
PAID
REJECTED
REFUNDED
```

Keep payment status separate from order status. For example, an order
can be `IN_KITCHEN` while its COD payment is still `UNPAID`.

QR orders must be approved before entering the kitchen. COD orders may
enter the kitchen while payment is unpaid. There is no owner override for
this rule.

### Future payment gateway integration

Do not implement this in the first release. Keep payment-provider logic
behind a service boundary so a provider such as PayMongo can be added
later.

When automated payments are added:

-   Verify webhook signatures.
-   Store provider event IDs with a unique constraint.
-   Process webhook events idempotently.
-   Never mark an order paid solely because the browser reports success
    or a customer uploads a screenshot.

------------------------------------------------------------------------

## 7. Owner/Admin Dashboard

### 7.1 Authentication

-   Provide an admin login page.
-   Use secure, HTTP-only, `Secure` (in production), appropriately
    `SameSite` cookies.
-   Hash passwords with a modern password-hashing algorithm such as
    Argon2id or bcrypt.
-   Add login rate limiting.
-   Protect admin API routes with backend authentication and
    authorization.
-   Provide logout and session expiration.
-   Do not store admin authentication tokens in local storage.

Seed the initial owner account through an environment-controlled seed
process. Do not commit real credentials.

### 7.2 Order Kanban board

Create columns for the relevant order statuses. A practical board can
include:

-   Pending
-   In the Kitchen
-   Out for Delivery
-   Ready for Pickup
-   Delivered / Picked Up
-   Cancelled

Use dnd-kit for drag-and-drop, but provide a status dropdown or action
buttons as a mobile-friendly alternative.

Order cards should show:

-   Order number
-   Time placed
-   Customer name and contact
-   Delivery or Pickup label
-   Item summary
-   Block/lot for delivery orders
-   Total
-   Payment method and payment status

When a status is changed:

1.  Send the change to the backend.
2.  Validate the transition against the order's fulfillment type and
    current status.
3.  Persist the status and a status-history record in a database
    transaction.
4.  Broadcast the update to authorized clients.
5.  Update or invalidate the relevant TanStack Query cache.

New orders should appear on the board in real time.

### 7.3 Product and category management

Owner can:

-   Create, edit, archive, and restore products.
-   Set product name, description, price, category, image, and
    availability.
-   Create and edit categories.
-   Toggle availability without deleting the product.
-   Preview the product image.

Do not hard-delete products referenced by historical order items.
Archive them instead.

### 7.4 Payment management

Provide a payment review area showing:

-   Related order
-   Customer
-   Amount
-   Payment method
-   Reference number
-   Uploaded proof
-   Payment status
-   Verification actions

Allow the owner to approve or reject QR submissions and mark COD as
collected.

### 7.5 Store settings

At minimum, support configuration for:

-   Store name
-   Store pickup address
-   Pickup instructions
-   Delivery fee
-   QR payment image and payment instructions
-   Store contact details

If a full settings UI is too much for the first iteration, seed these
values or read them from server-side configuration, but keep them in one
centralized place rather than scattering hard-coded values across the
application.

------------------------------------------------------------------------

## 8. Messaging

Provide simple order-linked messaging rather than a general-purpose chat
system.

-   Each conversation belongs to one order.
-   Customer access is authorized through the order's secure tracking
    token.
-   Owner access requires admin authentication.
-   Messages identify the sender as customer or owner.
-   Broadcast new messages to the other authorized participant through
    Socket.IO.
-   Persist messages in PostgreSQL; sockets are for notification, not
    permanent storage.
-   Validate message length and rate-limit message creation.
-   Do not allow a customer to access another order's conversation.

For the POC, text messages are sufficient. Attachments and read receipts
can be deferred.

------------------------------------------------------------------------

## 9. Real-Time Updates

Use Socket.IO on the same Node.js HTTP server as Fastify. Render forwards
WebSocket upgrades to the API service; use the existing Socket.IO path and
HTTPS service URL. Do not create a separate real-time service for this POC.

Real-time events should cover:

-   New order created → owner dashboard
-   Order status changed → customer tracking page and owner dashboard
-   Payment status changed → customer tracking page and owner dashboard
-   New message → other participant in the order conversation

Suggested room structure:

``` text
admin.orders
order.<internal-order-id>
```

Security requirements:

-   Authenticate owner socket connections.
-   Authorize owner access before joining admin rooms.
-   Validate the guest tracking token before allowing a socket to join
    an order room.
-   Never trust a client-supplied order ID alone as proof of access.
-   Do not broadcast private customer/order details to public rooms.

REST endpoints and Supabase PostgreSQL remain the source of truth. On socket
events, clients should update or invalidate TanStack Query data. Keep one API
instance unless a shared Socket.IO adapter is deliberately introduced. The app
must still work if a socket disconnects; clients can refetch through REST.

------------------------------------------------------------------------

## 10. Database Design

Use Supabase-hosted PostgreSQL with Drizzle ORM and the `postgres` driver.
Configure runtime connections with Supabase's transaction pooler through
`DATABASE_URL`. Initialize postgres.js with `prepare: false` and a bounded pool.
Configure Drizzle Kit with `DIRECT_URL` for migrations when direct connectivity
is supported; otherwise use Supabase's session pooler on port 5432.

Define PostgreSQL enums with `pgEnum` and tables with `pgTable` in TypeScript
under `src/db/schema/`. Define Drizzle `relations`, database foreign keys,
unique constraints, and indexes explicitly. Export row and
insert types from table definitions with `$inferSelect` and `$inferInsert`; do
not maintain parallel handwritten database interfaces.

Use these enum values:

``` text
UserRole: OWNER
FulfillmentType: DELIVERY, PICKUP
OrderStatus: PENDING, IN_KITCHEN, OUT_FOR_DELIVERY, READY_FOR_PICKUP,
             DELIVERED, PICKED_UP, CANCELLED
PaymentMethod: COD, QR
PaymentStatus: UNPAID, AWAITING_VERIFICATION, PAID, REJECTED, REFUNDED
PaymentActorType: CUSTOMER, OWNER, SYSTEM
MessageSenderType: CUSTOMER, OWNER
```

Keep schema definitions grouped by feature in `src/db/schema/`. Keep generated
SQL migrations and Drizzle Kit metadata under `backend/drizzle/`, and commit
both. Generate database types from these definitions; do not generate or ship a
separate runtime ORM client.

Use the existing domain tables: `users`, `admin_sessions`, `categories`,
`products`, `orders`, `order_items`, `payments`,
`payment_status_histories`, `order_status_histories`, `messages`, and
`store_settings`. Preserve current enum values and delete behaviors. Use
`numeric(10, 2)` for money and preserve exact arithmetic; Drizzle returns
numeric values as strings, so convert to integer cents or use decimal-safe
calculations rather than JavaScript floating-point arithmetic.

`admin_sessions` must keep a unique token hash, cascade on user deletion, and
index `(user_id, expires_at)`. Keep unique constraints on user email,
category name/slug, product slug, order number, tracking-token hash, and
idempotency-key hash. Index order status/date, fulfillment/date, payment
status/date, and child foreign keys. Keep a unique payment per order. Use
`onDelete` actions that preserve historical order items and nullable audit
actors, matching current behavior.

Configure `drizzle.config.ts` with the schema glob, `backend/drizzle` output,
PostgreSQL dialect, and migration connection URL. Use `drizzle-kit generate`
to create migrations and review generated SQL before applying it. The
`db:deploy` script applies committed migrations and safely baselines a complete
existing schema. Do not use schema push in production.

Provide backend scripts such as `db:generate` (`drizzle-kit generate`),
`db:migrate` (apply committed SQL through Drizzle's migrator), `db:deploy`
(baseline/migration entry point), and `db:seed` (the TypeScript seed command).
Root workspace scripts should forward to these backend scripts. Generate
migrations when schema changes; normal setup applies committed migrations and
does not regenerate them.

The deployment script detects an empty database and applies migrations. It
baselines a complete existing schema only after checking required tables,
enums, and product foreign key. It refuses partial schemas for manual review.
The initial migration is never replayed against a complete existing database.
Legacy SQL history is archived under `backend/drizzle/legacy-sql/`; Drizzle
does not execute those files.

### Drizzle setup and migration workflow

1. Copy `.env.example` to `.env`. Set runtime `DATABASE_URL` to Supabase's
   transaction-pooler URI, `DIRECT_URL` to its direct or session-pooler URI,
   plus the backend-only Storage credentials and bucket names.
2. Install locked dependencies with `npm ci`.
3. Apply committed SQL migrations with `npm run db:migrate`.
4. Seed the owner and initial catalog with `npm run db:seed`.
5. Start both applications with `npm run dev`.

When schema definitions change, run `npm run db:generate`, inspect the SQL
under `backend/drizzle/`, and commit the SQL and metadata together. Apply the
migration locally and in staging before production. Do not run generation as a
production build step.

The database plugin creates the runtime client with
`drizzle(postgres(DATABASE_URL, { prepare: false, max: 5 }), { schema })` and
closes the postgres.js pool when Fastify shuts down. Drizzle Kit reads
`DIRECT_URL` for migration operations. Production frontend requests use the
same origin as Fastify; local Vite development uses `VITE_API_URL`.

### ORM migration status

The backend now uses Drizzle and postgres.js for every database query.
Obsolete ORM runtime/configuration dependencies and schema assets are removed.
The old SQL migration history remains archived under
`backend/drizzle/legacy-sql/`; it is not part of the active migration journal.
Database access is centralized in the Fastify plugin, and route
transactions preserve atomic checkout and audit-history updates.

PGlite integration tests and TypeScript builds pass locally. Live Supabase
migration and Render startup validation still require provider credentials and
remain deployment steps.

Do not add `@supabase/supabase-js` for database access. Supabase Storage remains
separate from PostgreSQL and uses the existing backend-only Storage API service.

The following is a starting point, not a requirement to use these exact
column names. Add indexes, constraints, and relations as appropriate.

### `users`

Admin/owner accounts only.

``` text
id
name
email
password_hash
role
created_at
updated_at
```

### `admin_sessions`

``` text
id
token_hash
user_id
expires_at
created_at
```

Use a unique index on `token_hash`, a cascading foreign key to `users`, and an
index on `(user_id, expires_at)`.

### `categories`

``` text
id
name
slug
sort_order
is_active
created_at
updated_at
```

### `products`

``` text
id
category_id
name
slug
description
price
image_path
is_available
is_archived
created_at
updated_at
```

### `orders`

``` text
id
order_number
customer_name
customer_phone
fulfillment_type
block
lot
street
delivery_instructions
status
payment_method
subtotal
delivery_fee
total
tracking_token_hash
idempotency_key_hash   nullable
created_at
updated_at
```

Address fields may be nullable for pickup orders. Validate required
fields based on fulfillment type.

### `order_items`

``` text
id
order_id
product_id              nullable
product_name
quantity
unit_price
line_total
created_at
```

Snapshot product name and unit price at purchase time. This preserves
order history if a product is renamed, repriced, or archived.

### `payments`

``` text
id
order_id
method
status
amount
reference_number
proof_image_path
provider_reference       nullable
verified_at
verified_by              nullable
rejection_reason         nullable
created_at
updated_at
```

Enforce one payment per order. Keep the payment method/status and receipt
object key on the payment row; never persist receipt bytes.

### `payment_status_histories`

``` text
id
payment_id
old_status               nullable
new_status
actor_type
changed_by_user_id       nullable
note                     nullable
created_at
```

### `order_status_histories`

``` text
id
order_id
old_status
new_status
changed_by_user_id       nullable
note                     nullable
created_at
```

### `messages`

``` text
id
order_id
sender_type
sender_name
message
created_at
```

### `store_settings`

Use a key/value table or a typed settings model for store-wide
configuration. Avoid storing secrets in settings exposed to the public
storefront.

### Future: `payment_webhook_events`

``` text
id
provider
provider_event_id
event_type
processed_at
created_at
```

Add a unique constraint on `(provider, provider_event_id)` when gateway
integration is introduced.

### Database rules

-   Use PostgreSQL `numeric` for money and exact integer-cent or
    decimal-safe application calculations. Do not use floating-point
    types for currency calculations.
-   Use transactions for order creation and status/payment changes that
    must remain consistent.
-   Use Drizzle `db.transaction()` and pass its transaction handle into the
    feature service/repository. Create the order, order items, payment, and
    initial history records atomically. Use serializable isolation for checkout
    where product availability and totals must be revalidated together.
-   Keep each payment/order state change and its history record in the same
    transaction. Prefer schema constraints and conditional updates for
    concurrency-sensitive state transitions.
-   Use Drizzle's parameterized `sql` template for PostgreSQL-specific queries.
    Add reviewed database-specific functions or triggers through committed SQL
    migrations when application transactions are insufficient.
-   Add indexes for order number, order status, creation date, payment
    status, and relevant foreign keys.
-   Use database constraints for unique values and valid relations.
-   Store timestamps consistently, preferably in UTC, and display them
    in the store's local timezone.
-   Never store the raw tracking token; store only its hash.
-   Avoid deleting products or users in ways that break historical order
    records.

------------------------------------------------------------------------

## 11. Image and File Storage

Use Supabase Storage. Create a public `product-images` bucket for product and
store QR images, and a private `payment-proofs` bucket for customer receipts.
Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_PRODUCT_BUCKET`, and `SUPABASE_PAYMENT_PROOFS_BUCKET` on the backend.
Never expose the service-role key in frontend variables or browser code.

Implementation requirements:

-   Validate size and actual image signatures on the backend; do not trust
    browser-provided MIME types.
-   Generate unique server-side filenames.
-   Restrict product image uploads to authenticated admins.
-   Accept customer payment proofs only through tracking-token-authorized
    backend endpoints. Serve proofs only through owner-authorized endpoints.
-   Store object keys or public image URLs in PostgreSQL, not image bytes.
-   Keep payment proofs in the private bucket; never expose public URLs or
    anonymous access to proof objects.
-   Use the backend service-role credential only on the Web Service. Apply
    authorization before each proof read.
-   Clean up replaced objects safely and back up Supabase Storage separately
    from database backups.
-   Before migrating an existing installation, transfer local objects and
    update stored image URLs/object paths.

------------------------------------------------------------------------

## 12. API Outline

Use consistent JSON responses and centralized error handling. Validate
request bodies, parameters, and query strings.

### Public/customer endpoints

``` http
GET    /api/products
GET    /api/categories
GET    /api/store
POST   /api/orders
GET    /api/orders/track/:token
POST   /api/orders/track/:token/payment-proof
GET    /api/orders/track/:token/messages
POST   /api/orders/track/:token/messages
```

The tracking-token routes must validate the token before returning order
data or accepting actions.

### Admin authentication

``` http
POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/me
```

### Admin orders

``` http
GET    /api/admin/orders
GET    /api/admin/orders/:id
PATCH  /api/admin/orders/:id/status
GET    /api/admin/orders/:id/messages
POST   /api/admin/orders/:id/messages
```

Support query filters such as status, fulfillment type, payment status,
and date range.

### Admin products and categories

``` http
GET    /api/admin/products
POST   /api/admin/products
GET    /api/admin/products/:id
PUT    /api/admin/products/:id
PATCH  /api/admin/products/:id/availability
DELETE /api/admin/products/:id
GET    /api/admin/categories
POST   /api/admin/categories
PUT    /api/admin/categories/:id
```

For products, `DELETE` should archive rather than physically delete.

### Admin payments and settings

``` http
GET    /api/admin/payments
PATCH  /api/admin/payments/:id
GET    /api/admin/settings
PUT    /api/admin/settings
```

The payment update endpoint should validate permitted actions, such as
approving/rejecting a QR payment or marking COD collected.

These endpoints are a starting contract. Keep naming and response shapes
consistent as implementation proceeds.

------------------------------------------------------------------------

## 13. Security and Reliability Checklist

-   [ ] Validate all incoming data on the backend.
-   [ ] Recalculate prices, subtotals, delivery fees, and totals on the
    backend.
-   [ ] Check product availability during order creation.
-   [ ] Use secure, random tracking tokens and store only their hashes.
-   [ ] Rate-limit login, order creation, tracking-token access, and
    messaging where appropriate.
-   [ ] Use secure password hashing.
-   [ ] Use HTTP-only cookies for admin sessions.
-   [ ] Add CSRF protection appropriate to the cookie/session setup.
-   [ ] Configure CORS to allow only the expected frontend origin(s).
-   [ ] Use HTTPS in production.
-   [ ] Validate upload size and content; prevent path traversal.
-   [ ] Keep payment proofs private behind authorization.
-   [ ] Authorize every admin API route and every socket room join.
-   [ ] Enforce fulfillment-specific order status transitions.
-   [ ] Use database transactions for multi-record operations.
-   [ ] Make order creation resistant to accidental duplicate
    submissions.
-   [ ] Do not log passwords, session secrets, raw tracking tokens, or
    sensitive payment data.
-   [ ] Keep secrets and real credentials out of Git.
-   [ ] Configure and test Supabase database and Storage backups.
-   [ ] Add basic operational logging and a health-check endpoint.

------------------------------------------------------------------------

## 14. Implementation Phases

Build and test in small vertical slices. Do not ask a coding agent to
generate the entire application in one pass.

Existing storefront and owner features remain in place. Drizzle persistence
conversion is implemented; validate provider-specific deployment before
production.

### Phase 1 --- Drizzle database foundation

-   [x] Create frontend and backend projects.
-   [x] Configure TypeScript, linting, formatting, and environment
    variables.
-   [x] Add a typed Drizzle database module and Fastify plugin with pool shutdown.
-   [x] Configure pooled runtime and direct migration connection URLs.
-   [x] Define enums, tables, relations, constraints, and indexes in Drizzle
    schema files.
-   [x] Generate and commit SQL migrations with Drizzle Kit.
-   [x] Add guarded baseline behavior for complete existing schemas; preserve
    legacy SQL history.
-   [x] Port seed scripts to Drizzle.
-   [x] Set up Fastify plugins, centralized error handling, and health
    check.
-   [x] Set up React Router, Tailwind, and TanStack Query.
-   [x] Confirm frontend can call the backend locally.

**Done when:** PGlite migrations and tests pass. Live Supabase validation
remains required before production.

### Phase 1B --- Port existing persistence incrementally

The current features already exist. Preserve their behavior and port only
database access, one feature slice at a time:

-   [x] Port owner authentication and admin-session queries.
-   [x] Port category and product queries while preserving public image URLs.
-   [x] Port checkout, tracking, order-status, and history queries.
-   [x] Keep order, items, payment, and initial histories in one Drizzle
    transaction with serializable isolation.
-   [x] Port payment review, COD collection, and payment-history queries while
    keeping proof objects private.
-   [x] Port message and store-setting queries without changing Socket.IO
    authorization or event behavior.
-   [x] Add PGlite integration coverage for transactions, authorization, and
    Socket.IO database access; remove obsolete runtime ORM code.

Do not rewrite frontend features or API contracts during this ORM migration.

### Phase 2 --- Admin authentication and product management

-   [x] Implement owner login, logout, and current-session endpoint.
-   [x] Add secure cookie/session handling and login rate limiting.
-   [x] Protect admin routes on the backend.
-   [x] Implement category CRUD.
-   [x] Implement product CRUD and archive/availability behavior.
-   [x] Implement Supabase product image upload and public image serving.
-   [x] Build the admin product/category screens.
-   [x] Build the public product catalog endpoint and storefront.

**Done when:** the owner can sign in and manage products, and customers
can browse active products.

### Phase 3 --- Cart, guest checkout, and order creation

-   [x] Implement cart state and persistence.
-   [x] Build checkout with Delivery/Pickup selection.
-   [x] Conditionally display delivery address fields.
-   [x] Display pickup address and instructions for pickup orders.
-   [x] Implement COD and QR payment selection.
-   [x] Require and privately store a QR payment receipt in Supabase Storage.
-   [x] Validate checkout data on the backend.
-   [x] Recalculate product prices and delivery fee on the backend.
-   [x] Create orders, order items, and initial payment records in a
    transaction.
-   [x] Generate a secure tracking token and return the tracking URL
    once.
-   [x] Add duplicate-submission protection.

**Done when:** a guest can place both a delivery and a pickup order, and
the stored order totals and fulfillment details are correct.

### Phase 4 --- Customer tracking and admin order board

-   [x] Implement secure token-based order lookup.
-   [x] Build the customer tracking page and status timeline.
-   [x] Implement order status history.
-   [x] Implement backend transition validation for delivery and pickup
    workflows.
-   [x] Build the admin Kanban board.
-   [x] Add order detail view and filters.
-   [x] Add drag-and-drop and a mobile-friendly status control.
-   [x] Ensure order cards show the correct fulfillment and payment
    details.
-   [x] Add owner controls to upload and replace the store QR payment
    image.

**Done when:** the owner can process delivery and pickup orders through
valid workflows, and customers can view their order status securely.

### Phase 5 --- Payment verification

-   [x] Configure store QR payment instructions.
-   [x] Implement payment-proof upload with private file access.
-   [x] Implement reference-number submission.
-   [x] Build the admin payment review screen.
-   [x] Implement approve/reject actions and audit details.
-   [x] Implement COD collection marking.
-   [x] Display payment status to the customer.
-   [x] Enforce the chosen rule for when QR orders may enter the
    kitchen.

**Done when:** the owner can verify QR payments manually and record COD
collection.

### Phase 6 --- Real-time updates and messaging

-   [x] Attach Socket.IO to the Fastify HTTP server.
-   [x] Authenticate owner socket connections.
-   [x] Authorize customer order-room access using the tracking token.
-   [x] Broadcast newly created orders to the admin dashboard.
-   [x] Broadcast status and payment updates to the relevant order room.
-   [x] Persist order-linked messages.
-   [x] Implement customer and owner messaging screens.
-   [x] Broadcast new messages to the other authorized participant.
-   [x] Handle disconnect/reconnect and refetch current state through
    REST.

**Done when:** new orders, status changes, payment changes, and messages
appear without manual refresh, while REST remains functional if sockets
disconnect.

### Phase 7 --- Testing, deployment, and handover

-   [x] Test guest checkout for both fulfillment types.
-   [x] Test all valid and invalid status transitions.
-   [x] Test price and delivery-fee calculations.
-   [x] Test payment approval/rejection and COD collection.
-   [x] Test tracking-token authorization and attempts to access another
    order.
-   [x] Test upload validation and private payment-proof access.
-   [x] Test admin route and socket authorization.
-   [ ] Test mobile layouts and common error/empty/loading states.
-   [ ] Deploy the API and frontend together as one Render Web Service.
-   [ ] Configure Render environment variables, Supabase URLs/buckets, HTTPS,
    exact CORS origin, and production seed credentials.
-   [ ] Verify WebSocket upgrades and authenticated private proof access.
-   [ ] Configure database and Storage backups.
-   [ ] Build the API with `npm ci --include=dev` and
    `npm run build -w @ordertaker/backend`; Drizzle needs no generated client.
-   [ ] Apply committed migrations before server startup with
    `npm run db:migrate -w @ordertaker/backend`.
-   [x] Configure Drizzle Kit migrations to use `DIRECT_URL`; keep runtime
    connections on Supabase's pooled `DATABASE_URL`.
-   [x] Update README setup and Render migration commands for Drizzle.

**Done when:** the application is deployed, the owner can operate it,
and critical security and ordering flows have been tested.

Render and Supabase configuration files and instructions are included.
Deployment, HTTPS provisioning, backup scheduling, and the manual
mobile/browser acceptance pass remain pending until configured and verified
in the hosting accounts.

For Render, build both workspaces at the repository root with
`npm ci --include=dev && npm run build`. Start the service with
`npm run db:deploy -w @ordertaker/backend && npm run start -w @ordertaker/backend`.
Fastify serves the built `frontend/dist` and falls back to `index.html` for
React Router paths. Configure `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, bucket names, `FRONTEND_ORIGIN`, and owner seed
values only on the Web Service. Set `FRONTEND_ORIGIN` to that service's exact
HTTPS origin. Production does not need `VITE_API_URL`; never pass database or
service-role credentials to Vite.

------------------------------------------------------------------------

## 15. Testing Scenarios

Prioritize these end-to-end scenarios:

1.  Customer places a delivery order using COD.
2.  Customer places a pickup order using COD.
3.  Customer places a delivery order using QR payment and submits proof.
4.  Customer places a pickup order using QR payment and submits proof.
5.  Owner approves and rejects QR payment submissions.
6.  Owner marks COD as collected.
7.  Owner moves a delivery order through its valid statuses.
8.  Owner moves a pickup order through its valid statuses.
9.  Backend rejects pickup-only/delivery-only status mismatches.
10. Customer tracking page updates after a status change.
11. A person with an invalid token cannot access an order.
12. A customer cannot read or send messages for another order.
13. A non-admin cannot access admin endpoints or admin socket rooms.
14. Product price changes after an order do not change the historical
    order total.
15. Product availability changes before checkout are respected.
16. A repeated checkout request does not create duplicate orders.
17. Pickup orders have no delivery fee and do not require an address.
18. Delivery orders require the configured address fields and use the
    current delivery fee.

------------------------------------------------------------------------

## 16. Working with Codex or Another Coding Agent

Use this plan as the project source of truth, but implement one phase or
small task at a time.

For each task:

1.  Ask the agent to inspect the existing repository and this plan
    before editing.
2.  State the exact phase and task to implement.
3.  Ask it to list files it intends to create or modify.
4.  Require backend validation and authorization, not just frontend UI.
5.  Ask it to add or update tests for the behavior.
6.  Ask it to run relevant tests, linting, type checks, and migrations.
7.  Review the diff before moving to the next task.
8.  Update this plan when a deliberate scope or architecture decision
    changes.

### Suggested deployment verification task

``` text
Read IMPLEMENTATION_PLAN.md and inspect the repository.

The application now uses Drizzle with Supabase PostgreSQL and Render. Verify
the migration and hosting configuration against an operator-provided Supabase
staging project. Never print, commit, or send credentials to external services.

Confirm `DATABASE_URL` uses the transaction pooler and `DIRECT_URL` uses the
direct or session pooler. Back up the staging database, run `npm run db:deploy`,
and verify a new database applies committed migrations. Also verify the safe
baseline path against an existing complete schema and confirm partial schemas
stop without writes. Check order transactions, private proof authorization,
owner sessions, and Socket.IO through Render.

Do not modify application contracts or features unless validation finds a
specific regression. Report exact commands, outcomes, and remaining provider
setup. Never invent credentials or modify production data.
```

------------------------------------------------------------------------

## 17. POC Completion Criteria

The first usable release is complete when:

-   Customers can browse products and check out without an account.
-   Customers can choose Delivery or Pickup.
-   Delivery orders collect the required address and apply the
    configured fee.
-   Pickup orders omit delivery address fields and have no delivery fee.
-   Customers can choose COD or QR payment.
-   QR payment proof can be submitted and manually verified by the
    owner.
-   The owner can manage products and availability.
-   The owner can process orders using the correct fulfillment workflow.
-   Customers can securely track their orders.
-   Customers and the owner can exchange order-related messages.
-   Important order, payment, and message updates work in real time.
-   Production frontend and API deploy on Render, with Supabase PostgreSQL
    and Storage configured through secrets and environment variables.
-   Critical access-control, validation, and order-calculation tests
    pass.

Keep the initial release focused on making the ordering workflow
reliable. Add payment-gateway automation, customer accounts, delivery
integrations, and advanced reporting only after the POC is being used
successfully.
