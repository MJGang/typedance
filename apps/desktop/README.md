# TypeDance Desktop

This is the Tauri 2 shell boundary for TypeDance.

Slice 1 keeps desktop packaging thin:

- Web UI runs from `apps/web`.
- FastAPI sidecar runs during development with `corepack pnpm --filter @typedance/sidecar dev`.
- Bundled sidecar binary packaging is configured but not produced until the sidecar is ready for release packaging.
- `cargo check` validates that `src-tauri/binaries/typedance-sidecar-<target-triple>` exists when `externalBin` is configured. Slice 1 does not build that binary yet, so Rust verification is limited to configuration review until the sidecar packaging task lands.

Tauri commands must stay limited to OS integration, app paths, dialogs, sidecar lifecycle, and file reveal/open operations. Resume business logic belongs in `services/sidecar`.
