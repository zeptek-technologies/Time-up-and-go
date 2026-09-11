---
version: alpha
name: TUG Care Board
description: Thai gait assessment workspace retaining the hospital blue identity.
colors:
  primary: '#2563eb'
  background: '#f0f7ff'
  surface: '#ffffff'
  text: '#0f172a'
  secondary: '#64748b'
  border: '#e2e8f0'
typography:
  sans:
    fontFamily: 'Inter, Noto Sans Thai, system-ui, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: '10px'
  lg: '16px'
spacing:
  section-gap: '36px'
  page-max: '1440px'
components:
  button: {}
  card: {}
  navigation: {}
  table: {}
  input: {}
---

# TUG Care Board Design System

## Overview

### Creative North Star
A care station: a persistent equipment/navigation rail next to a patient assessment workspace. The visual signature is the fixed blue-accented instrument rail, with current measurement and caseload distribution sharing a single summary surface.

### Product context and register
Thai-speaking staff using the existing TUG research prototype (README.md), desktop for two camera views, phone for review, dedicated second screen for device instructions. Thai copy with existing English instrument labels; no Japan-market scope evidenced. Preserve the single scrolling dashboard and all mounted camera state. Avoid marketing imagery, decorative clinical claims, or invented readings. The redesign is authorized by the 2026-09-11 request.

Runtime color source: gait-web/src/dashboard.css. This document mirrors its established palette. gait-web/src/redesign.css is the final shared visual adapter imported by App.tsx, owning geometry and aliasing existing colors. Existing camera and stage-specific semantic tokens retain their meanings. No generated token pipeline exists.

## Colors
Primary blue #2563eb marks actions and active navigation. Background #f0f7ff surrounds white #ffffff task surfaces. Text #0f172a, supporting text #64748b and borders #e2e8f0 retain the existing identity. Risk colors remain data-driven from dashboard.css; never use them to imply a result that was not measured. Focus and scrollbar colors alias primary palette tokens. Forced-colors uses system scrollbar and highlight colors.

## Typography
Keep loaded Inter and Noto Sans Thai, with system fallbacks; no extra font requests. Headings use bold Thai-capable sans, body uses normal sans, measured values use existing tabular numerals. Use generous Thai line height and restrained letter spacing. Main title 1.65–2.3rem; section headings 1.25rem; helper text approximately .8rem. Do not change measured numeric formatting.

## Layout
At 1180px and above use a 238px fixed navigation rail with independently scrollable contents. Below that, the two-row header and visible horizontally scrollable navigation retain all destinations. Main content remains document-scrolled, max-width 1440px, padding 32px desktop and 18px narrow. Section gap 36px. Summary switches to one column at 760px; metric rail to stacked rows at 480px. Tables keep their existing local overflow and camera elements remain mounted. Do not fix the height of form pages.

## Elevation & Depth
White task surfaces, subtle borders and existing small shadows. No decorative gradients or floating marketing cards. Overlays retain their established stacking. Header is solid white for readable status.

## Shapes
Shared panel radius 16px, fields and actions 10px. Brand mark uses a 14px radius. Risk dots and existing badges retain semantic geometry.

## Components

### Foundational visual states
Blue focus ring on keyboard focus; primary hover uses existing darker blue; disabled actions retain native disabled behavior and unavailable cursor. Preserve existing pending, empty, error, and populated branches and device status labels.

### Buttons and actions
Keep real buttons for actions and links for routes. Use existing btn, gc-btn and device-reset owners; primary buttons have 42px minimum height. Navigation adds aria-current. A skip link targets the main content. No new data mutations.

### Navigation and data display
Header owns shared navigation; lib/navigation.ts owns section order and keys. Desktop rail keeps equipment status at the bottom and two separate external destinations. Latest result, distribution and summary counts retain OverviewSection computations. Camera shortcut calls the same navigation handler.

### Forms and overlays
Existing native select/date ownership stays platform-owned, including popup shape and keyboard handling. PatientManagementPage remains form owner; no behavioral migration in this visual change. Existing native confirmation debt is recorded in UX-CONTRACT.md, not endorsed as a new standard.

### Iconography
Small inline stroke SVG navigation icons; preserve existing Icons.tsx elsewhere. Every icon has adjacent text; purely decorative icons are hidden from assistive technology.

### Motion
Short existing transitions only. Reduced-motion disables transitions/animations and switches programmatic section scrolling to instant.

### Content and data visualization
Preserve Thai labels, data semantics and clinical caveats verbatim. Risk bars have text alternatives. Do not replace missing data with synthetic examples in the application.

## Do's and Don'ts
- Do preserve all mounted camera and Firestore behavior.
- Do reuse the shared palette and semantic stage colors across the registry and live screen.
- Don't introduce decorative medical assertions or alter risk thresholds.
- Don't hide scrollbars or remove narrow-screen destinations.

## Bounded datasets (2026-09-11)
The dashboard's patients, TUG records and disease assessments share Pagination, DataSearch and DataViewport. Default 5 items, choices 5/10/20; filter the entire subscribed dataset before slicing. Patient viewport 320px, result viewports 440px, including on mobile. Only these list surfaces scroll; headings, filters, pagination and selected patient remain outside. No page-shell height restriction. Table headers stick within the table on desktop; existing labeled record cards remain on mobile. Fixed geometry preserves the footer position on short/empty pages; row entrance animation is disabled during page changes. All palette values reuse the existing tokens.
