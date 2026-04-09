# Page Design Spec (Mobile-first)

## Global Design
- Layout: Mobile-first with Flexbox + CSS Grid (card grid switches from 1 column → 2–3 columns on larger screens). Spacing via 8px scale.
- Meta (default):
  - title: "Housekeeping Rooms"
  - description: "Track room cleaning and release readiness."
  - Open Graph: `og:title`, `og:description`, `og:type=website`
- Global Styles (tokens):
  - Colors: background `#0B1220`, surface `#111A2E`, primary `#3B82F6`, success `#22C55E`, warning `#F59E0B`, danger `#EF4444`, text `#E5E7EB`, muted `#94A3B8`.
  - Typography: system font stack; base 16px; headings 20/24/28.
  - Buttons: 44px min height; primary filled; secondary outlined; disabled 40% opacity; hover/active with subtle elevation.
  - Status chips: rounded-pill with color per status.
- Interaction guidelines:
  - All primary actions reachable with thumb (bottom sheet / sticky action bar on mobile).
  - Transitions: 150–200ms for hover/press and drawer/sheet.

---

## 1) Sign-in Page (/login)
- Layout: Centered single-column card on mobile; on desktop, centered panel with subtle illustration area.
- Meta:
  - title: "Sign in"
  - description: "Sign in to manage room statuses."
- Page Structure: Top app name + sign-in card.
- Sections & Components:
  1. Header: product name + short help text.
  2. Sign-in form card:
     - Email input
     - Password input (or magic link toggle if enabled)
     - Primary button: "Sign in"
     - Error banner (inline, dismissible)
  3. Footer: small build/version text (optional) and connectivity indicator.
- States:
  - Loading: disable inputs; show spinner in button.
  - Error: show auth error message.

---

## 2) Rooms Board (/rooms)
- Layout: Mobile-first stacked layout; sticky top bar + scrollable list; bottom action area reserved for quick filters.
- Meta:
  - title: "Rooms"
  - description: "View and update room cleaning workflow."
- Page Structure:
  1. Top App Bar (sticky):
     - Left: app title
     - Right: user menu (role label, sign out)
  2. Status Summary Row:
     - Horizontally scrollable chips/counters: Dirty, In Progress, Cleaned, Inspected, Released.
     - Tap a chip filters the list.
  3. Filters/Tools:
     - Search (room number)
     - Filter button opens bottom sheet (floor, assignee, sort)
  4. Room Card List (primary):
     - Card content: room number (large), status chip, last updated, small note icon if notes exist.
     - Card action: tap navigates to Room Detail.
     - Optional inline quick action button (role-dependent): e.g., "Start", "Mark Cleaned".
  5. System feedback:
     - Sync indicator (top-right or under app bar)
     - Empty state (no rooms match filters)
- Responsive behavior:
  - ≥768px: switch list to 2-column grid; summary row becomes fixed grid.
  - ≥1024px: 3-column grid; filters become left sidebar panel.

---

## 3) Room Detail (/rooms/:roomId)
- Layout: Mobile-first with sticky header and bottom action bar; content in stacked sections.
- Meta:
  - title: "Room Details"
  - description: "Update status and review history."
- Page Structure:
  1. Header (sticky):
     - Back button
     - Room number + current status chip
     - Overflow menu (role-based actions like revert)
  2. Primary Action Panel (role-aware):
     - Shows only allowed next transitions (e.g., "Mark Cleaned", "Inspect", "Release")
     - Confirmation modal for revert operations
  3. Notes Section:
     - Text area + "Add note" button
     - List of recent notes (most recent first)
  4. Audit Trail / Timeline:
     - Vertical timeline of status changes: from → to, user, timestamp, note snippet
     - Load more pagination
- States:
  - Permission denied: show read-only mode with explanation.
  - Offline: disable transitions; allow viewing cached room data if available.
