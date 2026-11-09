\---

name: Quiet Confidence
colors:
surface: '#fbf9f8'
surface-dim: '#dbdad9'
surface-bright: '#fbf9f8'
surface-container-lowest: '#ffffff'
surface-container-low: '#f5f3f3'
surface-container: '#efeded'
surface-container-high: '#e9e8e7'
surface-container-highest: '#e4e2e2'
on-surface: '#1b1c1c'
on-surface-variant: '#4c4546'
inverse-surface: '#303031'
inverse-on-surface: '#f2f0f0'
outline: '#7e7576'
outline-variant: '#cfc4c5'
surface-tint: '#5e5e5e'
primary: '#000000'
on-primary: '#ffffff'
primary-container: '#1b1b1b'
on-primary-container: '#848484'
inverse-primary: '#c6c6c6'
secondary: '#5f5e5e'
on-secondary: '#ffffff'
secondary-container: '#e2dfde'
on-secondary-container: '#636262'
tertiary: '#000000'
on-tertiary: '#ffffff'
tertiary-container: '#1b1b1b'
on-tertiary-container: '#848484'
error: '#ba1a1a'
on-error: '#ffffff'
error-container: '#ffdad6'
on-error-container: '#93000a'
primary-fixed: '#e2e2e2'
primary-fixed-dim: '#c6c6c6'
on-primary-fixed: '#1b1b1b'
on-primary-fixed-variant: '#474747'
secondary-fixed: '#e5e2e1'
secondary-fixed-dim: '#c8c6c5'
on-secondary-fixed: '#1c1b1b'
on-secondary-fixed-variant: '#474746'
tertiary-fixed: '#e2e2e2'
tertiary-fixed-dim: '#c6c6c6'
on-tertiary-fixed: '#1b1b1b'
on-tertiary-fixed-variant: '#474747'
background: '#fbf9f8'
on-background: '#1b1c1c'
surface-variant: '#e4e2e2'
background-warm: '#FAFAF8'
surface-white: '#FFFFFF'
border-subtle: '#ECECEC'
typography:
headline-lg:
fontFamily: Inter
fontSize: 72px
fontWeight: '700'
lineHeight: '1.1'
letterSpacing: -0.02em
headline-lg-mobile:
fontFamily: Inter
fontSize: 48px
fontWeight: '700'
lineHeight: '1.1'
letterSpacing: -0.02em
headline-md:
fontFamily: Inter
fontSize: 48px
fontWeight: '600'
lineHeight: '1.2'
letterSpacing: -0.01em
headline-sm:
fontFamily: Inter
fontSize: 32px
fontWeight: '600'
lineHeight: '1.3'
letterSpacing: -0.01em
body-lg:
fontFamily: Inter
fontSize: 20px
fontWeight: '400'
lineHeight: '1.7'
body-md:
fontFamily: Inter
fontSize: 18px
fontWeight: '400'
lineHeight: '1.7'
label-md:
fontFamily: Inter
fontSize: 14px
fontWeight: '600'
lineHeight: 20px
letterSpacing: 0.05em
rounded:
sm: 0.25rem
DEFAULT: 0.5rem
md: 0.75rem
lg: 1rem
xl: 1.5rem
full: 9999px
spacing:
section-gap: 140px
gutter: 24px
margin-desktop: 80px
margin-mobile: 20px
stack-sm: 8px
stack-md: 16px
stack-lg: 32px
---

## Brand \& Style

The design system is built on a foundation of "Quiet Confidence"—a philosophy that prioritizes substance over flash. It is designed for a premium web design studio where the work is the focal point, and the UI acts as a precise, invisible frame.

The aesthetic is **Extremely Minimalist**, drawing from the structural integrity of Linear and the effortless sophistication of Apple. It avoids all forms of visual "noise"—there are no gradients, no shadows, and no glassmorphism. Instead, the system relies on perfect alignment, generous whitespace (negative space as a luxury), and a monochromatic palette to convey intelligence and technical mastery. The emotional response should be one of immediate clarity, profound trust, and a sense of architectural permanence.

## Colors

This design system utilizes a high-contrast, monochromatic palette that favors warm-white over clinical starkness to maintain a premium feel.

* **Primary \& Accent:** Solid Black (#000000) is used for the most critical actions and primary brand marks.
* **Text:** Almost Black (#1A1A1A) provides high legibility for long-form content, while Neutral Gray (#6B6B6B) manages the hierarchy of supporting information.
* **Surface:** The background is a refined Warm White (#FAFAF8), creating a soft canvas that prevents eye strain, while Cards use pure White (#FFFFFF) to subtly lift off the page via color contrast rather than shadows.
* **Borders:** A consistent, very light gray (#ECECEC) is used for structural definition.

## Typography

The typography uses a single typeface, **Inter**, to maintain a systematic and utilitarian feel. Hierarchy is established through extreme scale and weight shifts rather than font pairings.

* **Scale:** Headlines are intentionally oversized to command attention and create a modern, editorial rhythm.
* **Readability:** A high line-height (1.7x for body text) is enforced to ensure the content feels breathable and accessible.
* **Tracking:** Headlines use tight negative letter-spacing to appear more cohesive, while labels use expanded tracking and uppercase transformations for clear categorizing.

## Layout & Spacing

The layout philosophy is centered around "Air." This design system uses a **Fixed Grid** on desktop (12 columns, max-width 1480px) to ensure a controlled, premium reading experience.

* **Vertical Rhythm:** Sections are separated by vertical margins (80px to 120px). This forces the user to focus on one piece of content at a time.
* **Reflow:** On mobile, margins shrink to 16–20px, and vertical gaps compress to 60–80px, but the commitment to whitespace remains the primary design driver.
* **Precision:** All elements align to a strict grid to maintain visual harmony.

## Mobile-First Responsiveness & Synchronization

* **Mandatory Mobile Adaptation:** The website must be fully adaptive and flawlessly usable across all mobile devices (from 320px width up to 768px).
* **Synchronized Versioning:** ANY modification, addition, or refactoring of the site (desktop view, components, sections, copy, or styles) MUST simultaneously update and adapt the mobile layout. Desktop-only changes without full mobile parity are strictly forbidden.
* **Touch Optimization:** All interactive elements (buttons, form inputs, toggle buttons, modal triggers) must maintain a minimum touch target size of 44x44px with adequate touch spacing.
* **Mobile Fluidity & Zero Horizontal Scroll:** No component or text block may cause horizontal scrolling on mobile viewports. Grids collapse to single columns, stats cards stack cleanly, and card paddings adjust dynamically to mobile screens.

## Elevation & Depth

The design system employs **Subtle Tonal Layering** and **Crisp Outlines** complemented by minimal elevation shadows and glassmorphism backdrop blurs.

* **Surface Strategy:** The Warm White (`#FAFAF8`) background serves as the base layer. Pure White cards sit on top, differentiated by `#ECECEC` borders and soft ambient shadows (`0 8px 24px rgba(0,0,0,0.04)`).
* **Glassmorphism Accents:** Sticky navigation and section backgrounds use subtle `backdrop-filter: blur(12px..20px)` and semi-transparent surfaces to maintain focus and depth while scrolling.

## Shapes

The shape language is "Apple Aesthetic Geometric." While the overall system is structured, Apple-style pill buttons and container rounding are applied to soften edges.

* **Standard Radius:** A base of 8–14px is used for small elements and cards.
* **Large Radius:** Cards and primary containers use 20–28px to create a clear containerization of content.
* **Interactive Radius:** Pill buttons use `9999px` (`var(--radius-pill)`), providing a distinct, approachable silhouette.

## Components

### Buttons

Primary buttons are solid `#000000` with white text and pill radius (`border-radius: 9999px`). Height is 56px. Secondary buttons use a 1.5px `#1B1C1C` border with black text.

### Cards

Cards use white background (`#FFFFFF`), subtle `1px` border, and `14px–28px` corner radius. Hover states add subtle elevation lift (`translateY(-3px)`).

### Input Fields

Inputs are large (56px height) with pill border radius and subtle border. When focused, the border transitions to dark.

## Grid System

Desktop:
- Max width: 1480px
- 12-column grid
- 24px gutters
- 40px side margins

Tablet:
- 8-column grid
- Responsive spacing

Mobile:
- 4-column grid
- 16–20px side margins

All elements align precisely to the grid.



Never break alignment for visual decoration.



\---



\## Motion System



Motion should feel invisible.



Animations exist only to improve clarity.



Transitions:

\- Duration: 150–250ms

\- Easing: ease-out



Hover:

\- Slight opacity change

\- Optional scale from 1 → 0.98



Entrance:

\- Fade

\- Small translateY (8–16px)



Never use:



\- bounce

\- elastic

\- spring

\- rotating elements

\- exaggerated parallax

\- long animations



\---



\## Iconography



Icons should support information, not decorate it.



Use:



\- Lucide Icons

\- Outline style

\- 24px

\- 1.5px stroke

\- Monochrome only



Avoid:



\- filled icons

\- colorful icons

\- oversized icons

\- decorative icon sets



\---



\## Imagery Rules



Only use imagery that reinforces credibility.



Preferred:



\- Real website screenshots

\- UI close-ups

\- Browser mockups

\- Minimal workspace photography

\- Product-focused imagery



Avoid:



\- Stock people

\- Business handshakes

\- Fake office meetings

\- AI-generated illustrations

\- 3D graphics

\- Abstract shapes

\- Decorative renders



Images should document work, not decorate the page.



\---



\## Design Tokens



Radius



\- Small: 8px

\- Medium: 12px

\- Large: 16px

\- Pill: 9999px



Spacing



\- XS: 8px

\- SM: 16px

\- MD: 24px

\- LG: 40px

\- XL: 80px

\- XXL: 140px



Borders



\- 1px solid #ECECEC



Buttons



\- Height: 56px

\- Horizontal padding: 32px



Cards



\- Padding: 40–48px



\---



\## Success Criteria



The interface should never compete with the content.



If users notice the visual effects before they understand the message, the design has failed.



Every design decision must improve one of the following:



\- clarity

\- readability

\- trust

\- navigation

\- conversion



When choosing between beauty and clarity, always choose clarity.



The final website should feel like a finished digital product rather than a portfolio concept.



It should resemble the product quality of Apple, Linear, Stripe and Notion—not a typical Dribbble agency concept.

