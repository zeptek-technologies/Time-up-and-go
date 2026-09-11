# TUG UI preservation contract

## Evidence and scope
The user requested a visual redesign with existing behavior preserved. README.md identifies gait-web as the maintained dashboard. Existing lib/firebase.ts, hooks/useTugData.ts, lib/liveStage.ts and lib/tugRisk.ts define the current data behavior. This change does not redefine permissions, retention, deletion semantics, assessment thresholds or ESP commands. Firmware changes in the working tree predate this task and are excluded from the web backup/redesign commits.

## Canonical UI Map
| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Navigation | Header.tsx, lib/navigation.ts, App.tsx | Existing single-page section order | Desktop rail / compact top navigation | Browser section jumps and route links |
| Select/Listbox | Native select in existing components | Existing platform-owned input behavior | Native popup | Keyboard and open popup |
| Date | Existing native inputs | PatientManagementPage.tsx | Native | Existing behavior retained |
| Form | PatientManagementPage.tsx | Existing CRUD calls | Create / edit | Read-only modal inspection |
| Scrollbar | gait-web/src/redesign.css | DESIGN.md | Horizontal nav and local tables | Computed styles, narrow screen |
| CRUD | hooks/useTugData.ts and lib/firebase.ts | Existing implementation | Existing routes | No service changes in redesign diff |

## Flow ledger
- Overview → choose a patient → camera section. Section jumps never unmount recording components. Selecting a patient retains its existing active-subject side effect.
- Manage patients → ?view=patients → existing create/edit workflow → owning registry. Return link goes to dashboard.
- Device status → ?view=live-status in new tab; stage transitions remain owned by liveStage and device hooks.
- Records filtering remains local; sensitive patient query text is not newly put into URLs.
- No recording, deletion, board reset, patient creation, or production upload is executed during visual QA.

## Existing debt and limits
Baseline eslint: 5 errors and 1 warning, including Header's mixed exports; this redesign removes that Header violation by extracting navigation constants. Other baseline hooks/camera findings remain outside the visual change.
Existing browser confirm/alert flows and some form accessibility patterns are legacy debt. They are not a canonical choice for new features; replacing them is a separate behavior migration. No claim of complete Premium compliance or full hardware end-to-end verification is made.

## Rollback
GitHub branch codex/web-backup-2026-09-11, commit cb5eba3, stores the current web before redesign. The redesign is isolated on codex/tug-web-redesign. Credentials and firmware archives are not included in this web snapshot.

## Dataset browsing contract
- Canonical owners: components/Pagination.tsx (range, size and previous/next), components/DataSearch.tsx (search and clear), components/DataViewport.tsx (scroll reset), hooks/usePagination.ts and lib/pagination.ts (page boundaries).
- Patient list, results and disease assessment list use the same 5/10/20 choices and default to five items per page. Counts and clinical summaries always use the full subscribed data, irrespective of page/filter.
- Existing Firestore subscriptions remain unchanged; this is client-side display pagination, not a reduction in database reads. Intentional for preserving realtime summaries/assignment behavior in the current architecture.
- Pagination/search is in-memory and independent per section; section navigation retains it because sections remain mounted. Sensitive searches are not persisted in the URL or storage. Full route reload resets browsing controls.
- New search/filter or page size returns to page one; removal clamps to the last valid page. No-results is page 1/1 with disabled navigation. Clear restores results immediately and focuses the search input.
- Local search filters text only; no submit, remote request, or mutation is fired during IME composition. Patient selection remains independent of the displayed page and the full selector remains available.
- Scrolling resets inside the list after changing pages/filters/size; keyboard focus stays at the control. Pagination is outside the scrolling list. Printing expands the current page only; its range remains visible.
- Verification: gait-web/tests/pagination.mjs covers 100 patients, 100 results, 120 assessments and boundary conditions with synthetic data only. Browser checks use read-only interactions with existing data.

## Device settings contract (2026-09-11)
- Canonical owners: components/DeviceSettingsSection.tsx (UI), lib/deviceConfig.ts (defaults, limits, validation), lib/firebase.ts saveChairDistances/saveCheckpointDistances/subscribeDeviceConfig, hooks/useDeviceConfig.ts. Firmware limits (CFG_* in both .ino files) must match lib/deviceConfig.ts.
- Data flow: the web writes requested values (cfg_sit_cm, cfg_stand_cm / cfg_detect_cm, cfg_set_at) into the existing device_commands/<board> documents that boards already poll; no new collection, rules or reads. Boards validate, persist to NVS and report applied values plus latest distance_cm in device_status/<board>. The UI compares saved vs applied values to show pending/applied/offline/old-firmware states.
- Boards never switch thresholds mid-trial; a saved value is applied on the first poll after the trial ends. Invalid values are rejected by both the form and the firmware.
- Form fields follow Firestore until the user edits (draft); cancel restores the live value. Saving is the only mutation; there is no confirmation dialog because the change is reversible and confined to sensor thresholds.
- Cooldown countdown: hooks/useCooldownCountdown.ts derives the remaining time from chair state_since + cooldown_sec, falling back to first-seen time + 15 s for older firmware, clamped to the cooldown length.
