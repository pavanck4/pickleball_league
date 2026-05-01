# Pickleball League Manager

A round-robin tournament manager for pickleball leagues — built with vanilla HTML, CSS, and JavaScript. No frameworks, no build step.

## Features

- **Fixed Partners** — Teams of 2 stay together all league. Team standings tracked.
- **Rotating Partners** — Partners change each round. Individual player rankings tracked.
- **Persistent storage** — Scores and full league setup auto-saved to localStorage. Survives page refreshes.
- **Reset league** — One-click reset to start a fresh tournament.
- Smart scheduling — tries to pair teams against new opponents each round.
- Score validation — winner must reach 11+ points with a 2-point lead.
- Live standings with tiebreakers: league points → score difference → total scored.
- Fully responsive design — works on mobile and desktop.

## Usage

Open `index.html` in any browser — no build step or server required.

## Deployment

Deployed on Vercel. Any push to `main` triggers a new deployment automatically.
