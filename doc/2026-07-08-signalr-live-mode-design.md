# SignalR Live Mode — Design (2026-07-08)

Phase 3 item 1 of doc/2026-07-07-project-review-and-enhancement-plan.md, and
the "optionally move to SignalR after the static-feed migration is stable"
step from doc/2026-07-07-livef1-livetiming-migration-plan.md.

## Problem

Live mode today polls the static feeds every 30 s: each refresh re-downloads
the growing TimingData stream (raw cache TTL 30 s while live), so latency is
up to ~30 s and upstream traffic grows with session length. The official
Livetiming SignalR hub pushes exactly the incremental deltas the normalizers
already understand.

## Protocol (legacy SignalR 1.5, as used by livetiming.formula1.com)

1. **Negotiate** — `GET /signalr/negotiate?connectionData=[{"name":"Streaming"}]&clientProtocol=1.5`
   → `{ConnectionToken, KeepAliveTimeout, ...}` plus cookies that must be
   replayed on the websocket request.
2. **Connect** — `wss://livetiming.formula1.com/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionToken=<url-encoded>&connectionData=[{"name":"Streaming"}]`
3. **Subscribe** — send `{"H":"Streaming","M":"Subscribe","A":[[<feeds>]],"I":1}`.
   The reply's `R` object carries a full snapshot per feed (keyframe
   equivalent); subsequent frames carry `M` arrays of
   `{"H":"Streaming","M":"feed","A":[feedName, payload, utcTimestamp]}`
   deltas. Empty `{}` frames are keepalives. `.z` feeds arrive as the same
   base64/deflate strings `decode_z_payload` already handles.

## Architecture

```
SignalR hub ──ws──> livetiming_signalr.SignalRClient
                      │ snapshot + deltas per feed
                      ▼
              LiveFeedStore (in-memory (elapsed, payload) records,
              same shape as parse_livetiming_stream output)
                      │
                      ▼
   get_cached_livetiming / fetch_livetiming_feed_cached consult the
   store first while the session is live → existing normalizers and
   /api/* contracts stay untouched; frontend polling keeps working
   but reads near-real-time state (later: SSE push to the browser)
```

Key insight: the normalizers consume `(elapsed "HH:MM:SS.mmm", payload)`
records anchored at the stream start. The SignalR `A[2]` UTC timestamp maps
onto that shape via the session's Heartbeat anchor (`utc − stream_start`), so
`records_from_update()` makes push data indistinguishable from static-stream
data — zero changes downstream.

## Scope split

- **Now (this session):** `livetiming_signalr.py` — protocol primitives
  (negotiate/connect URL builders, subscribe frame, message classifier,
  record conversion), `SignalRClient` connect/receive loop with reconnect
  backoff, and a fixture-recording CLI (`python livetiming_signalr.py record
  out.jsonl`) to capture real traffic during the next live session. Fully
  unit-tested against synthetic frames modeled on the documented protocol.
- **Next live weekend:** run the recorder against a real session, validate
  the classifier against actual traffic, then wire `LiveFeedStore` into the
  cache layer behind the `F1_LIVE_SIGNALR=1` env flag, with static-feed
  polling as automatic fallback when the socket drops.

The integration is deliberately deferred: it can only be meaningfully
verified against a live hub, and there is no live session until the next
race weekend.

## Failure model

- Negotiate/connect failure → client raises; caller falls back to the
  existing static-feed path (polling never goes away, it is the fallback).
- Socket drop → reconnect with exponential backoff (1 s → 30 s cap); a
  resubscribe snapshot resyncs state, so missed deltas are harmless.
- Keepalive timeout (no frame for `KeepAliveTimeout` × 2) → force reconnect.
