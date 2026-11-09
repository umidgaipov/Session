# Project: Session — Statistics Mobile Test Platform

## Architecture
- Static Single-Page Application (SPA) / PWA for Economic Statistics tests (152 questions total).
- Modern Vanilla stack: HTML5 semantic markup, CSS3 custom properties with Quiet Confidence theme + 44px ambient-grid, modular Vanilla ES JavaScript.
- Offline-First: Service Worker (`sw.js`) caching all assets and JSON datasets, `localStorage` state management for test answers and progress.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Mobile-First UI & Design System | Quiet Confidence tokens, 44px grid overlay, 320-430px layout, zero horizontal scroll | Stage 1 (Step 1.1, 1.2) | plan.md § 1 |
| 2 | Question Card & Touch Ergonomics | 48-56px touch target options, tag badge, context block, condition formatting | Stage 1 (Step 1.2) | plan.md § 1.2 |
| 3 | Question Engine & Navigation | Loading 95 situational + 57 practical tests, category tabs, prev/next, question grid drawer | Stage 2 (Step 2.1) | plan.md § 2.1 |
| 4 | Answer Evaluation & LocalStorage | Instant check, soft tone highlight, detailed explanation accordion & distractor trap analysis, auto-save to localStorage | Stage 2 (Step 2.2) | plan.md § 2.2 |
| 5 | Offline-First & Service Worker | Cache-First sw.js for subway offline usage, 100% offline persistence | Stage 2 (Step 2.2) / Stage 3 | plan.md § 2.2, 3.1 |
| 6 | Mobile Polish & PWA | No 300ms delay, touch-action, webmanifest, theme-color, formula rendering | Stage 3 (Step 3.1) | plan.md § 3.1 |
| 7 | CI/CD & GitHub Pages Deploy | GitHub Actions workflow, custom domain CNAME, HTTPS | Stage 3 (Step 3.2) | plan.md § 3.2 |
| 8 | Telegram Live Deployment Notification | Send deployed site URL via bot from D:\projects\kmmt admin using credentials from .env | Stage 3 (Step 3.2) | User follow-up |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Stage 1: UI Skeleton & Card | Semantic `index.html`, header, question card, option targets, matching `styles.css` | none | DONE |
| 2 | Stage 2: Test Engine & Offline | `app.js` test engine, JSON loader, checking, explanations, LocalStorage, `sw.js` | Stage 1 | DONE |
| 3 | Stage 3: Polish, Deploy & Notify | Touch interactions, PWA manifest, GitHub Actions workflow, Telegram notification | Stage 2 | IN_PROGRESS |

## Code Layout
- `index.html` — primary mobile entry point, semantic markup, viewport meta.
- `assets/css/styles.css` — design tokens, 44px ambient-grid, responsive layout, touch states.
- `assets/js/app.js` — test runner, event listeners, state store, UI renderer.
- `situational_tests.json` — 95 situational questions dataset.
- `practical_tests.json` — 57 calculation questions dataset.
- `sw.js` — Service worker for offline caching.
- `site.webmanifest` — PWA manifest.
