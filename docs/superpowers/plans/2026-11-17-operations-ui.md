# Operations UI Implementation Plan

Goal: Implement the approved operations dashboard design using UI UX Pro Max.
Architecture: Preserve Node HTTP API, MongoDB, ThingsBoard, environment and RPC behavior. Change browser presentation and navigation only. Retain plain HTML/CSS/JS.
Spec: Approved design in this chat, 2026-11-17: light green operations dashboard, prioritized alerts, three water metrics, session chart, explicit device outcomes, responsive navigation and technical disclosure.

## Constraints
- Never connect UI tests to live hardware; use demo or intercepted fixture responses.
- No deletion or cleanup; preserve all artifacts.
- Existing working directory is the authorized implementation target; Git metadata is read-only, no commits or branch mutations.

## Tasks
- [x] Add UI tests for status semantics, thresholds, chart extrema and navigation state.
- [x] Implement shared typography, accessible target sizes, responsive sidebar/bottom navigation.
- [x] Implement overview status, prioritized alerts, water metrics, camera/laser and current thresholds.
- [x] Implement local command feedback, Auto confirmation and persistent unknown outcomes without changing API contract.
- [x] Preserve page/filter URL state, focus across polling, forms and disclosure state.
- [x] Verify desktop/mobile rendering and demo behavior; check backend/environment/data remain untouched.

## Review focus
Stale telemetry must not appear live; null data must not become zero; polling must not destroy focus or entered forms; unknown commands must not retry; old sessions must retain gaps and extrema.
