# ⚡ PulseCP — High-Throughput Distributed Contest Notification Engine

**PulseCP** is an event-driven backend engine built with **Node.js, TypeScript, PostgreSQL (Drizzle ORM), Redis, and BullMQ**. It aggregates upcoming competitive programming contests across **LeetCode, Codeforces, CodeChef, and AtCoder**, and dispatches real-time, multi-channel notifications (Push Notifications via `ntfy.sh`/FCM, Email via Resend/SMTP, and Telegram/Discord Webhooks).

While built to serve personal competitive programming schedules effortlessly, PulseCP is architected from the ground up to scale to **1,000,000+ subscribed users** using a **Two-Stage Delayed Fan-Out Pattern**, **Cursor-Based Index-Only Pagination**, and an **Idempotent Outbox Ledger**.

---

## 🏗️ 1. System Design: The 1-Million-User Scale Challenge

### Why Naive Architectures Fail at Scale
In a naive implementation for a single user, discovering a new contest triggers an immediate creation of delayed jobs in Redis for every subscribed user. At a scale of **1,000,000 users** across **20 upcoming weekly contests** (with 2 reminders per contest: `T-24h` and `T-30m`):

1. **Redis Memory Explosion (OOM):**
   $$1,000,000 \text{ users} \times 20 \text{ contests} \times 2 \text{ reminders} = 40,000,000 \text{ delayed jobs}$$
   Storing 40 million job payloads simultaneously in Redis RAM will rapidly exhaust memory and crash the cluster.
2. **The Thundering Herd Problem at $T-30\text{m}$:**
   Executing `SELECT * FROM users WHERE platform = 'CODEFORCES'` in a single worker thread when a contest is 30 minutes away will block the Node.js event loop, saturate PostgreSQL connection pools, and trigger HTTP `429 Too Many Requests` bans from downstream email and push notification providers.
3. **Contest Rescheduling Overhead:**
   If Codeforces shifts a contest start time by 30 minutes, updating 1,000,000 individual delayed jobs in Redis becomes an expensive $O(N)$ operation.

### The PulseCP Solution: Two-Stage Delayed Fan-Out
PulseCP decouples **Contest Scheduling** from **User Dispatch**:

* **Stage 1: O(Contests) Trigger Scheduling:**
  Regardless of whether the system has 1 user or 10 million users, Redis only holds **one delayed trigger job per contest reminder** (e.g., `trigger:cf-1050:30m`). Total delayed jobs in Redis stay under $\sim 50$ at any given time.
* **Stage 2: Cursor-Paginated Batch Fan-Out:**
  When `trigger:cf-1050:30m` fires, a **Fan-Out Coordinator Worker** wakes up and streams subscribed users from PostgreSQL in chunks of `1,000` using **B-Tree Cursor Pagination (`WHERE user_id > :last_cursor`)**. Each chunk is pushed into channel-specific, rate-limited **Delivery Queues**.

---

## 🔄 2. High-Level Architecture Diagram

```text
+-------------------------------------------------------------------------+
|                         1. INGESTION LAYER                              |
|  [BullMQ Cron: Every 6h] ---> [Platform Adapter Orchestrator]           |
|   ├── CodeforcesAdapter (Official REST API)                             |
|   ├── LeetCodeAdapter   (GraphQL API)                                   |
|   ├── CodeChefAdapter   (Internal JSON Endpoint)                        |
|   └── AtCoderAdapter    (HTML DOM Scraper via Cheerio)                  |
+------------------------------------+------------------------------------+
                                     |
                                     | Upsert & Compare SHA-256 Time Hash
                                     v
+-------------------------------------------------------------------------+
|                      2. PERSISTENCE LAYER (PostgreSQL)                  |
|  [contests]   [users]   [user_channels]   [user_preferences]   [outbox] |
+------------------------------------+------------------------------------+
                                     |
                                     | Schedule / Update Deterministic Job
                                     v
+-------------------------------------------------------------------------+
|               3. STAGE 1: CONTEST TRIGGER QUEUE (Redis/BullMQ)          |
|  Holds ONLY 1 delayed job per contest window (e.g., trigger:lc-410:30m) |
+------------------------------------+------------------------------------+
                                     |
                                     | Fires at T-24h / T-30m
                                     v
+-------------------------------------------------------------------------+
|               4. STAGE 2: FAN-OUT COORDINATOR WORKER                    |
|  Streams subscribers via Index-Only Cursor Pagination (Batch = 1,000)   |
+----------+------------------------------+----------------------------+--+
           |                              |                            |
           v                              v                            v
+-----------------------+      +-----------------------+    +-----------------------+
| email-delivery-queue  |      | push-delivery-queue   |    | webhook-delivery-queue|
| (Rate Limit: 50/sec)  |      | (Rate Limit: 200/sec) |    | (Rate Limit: 30/sec)  |
+-----------+-----------+      +-----------+-----------+    +-----------+-----------+
            |                              |                            |
            v                              v                            v
    [Resend / AWS SES]             [ntfy.sh / FCM]             [Telegram / Discord]
```

---

## 🧩 3. Core Engineering Modules

### 3.1. Resilient Ingestion Engine (Adapter Pattern)
Every competitive programming platform exposes data differently and suffers from occasional downtime (especially before major rounds).
* **Unified Contract:** All scrapers and API clients implement the `IContestProvider` interface:
  ```typescript
  export interface NormalizedContest {
    platform: 'CODEFORCES' | 'LEETCODE' | 'CODECHEF' | 'ATCODER';
    externalId: string;
    name: string;
    url: string;
    startTime: Date;        // Normalized to UTC
    durationSeconds: number;
  }

  export interface IContestProvider {
    readonly platformName: string;
    fetchUpcomingContests(): Promise<NormalizedContest[]>;
  }
  ```
* **Fault Isolation:** The `IngestionService` executes all providers concurrently using `Promise.allSettled()`. If AtCoder's DOM changes or Codeforces returns `503 Service Unavailable`, LeetCode and CodeChef contests are still ingested and scheduled without pipeline failure.
* **Change Detection & Rescheduling:** Each contest stores a deterministic hash of `startTime + durationSeconds`. If an upsert detects that a contest was postponed, the scheduler overwrites the existing BullMQ job in $O(1)$ time using its deterministic key (`trigger:${contestId}:${offset}`).

### 3.2. Database Schema & Indexing Strategy (PostgreSQL + Drizzle)
Designed for **Index-Only Scans** during high-concurrency fan-outs and strict idempotency during delivery retries.

#### `contests`
| Column | Type | Constraints / Notes |
| :--- | :--- | :--- |
| `id` | `UUID` | Primary Key (`defaultRandom()`) |
| `platform` | `VARCHAR(32)` | `CODEFORCES`, `LEETCODE`, `CODECHEF`, `ATCODER` |
| `external_id` | `VARCHAR(128)` | Platform's native ID or slug |
| `name` | `TEXT` | Contest title |
| `url` | `TEXT` | Direct registration/contest URL |
| `start_time` | `TIMESTAMPTZ` | Stored strictly in UTC |
| `duration_seconds` | `INTEGER` | Duration in seconds |
| `schedule_hash` | `VARCHAR(64)` | Detects if `start_time` was modified by platform |

* **Unique Index:** `uq_platform_external_id ON (platform, external_id)`

#### `users` & `user_channels`
| Column | Type | Constraints / Notes |
| :--- | :--- | :--- |
| `id` | `UUID` | Primary Key |
| `user_id` | `UUID` | Foreign Key $\rightarrow$ `users.id` |
| `channel_type` | `VARCHAR(32)` | `EMAIL`, `NTFY`, `TELEGRAM` |
| `destination` | `TEXT` | Email address, `ntfy.sh` topic name, or Chat ID |
| `is_enabled` | `BOOLEAN` | Allows pausing a specific channel |

#### `user_preferences`
| Column | Type | Constraints / Notes |
| :--- | :--- | :--- |
| `id` | `UUID` | Primary Key |
| `user_id` | `UUID` | Foreign Key $\rightarrow$ `users.id` |
| `platform` | `VARCHAR(32)` | Target CP platform |
| `notify_24h` | `BOOLEAN` | Send reminder 24 hours prior |
| `notify_30m` | `BOOLEAN` | Send urgent reminder 30 minutes prior |

* **Composite B-Tree Index:** `idx_fanout_lookup ON (platform, notify_30m, notify_24h, user_id)` — Enables fast cursor pagination ordered by `user_id`.

#### `notification_outbox` (Idempotency Ledger)
| Column | Type | Constraints / Notes |
| :--- | :--- | :--- |
| `id` | `UUID` | Primary Key |
| `contest_id` | `UUID` | Foreign Key $\rightarrow$ `contests.id` |
| `user_id` | `UUID` | Foreign Key $\rightarrow$ `users.id` |
| `channel_type` | `VARCHAR(32)` | `EMAIL`, `NTFY`, `TELEGRAM` |
| `reminder_window` | `VARCHAR(16)` | `24H` or `30M` |
| `status` | `VARCHAR(16)` | `PENDING`, `SENT`, `FAILED` |
| `sent_at` | `TIMESTAMPTZ` | Timestamp of successful dispatch |

* **Unique Constraint:** `uq_idempotent_delivery ON (contest_id, user_id, channel_type, reminder_window)`
* **Why this matters:** If a delivery worker crashes halfway through a batch of 1,000 users and BullMQ retries the job, `INSERT INTO notification_outbox ... ON CONFLICT DO NOTHING` guarantees that users who already received the alert are skipped.

---

## ⚖️ 4. Key Architectural Trade-Offs

| Decision | Alternative Considered | Why We Chose This Approach |
| :--- | :--- | :--- |
| **Two-Stage Queue Fan-Out** | Creating per-user delayed jobs upon contest ingestion | Reduces Redis memory footprint by **99.9%** ($O(\text{Contests})$ vs $O(\text{Users} \times \text{Contests})$) and makes contest time updates $O(1)$. |
| **Keyset / Cursor Pagination (`WHERE user_id > :cursor`)** | Standard `LIMIT 1000 OFFSET X` pagination | `OFFSET 500000` forces Postgres to scan and discard 500k rows. Keyset pagination jumps directly to the next B-Tree leaf node in $O(\log N)$ time. |
| **PostgreSQL Idempotency Outbox** | Relying solely on BullMQ job state | BullMQ batches can partially fail. Database-level unique constraints guarantee **exactly-once delivery semantics** per user/channel/window. |
| **Decoupled `app.ts` and `worker.ts` Entrypoints** | Running Express and BullMQ workers in one process | Allows independent horizontal scaling—e.g., running 1 lightweight API container and scaling up 8 Delivery Worker containers during peak contest hours. |
| **Direct Platform Adapters + Cheerio** | Relying exclusively on a 3rd-party aggregator | Eliminates single points of failure and third-party rate limits while keeping data fresh directly from the source platforms. |

---

## 📂 5. Project Directory Structure

```text
pulsecp-engine/
├── docker-compose.yml                # Postgres 16 + Redis 7 + API + Worker services
├── drizzle.config.ts                 # Drizzle Kit schema & migration config
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── config/
    │   ├── env.ts                    # Strict runtime env validation with Zod
    │   ├── db.ts                     # Drizzle ORM + pg-pool singleton
    │   └── redis.ts                  # IORedis connection manager for BullMQ
    ├── db/
    │   ├── schema/
    │   │   ├── users.schema.ts       # users, user_channels, user_preferences
    │   │   ├── contests.schema.ts    # contests table & composite indexes
    │   │   ├── outbox.schema.ts      # notification_outbox idempotency ledger
    │   │   └── index.ts
    │   ├── seed.ts                   # Seeds personal user profile & channels
    │   └── migrations/
    ├── modules/
    │   ├── ingestion/                # Stage 0: Fetching & Normalizing Contests
    │   │   ├── contest-provider.interface.ts
    │   │   ├── providers/
    │   │   │   ├── codeforces.provider.ts
    │   │   │   ├── leetcode.provider.ts
    │   │   │   ├── codechef.provider.ts
    │   │   │   └── atcoder.provider.ts
    │   │   ├── ingestion.service.ts
    │   │   └── ingestion.worker.ts
    │   ├── scheduler/                # Stage 1 & 2: Trigger & Cursor Fan-Out
    │   │   ├── trigger.queue.ts
    │   │   ├── trigger.worker.ts
    │   │   └── fanout.service.ts
    │   ├── notification/             # Stage 3: Rate-Limited Channel Dispatchers
    │   │   ├── channel.interface.ts
    │   │   ├── channels/
    │   │   │   ├── ntfy.channel.ts   # Instant Android/iOS push via ntfy.sh
    │   │   │   ├── email.channel.ts  # HTML Email alerts via Resend/Nodemailer
    │   │   │   └── telegram.channel.ts
    │   │   ├── delivery.queue.ts
    │   │   └── delivery.worker.ts
    │   └── api/                      # REST API for managing preferences & manual sync
    │       ├── routes.ts
    │       └── controllers.ts
    ├── shared/
    │   ├── logger.ts                 # Structured JSON logging via Pino
    │   ├── hash.ts                   # SHA-256 helper for contest schedule hashing
    │   └── http-client.ts            # Fetch wrapper with timeout & exponential retry
    ├── app.ts                        # HTTP API Server entrypoint
    └── worker.ts                     # Background Queue Workers entrypoint
```

---

## 🚀 6. Getting Started & Local Setup

### Prerequisites
* **Node.js** `>= 20.x`
* **Docker & Docker Compose** (for PostgreSQL and Redis)
* **ntfy mobile app** (Optional, free on Android/iOS for instant phone notifications)

### 1. Environment Configuration
Copy `.env.example` to `.env` and configure your credentials:

```env
# Server & Environment
NODE_ENV=development
PORT=4000

# Database & Redis
DATABASE_URL=postgresql://pulsecp:pulsecp_secret@localhost:5432/pulsecp_db
REDIS_URL=redis://localhost:6379

# Personal Notification Targets (Used by Seed Script)
ADMIN_EMAIL=your.email@example.com
NTFY_TOPIC=pulsecp-alerts-yourname-secret
NTFY_SERVER_URL=https://ntfy.sh

# Email Provider (SMTP / Resend)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.email@example.com
SMTP_PASS=your_app_specific_password
EMAIL_FROM="PulseCP Alerts <alerts@pulsecp.dev>"
```

### 2. Start Infrastructure & Run Migrations
```bash
# 1. Start PostgreSQL and Redis containers
docker compose up -d postgres redis

# 2. Install dependencies
npm install

# 3. Generate and apply Drizzle database migrations
npm run db:generate
npm run db:migrate

# 4. Seed your personal user profile, preferences, and notification channels
npm run db:seed
```

### 3. Run the Engine
```bash
# Terminal 1: Start the Background Ingestion, Fan-Out, and Delivery Workers
npm run dev:worker

# Terminal 2: Start the REST API Server
npm run dev:api
```

### 4. Trigger an Immediate Test Sync & Alert
You don't have to wait 6 hours for the cron job to test the pipeline. Trigger a manual ingestion and test notification via the API:
```bash
# Force immediate contest sync across all 4 platforms
curl -X POST http://localhost:4000/api/v1/ingest/trigger

# Send a test push notification & email to verify your phone/inbox setup
curl -X POST http://localhost:4000/api/v1/notifications/test
```

---

## 🗺️ 7. Implementation Roadmap

- [x] **Phase 0:** System Architecture & High-Scale Design Specification
- [ ] **Phase 1:** Core Infrastructure Setup (`package.json`, Docker Compose, Zod Env Config, Drizzle Schema & Migrations)
- [ ] **Phase 2:** Multi-Platform Ingestion Engine (Codeforces, LeetCode, CodeChef, and AtCoder Providers + Upsert Service)
- [ ] **Phase 3:** Two-Stage BullMQ Scheduler (`contest-trigger-queue` + Cursor-Paginated `FanOutService`)
- [ ] **Phase 4:** Multi-Channel Notification Dispatchers (`ntfy.sh` Phone Push + HTML Email + Seed Script & End-to-End Test)