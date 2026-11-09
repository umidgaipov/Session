# Session — Statistics Test Platform Project Instructions

## Language & Output

Mobile-first web test platform for Economic Statistics based on Quiet Confidence design.

Think and plan in English without exposing chain-of-thought. Reply in Russian unless explicitly requested otherwise. Lead with the result; report only essential details, checks, risks, or blockers. Skip greetings, narrative recaps, and verbose logs.

Example: after updating card styles, report touched selectors, mobile viewport verification (390px/320px), and status—not the debugging narrative.

## Project Index

Route each task to the narrowest source; this is an index, not documentation.

- `index.html` — primary entry point, semantic markup, viewport & safe-area meta, mobile header, test viewports.
- `assets/css/` — `styles.css` (design tokens from `docs/DESIGN.md`, responsive layout, touch states, zero horizontal overflow).
- `assets/js/` — `app.js` (test engine, 152 questions runner, answer checking, explanation accordion, localStorage persistence).
- `situational_tests.json` & `practical_tests.json` — SSOT question datasets (95 situational + 57 calculation tasks).
- `docs/DESIGN.md` — SSOT for design tokens, typography scale (Inter), and Quiet Confidence style guidelines.
- `plan.md` — 3-stage implementation roadmap (Mobile UI, Test Engine, GitHub Pages deploy).

Example: question state/storage task routes directly to `assets/js/app.js` and `situational_tests.json`.

## Search First, Frugal Reading & Deny Noise

1. Open user-specified file; otherwise `rg` inside the routed directory by selector, symbol, or key.
2. Read minimal slices around targeted logic; never inventory the whole repository.
3. For large datasets or tests (`*.json`), inspect schema and sample questions by line range; avoid reading full 600KB files into context.

Deny by default: `node_modules/`, `.git/`, binary media, audio files (strictly NO sounds/audio effects), and autonomous `browser_subagent`.

Example: styling update → check tokens in `docs/DESIGN.md` → edit `assets/css/styles.css` → test mobile view.

## Project Rules & Mandatory Skills

- **Mandatory Design Skills (Workspace)**: For ANY UI, layout, component, or interaction work, strictly enforce these 3 project skills:
  1. `apple-design` (`.agents/skills/apple-design/SKILL.md`): Fluid touch response on pointer-down (zero latency, no tap delay), interruptible transitions, Apple restraint, and tactile feedback.
  2. `no-ai-design-slop` (`.agents/skills/no-ai-design-slop/SKILL.md`): Anti-slop gate. Zero cheesy gamification, zero sound effects, zero generic purple/blue gradients or floaty cards. Preserve quiet, authoritative aesthetics.
  3. `ui-ux-pro-max` (`.agents/skills/ui-ux-pro-max/SKILL.md`): Flawless mobile UX, 48–56px touch target minimums, strict typography hierarchy, zero horizontal overflow, and accessible contrast ratios.
- **Design Tokens SSOT**: Follow `docs/DESIGN.md` strictly (`#FAFAF8` warm background, `#FFFFFF` cards, `#ECECEC` borders, ambient grid overlay squares 44×44px via `body::before` as in `mysite`, Inter typography, 9999px pill buttons).
- **Mobile-First Priority**: Target 320px–430px viewports with full desktop parity. Zero horizontal scroll across all screen sizes.
- **Data & State (Offline-First)**: 152 questions across 2 categories. Auto-save answers and progress in `localStorage`. Full offline capability via Service Worker (metro-ready, zero network dependency).
- **Clean Native Stack**: Pure HTML5, modern CSS3, and ES modules. No heavy frontend frameworks or unnecessary dependencies.

