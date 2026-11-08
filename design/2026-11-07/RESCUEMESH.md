# RescueMesh

This is the current owner-directed product/design brief. It supersedes manual-handoff decisions in PREMISE.md and earlier storyboard artifacts. Existing directory and protocol identifiers remain technical compatibility details; the product name is **RescueMesh**.

## Owner decisions

- Product name: RescueMesh.
- T-Mobile-inspired magenta, white and near-black palette. Chosen action/selection token #E20074, quiet pink selection #FCE6F1, ink #18181B, readable gray #626268. Official visual reference: [T-Mobile brand assets](https://www.t-mobile.com/news/brand-assets). This is a color nod, not a T-Mobile logo or affiliation claim.
- Professional, restrained application composition. No slash-separated headings, decorative AI-looking prefixes, metric-card walls or generic chat feeds.
- The OLED display concept is accepted. Preserve its monochrome utility and courier; update the product name where it appears.
- ECSW and the supervisor manage and transform information **automatically**. Receiving a report must not require someone to press Request regional support or approve every exchange.

## Automatic path

`Phone report → ECSW authenticated intake → validate immutable source → produce structured case/summary → durable outbound event → supervisor coordination → allocation/update event → ECSW case update`

The local agent preserves category, sender severity, people count, original note and location provenance. It may extract a need from source spans, identify missing fields, consult the region resource catalog and produce a bounded structured summary. It must not invent coordinates, change sender priority or silently replace the original.

The hub automatically shares only policy-allowed structured fields with the supervisor. The report, receipt and coordination case remain distinct objects. Stable IDs, durable queue, deduplication and acknowledgments protect retried events. Loss of internet does not block local radio intake.

The supervisor automatically coordinates policy-eligible demo cases among three simulated towns, updates resource counts and records simulated service dispatch. Local and supervisor agents exchange case/event updates, not free-form private reasoning or the hub's decryption keys.

## Human role

People inspect evidence, correct uncertain information, handle shortages/conflicts/stale hubs, override allowed decisions, and pause automation. Ordinary receipt, information transformation and inter-hub exchange proceed without a per-case manual handoff gate.

**Automatic agent processing is not a human review.** The phone may receive hub-received evidence. An operator-reviewed receipt requires an actual explicit human review action. It never follows automatically from a model step or regional acceptance. Existing wire receipts do not convey responder arrival or verified emergency-service dispatch.

## The visible product

Phone: ask for help and see the actual receipt state. ECSW: original need/place plus a concise current automatic coordination state. Supervisor: one need/offer pair with ordinary activity/history available on demand. On normal work, an interface can have no primary filled action; do not invent a button merely to fill space.

Use one synthetic water request consistently: category supplies, sender severity assistance, two people near Hoblitzelle, no GPS. Regional example requests two water kits; Plano stock 8 → 6 after allocation; shortage starts at one kit; Garland alternate 4 → 2. Locations/maps remain schematic and explicitly uncertain where the source is uncertain.

## Scope of this packet

Generated concepts and a static clickable journey. No actual Nemotron/Atlas/Brev/Cloudflare migration or new agent dispatch service is certified by these artifacts. The current radio system and public source remain separate from this proposed automatic architecture until implemented and verified.
