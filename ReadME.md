# Δ Helix — CFTR Precision Medicine Platform
## Technical Documentation v3.0

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [Core Algorithms](#4-core-algorithms)
5. [Helios Evidence Engine](#5-helios-evidence-engine)
6. [Search Intelligence Layer](#6-search-intelligence-layer)
7. [Geographic Intelligence](#7-geographic-intelligence)
8. [Security Model](#8-security-model)
9. [Performance Characteristics](#9-performance-characteristics)
10. [Deployment](#10-deployment)

---

## 1. System Overview

Δ Helix is a clinical-grade variant curation and precision medicine decision support platform for Cystic Fibrosis (CF). It maintains a curated database of CFTR gene variants and provides clinicians with real-time access to classification data, ETI (Elexacaftor/Tezacaftor/Ivacaftor) response predictions, evidence chains, and automated consistency checking.

The platform serves two primary clinical functions:

**Variant lookup** — clinicians at CF centres search for specific variants by any nomenclature (legacy name, HGVS protein notation, HGVS cDNA notation, or alternative names) to retrieve classification and treatment guidance.

**Variant curation** — authorised users curate, validate, and enrich variant records with evidence links, clinical determinations, and classification assignments. All curation activity is subject to automated consistency checking by the Helios Evidence Engine before changes are accepted.

### Key Statistics (Production)
- 2,237 CFTR variants under active curation
- 1,339 complete records (class, ETI prediction, HGVS notation)
- Live clinical use across multiple CF centres in Spain and internationally
- Real-time geographic search intelligence across all sessions

---

## 2. Architecture

### 2.1 Technology Stack

The platform is a single-page application (SPA) delivered as a static HTML file hosted on GitHub Pages. All persistent state is managed through a Supabase backend.

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES2020+), HTML5, CSS3 |
| Styling | Tailwind CSS (CDN), custom CSS variable design system |
| Charts | Chart.js |
| Backend | Supabase (PostgreSQL + PostgREST REST API) |
| Hosting | GitHub Pages (static) |
| Fonts | IBM Plex Sans, IBM Plex Mono, Syne (Google Fonts) |

### 2.2 Application Architecture

The application follows a single-module architecture with explicit separation of concerns through named sections:

```
CONFIG          — Runtime configuration (Supabase URL, UI constants)
STATE           — Global application state (variants, search index, view state)
Database Layer  — loadVariants(), CRUD operations via Supabase REST
Search Engine   — buildSearchIndex(), searchVariants()
View Layer      — renderVariantList(), renderVariantDetail()
Intelligence    — Search logging, gap scoring, geographic analysis
Helios Engine   — Autonomous consistency checking and evidence analysis
```

### 2.3 State Management

All application state is held in a single `STATE` object that is never serialised — it exists only in memory for the duration of a session. The key sub-objects are:

```javascript
STATE = {
    variants: [],              // Full variant array loaded at init
    variantsById: Map,         // O(1) lookup by numeric ID
    variantsByLegacyName: Map, // O(1) lookup by legacy name string
    searchIndex: {
        lookup: Map,           // normalised term → Set<variantId>
    },
    masterStats: {},           // Pre-computed aggregate statistics
    view: {
        filteredVariants: [],  // Current filtered/searched result set
        selectedVariant: null, // Currently displayed variant
        searchQuery: '',       // Live search query
        currentPage: 1
    },
    searchIntelligence: {
        sessionId: string,     // Random session identifier
        locationCache: {},     // IP geolocation (fetched once per session)
        hospital: string       // Clinician's institution (localStorage)
    }
}
```

### 2.4 Initialisation Sequence

On page load the system executes the following sequence:

1. Render loading screen with animated canvas
2. Call `loadVariants()` — paginated fetch from Supabase (500 records per page)
3. `buildSearchIndex()` — construct in-memory inverted index from loaded variants
4. `calculateMasterStats()` — compute aggregate counts by class, ETI prediction, validation status
5. `initSearch()` — attach input event listeners with dual debounce (180ms UI, 1200ms logging)
6. `loadSearchIntelligence()` — fetch historical search logs and miss queue for the session dashboard
7. `initHospital()` — retrieve or prompt for institution identity from localStorage
8. `fetchLocationOnce()` — single IP geolocation call for geographic search logging
9. Loading screen fade-out, application ready

Total typical initialisation time: 1.2–2.8 seconds depending on variant count and network latency.

---

## 3. Data Model

### 3.1 Core Tables

**`variants`** — The primary clinical record for each CFTR variant.

| Field | Type | Description |
|---|---|---|
| `id` | bigint | Auto-incrementing primary key |
| `legacy_name` | text UNIQUE | Traditional mutation name (e.g. F508del, G551D) |
| `protein_name` | text | HGVS protein notation (e.g. p.Phe508del) |
| `cdna_name` | text | HGVS cDNA notation (e.g. c.1521_1523delCTT) |
| `cftr_class` | text | Functional class I–VI, II/III compound |
| `class_subtype` | text | Modifier: true, presumed, exceptional, atypical, standard |
| `eti_prediction` | text | responsive, non_responsive, unknown |
| `final_determination` | text | CF-causing, VUS, non CF-causing |
| `validation_count` | integer | Number of clinician validations |
| `search_hit_count` | integer | Total successful searches for this variant |
| `clinical_alert` | text | Database-computed alert text based on class and subtype |

The `clinical_alert` field is a PostgreSQL computed column that generates contextual treatment guidance based on class/subtype combinations, ensuring alert text is always consistent with classification.

**`evidence_links`** — Evidence sources attached to variants.

Each evidence link carries `cftr_class_claim` and `eti_claim` fields — the classification assertions made by that source. These fields are the input to the Helios evidence contradiction engine.

**`search_logs`** — Every search event, hit or miss, with full geographic context.

Captures `query`, `is_hit`, `matched_field`, `hospital_name`, `country`, `city`, `latitude`, `longitude`, `session_id`. This table is the data source for all geographic intelligence features.

**`search_miss_queue`** — Aggregated failed search queries.

Maintains `miss_count` and `unique_sessions` per query. Updated on each miss via PostgreSQL `ON CONFLICT` upsert. Drives the Miss Queue Intelligence engine.

### 3.2 Helios-specific Tables

**`helios_pending_review`** — The primary Helios inbox. All automated findings queue here before any DB modification occurs.

**`helios_audit_log`** — Immutable record of every clinician decision on a Helios finding, including the full `review_snapshot` JSON at the time of decision.

**`helios_bot_runs`** — Operational metadata for each scan execution: type, status, variants scanned, findings created, error count, duration.

**`helios_monitor_targets`** — Variants under continuous background monitoring.

---

## 4. Core Algorithms

### 4.1 Search Index — Inverted Map with HGVS Prefix Stripping

The search index is built on application load and rebuilt after any variant is added, edited, or deleted.

**Index construction** (`buildSearchIndex`):

For each variant, all name fields are tokenised and stored in a `Map<string, Set<variantId>>`:

```
Fields indexed: legacy_name, protein_name, cdna_name, alt_names
Normalisation: lowercase, trim
HGVS stripping: p. prefix removed (protein), c. prefix removed (cDNA), r. prefix removed (RNA)
alt_names: split on whitespace, comma, and semicolon
```

Each name is stored twice — once with the prefix intact and once without — so queries like "Phe508del" and "p.Phe508del" both resolve correctly.

**Query execution** (`searchVariants`):

```
1. Normalise query: lowercase, trim
2. Produce stripped form: remove p. / c. / r. prefix
3. Iterate index: for each (key, ids) where key.includes(raw) OR key.includes(stripped)
   → add all ids to matchedIds Set
4. Resolve ids → variant objects
5. Sort by match specificity:
   rank 0 — exact match on any primary field
   rank 1 — prefix match (query is prefix of field)
   rank 2 — substring match
```

The use of `includes()` rather than exact matching allows partial nomenclature queries. A search for "508" returns F508del, p.Phe508del, and any variant containing 508 in any indexed field — which is clinically appropriate because clinicians often search by residue number.

Minimum query length is 2 characters (configurable via `CONFIG.UI.MIN_SEARCH_CHARS`).

**Dual debounce logging:**

The search input uses two independent timers:
- 180ms debounce for UI filtering (fast response)
- 1200ms debounce for search logging (avoids polluting logs with partial keystrokes)

Only the final settled query after 1200ms is logged to `search_logs`. Intermediate keystrokes are discarded.

### 4.2 Research Gap Scoring Engine

Each variant receives a gap score (0–100) representing urgency of research need. Higher scores indicate more critical data gaps. The score drives the Research Gap Queue in the dashboard and the Validation Priority Queue in Helios.

**Scoring weights:**

| Condition | Weight |
|---|---|
| No CFTR class assigned | 25 |
| No ETI prediction (or unknown) | 20 |
| No evidence links | 15 |
| No protein name (HGVS) | 8 |
| No cDNA name (HGVS) | 8 |
| Fewer than 3 evidence sources | 7 |
| No clinical determination | 7 |
| No validation + high search demand (≥5 searches) | 10 |
| No validation (low demand) | 4 |
| High search demand ≥10 searches | 10 |

Total maximum: 110 (capped at 100).

**Gap levels:**

| Level | Score range |
|---|---|
| CRITICAL | 75–100 |
| SEVERE | 55–74 |
| MODERATE | 35–54 |
| MINOR | 15–34 |
| ADEQUATE | 0–14 |

Gap scores are persisted asynchronously to the `research_gaps` table (DELETE + INSERT pattern for each variant on each analysis). The persistence never blocks the UI — it fires in the background via a non-awaited Promise.

### 4.3 Validation Priority Queue

The validation queue in the Helios Validate tab orders unvalidated variants by clinical urgency using a composite score:

```
urgency_score = min(search_hit_count × 8, 50)   // demand signal, capped
              + (cftr_class assigned ? 12 : 0)    // complete records are more urgent to validate
              + (eti_prediction set ? 12 : 0)
              + (protein_name set ? 6 : 0)
              + (cdna_name set ? 6 : 0)
              + min((days_since_update / 10), 14) // staleness
              + (no cftr_class ? 10 : 0)          // high uncertainty boost
```

Variants with urgency score ≥ 70 are labelled HIGH, ≥ 40 MEDIUM, below 40 LOW.

This deliberately weights search demand heavily — a variant searched 10 times by clinicians but never validated (score ~80+) is treated as more urgent than a well-documented variant that has simply not been formally validated.

---

## 5. Helios Evidence Engine

Helios is the automated clinical evidence review system within Δ Helix. It operates on a strict clinician-in-the-loop principle: Helios reads data freely and proposes changes, but writes to the `variants` table only after explicit clinician approval.

### 5.1 Architecture Principle

```
Helios reads:   variants, evidence_links, search_logs, search_miss_queue, helios_audit_log
Helios writes:  helios_pending_review (findings)
                helios_audit_log (after clinician decision)
                variants (only via heliosApplyDBChange, only after approval)
                helios_bot_runs (scan metadata)
                helios_monitor_targets (monitor management)
```

This separation means Helios findings are always proposals, never direct modifications. The audit trail is therefore complete — every change to the variants table that originated from Helios has a corresponding approved entry in `helios_audit_log`.

### 5.2 Calibration Engine

The calibration engine is loaded on Helios open and provides confidence scores that adapt based on observed clinician decisions.

**Biological priors** — before any clinical data exists, each item type has a prior confidence based on the strength of the underlying biological rule:

| Item Type | Prior |
|---|---|
| INTERNAL_ORPHAN | 88% |
| INTERNAL_LOGIC | 82% |
| DRIFT_ALERT | 78% |
| CONTRADICTION | 80% |
| NEW_EVIDENCE | 72% |
| INTERNAL_NAMING | 65% |
| MISS_RESOLVED | 60% |

**Bayesian blending** — as clinicians make decisions, the displayed confidence shifts from prior toward observed approval rate:

```
weight = min(n / (CALIBRATION_THRESHOLD × 2), 1.0)
blended = prior × (1 − weight) + observed_approval_rate × weight
```

`CALIBRATION_THRESHOLD = 5`. Below 5 decisions the score is labelled PRIOR. Above 5 it transitions to LIVE and the label shows the number of decisions driving the calibration.

**Decision speed tracking** — median time between item creation and clinician decision is computed per item type. If the median is below 15 seconds, a warning is shown on the confidence block indicating possible rubber-stamping.

**Divergence detection** — if the most recent 5 decisions on an item type differ from the historical approval rate by more than 30 percentage points, a divergence warning is displayed. This flags cases where clinical consensus may be shifting.

### 5.3 Consistency Check Rules

The internal scan applies these rules to every variant in the database:

**Rule 1 — Class III logic (URGENT, 85% confidence)**

Class III variants (gating defects) are biologically responsive to ETI modulators. If `cftr_class = 'III'` and `eti_prediction ≠ 'responsive'` and `class_subtype ≠ 'exceptional'`, a finding is created proposing `eti_prediction → responsive`.

**Rule 2 — Class I exception check (ROUTINE, 50% confidence)**

Class I variants (nonsense/stop mutations) are typically non-responsive to ETI. If `cftr_class = 'I'` and `eti_prediction = 'responsive'` and `class_subtype ≠ 'exceptional'`, a ROUTINE finding is created proposing `class_subtype → exceptional` and prompting clinical justification. The system does not propose changing the ETI prediction directly because Class I exceptional cases are documented in the literature.

The `class_subtype = 'exceptional'` check acts as a permanent suppression flag — once a clinician uses Mark Exceptional and provides written justification, that variant never triggers this rule again.

**Rule 3 — Orphan variant (ROUTINE, 90% confidence)**

If `cftr_class` is null and `search_hit_count ≥ 3`, the variant has high clinical demand but no classification. Finding created to flag for literature review.

**Rule 4 — HGVS protein notation (ROUTINE, 60% confidence)**

If `protein_name` does not start with `p.` or `p.(`, a naming issue is flagged.

**Rule 5 — HGVS cDNA notation (ROUTINE, 60% confidence)**

If `cdna_name` does not start with `c.`, a naming issue is flagged.

**Deduplication** — before creating any pending item, the system checks for an existing pending item with the same `variant_id` and `item_type`. Duplicate findings are silently skipped, preventing the inbox from filling with repeated scans of the same issue.

### 5.4 Evidence Contradiction Engine

When `heliosCheckEvidenceContradictions()` runs, it:

1. Fetches all evidence links with non-null `cftr_class_claim` or `eti_claim`
2. Groups links by `variant_id`
3. For each variant, compares `cftr_class_claim` values against the current `cftr_class`
4. Contradicting sources are weighted by `quality_score` (1–10)
5. If contradicting weight exceeds confirming weight → URGENT; otherwise ROUTINE
6. The proposed value is the highest quality-score contradicting claim

ETI contradictions are always flagged as URGENT because an incorrect ETI prediction directly affects treatment decisions.

### 5.5 Miss Queue Intelligence

The miss queue intelligence engine scores unmatched search queries by cross-institutional demand:

```
score = 0
if unique_sessions ≥ 3: score += 40   (cross-institutional confirmed)
if miss_count ≥ 5:       score += 30   (high frequency)
if days_since_last ≤ 7:  score += 20   (recent — active clinical need)
if top_hospital exists:  score += 10   (known source)

if score < 40: skip (not significant)
priority = score ≥ 70 ? URGENT : ROUTINE
confidence = min(50 + score, 95)
```

This means a query searched 6 times across 3 different institutions in the past week scores 90/100 and generates an URGENT finding.

### 5.6 Drift Detection

The drift engine compares current variant field values against the last approved Helios changes recorded in the audit log. If a field that was approved as value X now has value Y, a DRIFT_ALERT URGENT finding is created.

This detects cases where a manually edited value reverts or overrides a Helios-approved change — a pattern that can indicate either an error or a deliberate clinical decision that should be formally documented.

### 5.7 Geographic Signal

The geographic signal engine reads recent successful `search_logs` and groups searches by matched variant, counting unique hospitals and countries. Variants searched from 2+ distinct hospitals or countries are surfaced as cross-institutional demand signals.

For HIGH urgency signals (3+ hospitals or 3+ countries) on unvalidated or unclassified variants, a REGIONAL_SIGNAL URGENT finding is automatically created in the inbox.

### 5.8 Clinician Decision Flow

```
Helios finding created (URGENT or ROUTINE)
       ↓
Clinician opens inbox, reviews reasoning + confidence + diff
       ↓
       ├── Approve → heliosApplyDBChange() writes to variants
       │             heliosWriteAudit() records decision
       │
       ├── Approve & Sign → same as approve, requires written note
       │
       ├── Mark Exceptional → writes class_subtype = 'exceptional'
       │                       suppresses future flags for this variant
       │                       requires written clinical justification
       │
       ├── Reject → status = rejected, note recorded
       │
       └── Defer → status = deferred, deferred_until = tomorrow
                   defer_count incremented
                   automatically resurfaced when deferred_until passes
```

---

## 6. Search Intelligence Layer

### 6.1 Session Architecture

Each browser session receives a random `session_id` (`sess_` + 8 random alphanumeric characters). This identifier is used throughout the session for search logging without requiring authentication — it provides session-level aggregation without tracking individuals.

### 6.2 Geographic Enrichment

On first search within a session, `fetchLocationOnce()` makes a single request to `https://ipapi.co/json/` to retrieve country, region, city, and coordinates. The result is cached in `STATE.searchIntelligence.locationCache` for the rest of the session. All subsequent search log entries in that session carry the same geographic context without additional API calls.

### 6.3 Hit/Miss Logging

Every settled search (after 1200ms debounce) generates a `search_logs` entry. For misses, the query is also upserted into `search_miss_queue` using PostgreSQL `ON CONFLICT (query) DO UPDATE` to maintain a running count without duplicates.

The separation between UI debounce (180ms) and log debounce (1200ms) is intentional — it prevents every partial keystroke from generating a log entry while keeping the UI responsive.

### 6.4 Search Intelligence Dashboard

The analytics dashboard reads accumulated `search_logs` and `search_miss_queue` data to render:

- Hit rate over time (timeline chart)
- Top hit variants (bar chart)
- Top miss queries (signal list)
- Geographic distribution (map with clustering by country/city)
- Hospital-level breakdown

---

## 7. Geographic Intelligence

### 7.1 Search Log Geographic Data

Every search event carries: `country`, `region`, `city`, `latitude`, `longitude`, `hospital_name`. The combination of these fields allows analysis at multiple granularity levels — from individual hospital queries to country-level demand patterns.

### 7.2 Geographic Map Rendering

The geo tab aggregates `search_logs` geographically, clustering points by proximity. Each cluster shows:
- Dominant CFTR class searched in that region
- Hit rate for that region
- Number of distinct hospitals
- Most searched variants

This allows epidemiological insight — identifying geographic regions with high search demand for specific variant classes, which may indicate local population genetics or referral patterns.

### 7.3 Cross-Institutional Demand Signal

The `heliosRunGeoSignal()` function operates on matched searches (hits), not misses. It identifies variants that are actively used clinically across multiple institutions — this is a different signal from the miss queue, which captures unrecognised variants. A variant that is found in the database but searched from 5 different countries is a signal that it warrants priority validation and evidence enrichment, even if it's already classified.

---

## 8. Security Model

### 8.1 Supabase Row Level Security

The Supabase project has Row Level Security (RLS) enabled. The publishable key embedded in the application grants read access to public variant data and write access to search logs and Helios review queues. It does not grant direct write access to the `variants` table from the client.

All modifications to `variants` go through Helios's `heliosApplyDBChange()` function, which is only called after explicit clinician approval of a pending review item. This is an application-layer constraint, not a database-layer constraint.

For production environments with expanded user bases, backend proxy pattern should be implemented — the current publishable key is appropriate for a trusted clinical environment with known users.

### 8.2 Audit Immutability

The `helios_audit_log` table records every clinician decision with:
- `review_snapshot` — the full state of the pending item at decision time (JSONB)
- `clinician_name` — from localStorage institution identity
- `clinician_role` — role string from the validation modal
- `db_change_field` / `db_change_old` / `db_change_new` — field-level change record
- `created_at` — timestamp

The audit log is append-only — Helios never updates or deletes audit entries. This provides a complete history of all data changes that passed through the review workflow.

---

## 9. Performance Characteristics

### 9.1 Variant Loading

Variants are loaded in paginated batches of 500, with evidence links joined inline (`select=*,evidence_links(*)`). A 2,237-variant database loads in approximately 3–4 requests with typical response times of 300–600ms per page on the Supabase free tier.

### 9.2 Search Performance

The inverted index allows O(n) search where n is the number of terms in the index (not the number of variants). With approximately 3–4 indexed terms per variant and prefix stripping doubling the term count, a 2,237-variant database produces roughly 15,000–20,000 index entries. The `includes()` scan over this set completes in under 5ms in typical browsers.

### 9.3 Helios Scan Performance

The internal consistency scan iterates all variants sequentially. To avoid blocking the event loop, it yields every 20 variants using `await new Promise(r => setTimeout(r, 50))`. A 2,237-variant scan takes approximately 5–8 seconds at this throttle rate, which is appropriate given that scans are not real-time operations.

External scans (PubMed) impose a 350ms delay between requests to respect NCBI Entrez rate limits (3 requests/second for unauthenticated access, 10/second with an API key).

### 9.4 Calibration Load

The calibration engine makes two parallel requests on Helios open: one to `helios_audit_log` (limit 500) and one to `helios_pending_review` (limit 500). Both resolve in under 400ms typically. Calibration data is cached in `HELIOS.calibration` for the duration of the session — it does not reload on each inbox refresh.

---

## 10. Deployment

### 10.1 Current Setup

- Source: single `index.html` file (approximately 11,500 lines)
- Hosting: GitHub Pages, served from repository root or `/docs` folder
- Domain: `[username].github.io/[repository-name]`
- HTTPS: enforced by GitHub Pages (required for IP geolocation API)

### 10.2 Supabase Configuration

Required tables: `variants`, `evidence_links`, `search_logs`, `search_miss_queue`, `validation_history`, `helios_pending_review`, `helios_audit_log`, `helios_bot_runs`, `helios_monitor_targets`, `research_gaps`

CORS origins to add in Supabase Dashboard → API Settings:
```
https://[username].github.io
```

### 10.3 Known Limitations

**Single file architecture** — the current codebase is a single HTML file of approximately 11,500 lines. This works well for the current stage but will require modularisation (ES modules or a bundler such as Vite) as the codebase grows beyond one developer.

**Client-side key** — the Supabase publishable key is embedded in the HTML. This is acceptable for a trusted clinical environment with RLS enabled, but should be replaced with a backend proxy pattern before any public-facing deployment.

**Session identity** — clinician identity is stored in `localStorage` as a self-reported institution name. This is appropriate for the current collaborative environment but is not an authentication system. For regulated clinical use, integration with an identity provider (e.g. NHS login, hospital SSO) would be required.

**PubMed rate limits** — the NCBI Entrez API allows 3 unauthenticated requests per second. The external scan is throttled accordingly. For higher-volume scanning, registering for an NCBI API key increases this to 10 requests/second.

---

*Document version: 1.0 | Platform version: 3.0.0-PRODUCTION | Last updated: April 2026*
