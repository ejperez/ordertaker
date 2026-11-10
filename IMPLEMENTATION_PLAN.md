# Implementation Plan --- Ordertaker POC

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
-   PostgreSQL
-   Prisma ORM
-   Zod or Fastify-compatible schema validation for request validation
-   Socket.IO hosted on the same HTTP server as Fastify
-   `@fastify/multipart` for image and payment-proof uploads
-   `@fastify/static` for serving local uploaded files
-   Secure HTTP-only cookie sessions for owner authentication

### Development and quality

-   ESLint and Prettier
-   Environment variables managed through `.env`
-   Prisma migrations and seed scripts
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
│   ├── prisma/
│   ├── public/
│   │   └── uploads/
│   │       ├── products/
│   │       └── payment-proofs/
│   ├── src/
│   │   ├── config/
│   │   ├── plugins/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── products/
│   │   │   ├── categories/
│   │   │   ├── orders/
│   │   │   ├── payments/
│   │   │   ├── messages/
│   │   │   └── settings/
│   │   ├── realtime/
│   │   ├── services/
│   │   └── server.ts
│   └── ...
├── docs/
├── .gitignore
└── README.md
```

Keep module boundaries practical. Do not create a separate service or
deployable application for each module.

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

Use Socket.IO on the same Node.js HTTP server as Fastify. Do not create
a separate real-time service for this POC.

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

REST endpoints and PostgreSQL remain the source of truth. On socket
events, clients should update or invalidate TanStack Query data. The app
must still work if a socket disconnects; clients can refetch through
REST.

------------------------------------------------------------------------

## 10. Database Design

Use PostgreSQL and Prisma migrations.

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

-   Use `DECIMAL`/Prisma `Decimal` for money. Do not use floating-point
    types for currency calculations.
-   Use transactions for order creation and status/payment changes that
    must remain consistent.
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

For the POC, store uploads on the application server's filesystem.

Suggested locations:

``` text
backend/public/uploads/products/
backend/public/uploads/payment-proofs/
```

Implementation requirements:

-   Use `@fastify/multipart`.
-   Validate file size and actual file type; do not trust the filename
    or browser-provided MIME type alone.
-   Generate unique server-side filenames.
-   Do not use user-supplied filenames as filesystem paths.
-   Restrict product image uploads to authenticated admins.
-   Restrict payment-proof uploads to the order's authorized guest or
    admin.
-   Store relative file paths in PostgreSQL, not image binary data.
-   Avoid exposing private payment proofs as unrestricted public static
    files. Serve them through an authorization-checked endpoint.
-   Consider resizing images and converting them to WebP.
-   Clean up replaced or orphaned files safely.
-   Back up uploaded files together with the database.

Create an `ImageStorageService` abstraction so local storage can later
be replaced by S3-compatible storage or Cloudinary without changing
product/order business logic.

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
-   [ ] Back up PostgreSQL and uploaded files.
-   [ ] Add basic operational logging and a health-check endpoint.

------------------------------------------------------------------------

## 14. Implementation Phases

Build and test in small vertical slices. Do not ask a coding agent to
generate the entire application in one pass.

### Phase 1 --- Project foundation

-   [x] Create frontend and backend projects.
-   [x] Configure TypeScript, linting, formatting, and environment
    variables.
-   [x] Set up PostgreSQL and Prisma.
-   [x] Create the initial Prisma schema and migration.
-   [x] Add seed scripts for the owner, categories, products, and store
    settings.
-   [x] Set up Fastify plugins, centralized error handling, and health
    check.
-   [x] Set up React Router, Tailwind, and TanStack Query.
-   [x] Confirm frontend can call the backend locally.

**Done when:** both apps run locally, the database migrates and seeds
successfully, and the frontend can fetch a test endpoint.

### Phase 2 --- Admin authentication and product management

-   [x] Implement owner login, logout, and current-session endpoint.
-   [x] Add secure cookie/session handling and login rate limiting.
-   [x] Protect admin routes on the backend.
-   [x] Implement category CRUD.
-   [x] Implement product CRUD and archive/availability behavior.
-   [x] Implement local product image upload and authorized image
    serving.
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
-   [x] Require and privately store a QR payment receipt during checkout.
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

-   [ ] Test guest checkout for both fulfillment types.
-   [ ] Test all valid and invalid status transitions.
-   [ ] Test price and delivery-fee calculations.
-   [ ] Test payment approval/rejection and COD collection.
-   [ ] Test tracking-token authorization and attempts to access another
    order.
-   [ ] Test upload validation and private payment-proof access.
-   [ ] Test admin route and socket authorization.
-   [ ] Test mobile layouts and common error/empty/loading states.
-   [ ] Configure production environment variables and HTTPS.
-   [ ] Configure database and upload backups.
-   [ ] Document setup, migrations, seed process, deployment, and owner
    usage.

**Done when:** the application is deployed, the owner can operate it,
and critical security and ordering flows have been tested.

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

### Suggested first Codex task

``` text
Read IMPLEMENTATION_PLAN.md and inspect the repository.

Implement Phase 1 only: project foundation.

Use the stack and repository structure described in the plan. Set up the
React/Vite/TypeScript frontend, Fastify/TypeScript backend, PostgreSQL,
Prisma, environment configuration, initial schema/migration, seed scripts,
centralized backend error handling, health-check endpoint, and frontend
API connectivity.

Do not implement product management, checkout, orders, payments, sockets,
or dashboard features yet.

Before making changes, summarize the implementation steps and files you
expect to create. After implementation, run the available type checks,
linting, migrations, and tests. Report commands run, results, and any
remaining setup steps. Do not invent credentials or commit .env files.
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
-   Critical access-control, validation, and order-calculation tests
    pass.

Keep the initial release focused on making the ordering workflow
reliable. Add payment-gateway automation, customer accounts, delivery
integrations, and advanced reporting only after the POC is being used
successfully.
