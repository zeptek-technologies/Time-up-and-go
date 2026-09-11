# Web redesign verification — 2026-09-11

## Backup and scope
Web backup pushed before editing: `codex/web-backup-2026-09-11`, commit `cb5eba3`.
Changes are isolated on `codex/tug-web-redesign`. Firmware and archives remain local and untouched by this change. No deployment was performed.

## Passed
- `npm run build` from gait-web: TypeScript and production build pass. Existing >500kB chunk warning remains.
- `npx eslint src/App.tsx src/components/Header.tsx src/lib/navigation.ts`: passes.
- `git diff --check`: passes.
- Real browser: 1440px desktop, 1280px laptop, 390px mobile. Navigation has all 8 destinations. No horizontal document overflow after correcting the filter layout and positioning the external-link screen-reader text.
- Overview displays existing Firestore results and risk distribution; initial empty/loading view also observed.
- Navigation scrolls to overview with a 28px desktop top margin; mobile content clears the header.
- Record search no-match state appears; clearing restores data. Low-risk filter produces the matching subset (14 rows in the currently loaded dataset).
- Patient registry loads, create form opens, native select receives keyboard focus, close returns to registry. No record was submitted or deleted. Native popup pixels are platform-owned and were not captured in the screenshot.
- Live-status screen renders actual offline state and recovery instructions at 390px.
- Global computed scrollbar color uses documented palette aliases.
- New controls retain native semantics, labels, and focus indication. Reduced-motion CSS and programmatic scrolling branch are implemented; OS preference switching was not exercised.

## Limits / existing findings
Full baseline lint had 5 errors and 1 warning before the redesign. Header's mixed-export error is fixed; existing CameraView/useCameraDevices/useDeviceStatus issues are not modified.
Strict Premium audit: 3 findings, 0 unresolved ownership. Form noValidate is absent in the pre-existing patient form (native validation intentionally retained in this visual change); textarea and scrollbar static findings do not follow the final shared CSS adapter. The global adapter defines textarea geometry and both standard scrollbar properties, verified for the root in browser. The report is preserved in premium-audit.json; this is not a claim of full Premium compliance.
Hardware was offline. Live camera recording, ESP round trips, create/edit/delete persistence, and uploads were not exercised against production. Firebase hooks, services, assessment logic, and camera components are identical to the web backup. No project-owned test or formatter script exists.
