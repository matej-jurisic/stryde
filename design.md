## Visual Reference

The target aesthetic is a clean, minimal, flat B2B productivity dashboard — white panels, 1px borders, no drop shadows on internal elements, generous whitespace, strict typographic hierarchy. The reference screenshot is Aloplanner (https://aloplanner.com/todos). Match the *feel* and *design language*, not the content.

---

## Overall Aesthetic

Modern, clean, minimalist web-based dashboard. Spacious, organized, strictly professional. Relies on subtle 1px borders and whitespace. Flat design — no shadows on internal elements. The hierarchy is established through color, weight, and spacing alone.

---

## Color Palette

### Base Colors

- **Canvas (app background):** Light Gray `#F3F4F6`. The outer shell — visible between panels.
- **Panel / Card background:** Pure White `#FFFFFF`. Sidebar, middle column, cards.
- **Borders & Dividers:** Very Light Gray `#E5E7EB`. All column separators, card borders, list dividers.

### Text Colors

- **Primary Text:** Dark Charcoal `#111827`. Event titles, goal names, nav labels (active).
- **Secondary / Metadata Text:** Medium Gray `#6B7280`. Datetimes, durations, statuses, nav labels (inactive).

### Accent & Brand Colors

- **Primary Brand:** Slate Blue `#8499B1`. Logo text, active nav icons, primary action buttons, checkboxes (checked state), active progress bars.
- **Goal Status Colors (calendar blocks and tags):**
  - Focus Goals: Primary/blue tones
  - Active Goals: Teal/Light Blue tones
  - Bench Goals: Neutral Gray
- Event blocks use a very light (low-opacity) background of their parent goal's color, with a solid 1px border of the same color. Events without goals use neutral gray.

---

## Typography

- **Font Family:** Inter (primary), then `system-ui, sans-serif`.
- **Hierarchy:**
  - Section/Page headers: semibold, 18-20px
  - Nav labels, event titles, goal names: regular weight, 14px
  - Metadata (times, tags, durations): 11-12px, `text-muted-foreground`
- **Strikethrough:** Done/Skipped events show strikethrough with faded `text-muted-foreground`.
- **Do not bold** body text, nav labels (inactive), metadata, or button labels.
- **Active nav label only:** `font-semibold`, `text-foreground`.

---

## Layout & Structure

### Three-Pane Layout

```
[Left Sidebar 240px] | [Middle Column 320px] | [Right Canvas — fluid]
```

All panes are separated by a 1px `border-[var(--border)]` vertical divider. No gap, no padding between panes.

### 1. Left Sidebar (240px fixed)

- White background (`--card`).
- **Top:** Brand name "Stryde" in `text-primary`, semibold. Bottom border.
- **Middle:** Vertical nav. Items: icon + label. Gap `gap-0.5` between items. Padding `px-3 py-4`.
- **Active nav item:** `bg-accent` (gray tint) pill. Icon in `text-primary`. Label in `text-foreground font-semibold`.
- **Inactive nav item:** Icon and label both in `text-muted-foreground`. Hover: `bg-accent`.
- **Bottom (pinned):** Settings item, separated by `border-t`.
- Sidebar is `sticky top-0 h-screen` — does not scroll.

### 2. Middle Column (320px fixed)

- White background (`--card`).
- **Purpose:** In the Daily Plan and Calendar day views — Recommendation Engine surface. In other views — contextual panel or collapsed.
- **Top:** Column header ("Recommendations"), followed by a full-width outlined "+ New Event" button.
- **Content:** Events grouped by recommendation tier label (e.g., "Due Today", "Overdue", "Focus", "Floating").
- **Event list items:**
  - Custom checkbox (square, 4px radius, primary fill with white checkmark when done).
  - Event title (strikethrough + muted when done/skipped).
  - Duration floated right (e.g., `00:30`).
  - Goal tag pills below the title (small text, color-matched to goal status).
- Separated from canvas by 1px border-r.

### 3. Right Canvas (fluid)

- White background.
- **Top bar:** Current date, prev/next arrows, view toggle, zoom in/out controls (adjusts pixel-per-hour scale).
- **Floating row:** All-day row pinned above the time grid — shows floating occurrences as compact chips. Overdue occurrences are rendered in a separate sticky band at the top of the scroll container so they stay visible while scrolling.
- **Content:** Time-based vertical grid. Hours listed on the far left. Event blocks placed in their time slots.
- **Event blocks:** Light-tinted background + solid 1px colored left border, matching the event's goal color. Title + time range inside.

---

## UI Components

### Nav Items

- 14px text, `gap-3`, `px-3 py-2`, `rounded-[var(--radius-md)]`.
- Active: `bg-accent`, icon `text-primary`, label `text-foreground font-semibold`.
- Inactive: icon + label both `text-muted-foreground`. Hover: `bg-accent`.

### Buttons

- Primary: `bg-primary text-primary-foreground`, `rounded-[var(--radius-md)]`, no shadow.
- Outlined: `border border-border bg-transparent text-foreground`, hover `bg-accent`.
- Ghost: transparent bg, `hover:bg-accent`.
- Height: `h-9` (md), `h-8` (sm). Font: regular weight (not semibold or bold).
- Border radius: 6-8px.

### Checkboxes (events)

- Square, `rounded-[4px]`. Unchecked: `border border-border bg-transparent`.
- Checked (done): `bg-primary` fill, white checkmark SVG.
- Skipped: gray outline, gray "×" or dashed style.

### Cards

- `border border-border bg-card rounded-[var(--radius-lg)]`. **No shadow.**
- Internal padding: `px-6 py-6`.

### Badges / Tags

- Small pill: `px-2 py-0.5`, `rounded-full`, `text-xs font-medium`.
- Colors via `color-mix`: soft tinted bg + saturated text. Tones: `neutral | red | blue | amber | green`.

### Modals

- White card, centered overlay, `backdrop-blur-sm` backdrop at `bg-black/40`.
- `shadow-[var(--shadow-pop)]` — the ONE place drop shadows are used.
- `rounded-[var(--radius-xl)]`, `border border-border`.
- Escape closes only the topmost open modal (modal stack in `Modal.tsx`).

### Confirmation dialogs

- Every destructive action (delete occurrence / activity / goal / checkpoint / category) goes through `ConfirmDialog` — a small modal with the item name in the message, a ghost Cancel, and a destructive confirm button. Never inline confirms, never immediate deletes.
- The dialog stays open with a loading state until the mutation succeeds; the caller closes it.

### Toasts

- `Toasts` viewport (bottom-center, above the mobile bottom nav) + `useToastStore` / `toastError` in `store/toasts.ts`.
- Card-style pill: `border border-border bg-card shadow-pop`, tone icon (destructive alert / primary check), auto-dismiss after 5s, manual dismiss X.
- Used for mutation failures that have no inline error display (status toggles, deletes, calendar drag reschedules).

### Dropdown menus

- Row action menus use `ActionMenu`: `MoreHorizontal` trigger, menu rendered in a portal with fixed positioning so it is never clipped by overflow containers; flips above the trigger when there is no room below. Closes on outside press and Escape.

### Shadows — strictly flat

- **No `shadow-card`** on any internal element (cards, list rows, panels, sidebar).
- **Only `shadow-pop`** on floating elements: modals, dropdowns, popovers.
- `shadow-pop: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.06)`.

### Scrollbars

- Internal scroll areas (sidebar category list, suggestions panel, calendar grid) use the `.scroll-slim` utility from `index.css`: a thin scrollbar whose thumb is invisible until the container is hovered, tinted from `--muted-foreground`. Never leave a default OS scrollbar visible inside a panel.

### Sidebar & Panel Animations

The left sidebar and the middle recommendation panel slide in/out with CSS transitions when toggled. Use `transition-all duration-300` (or equivalent) on the width/transform; content fades with it. Never animate the canvas width directly — only the panel element.

---

## Dark Mode

- Toggled by adding `.dark` to `<html>`; all colors flow from the CSS variables in `index.css`.
- User preference (light / dark / system) lives on the Settings page, persisted in localStorage (`stryde-theme`), default system. Implementation: `client/src/lib/theme.ts`.
- Never branch on the theme in components — style with semantic tokens only.

---

## Daily Plan Page

The `/plan` view follows the three-pane layout: recommendations in the middle column, and the right canvas holds (top to bottom):

1. **Day header** — date, prev/next/today controls (same pattern as the calendar header).
2. **Goal health strip** — one compact row per Focus goal: title, believed vs actual progress bars.
3. **Agenda** — the day's scheduled events as a vertical list (checkbox, title, time range, goal tags), ordered by start time. No hour grid; this is a checklist, not a scheduling surface.

Mobile: single column, agenda first, recommendations collapsed behind a toggle.

---

## Mobile Navigation

- **Bottom tab bar is capped at 5 slots**, icon-only: Plan, Categories, Calendar, Goals, and a "More" button (`Ellipsis` icon). New pages go in the More sheet, never a 6th tab.
- **More sheet:** bottom sheet (same overlay + slide-up animation as mobile modals: `bg-black/40 backdrop-blur-sm`, `rounded-t-2xl`, drag handle) listing secondary destinations — Activities, Insights, Settings — as icon + label rows styled like sidebar nav items. Closes on backdrop tap, Escape, or navigation. The More button shows the active (primary) tint when the current route is one of its items.

---

## Insights Page

- **KPI row:** 4 stat tiles (2×2 on mobile, 1×4 on desktop): label in `text-xs text-muted-foreground`, value `text-2xl font-semibold`.
- **14-day completion chart:** single-series column chart in `bg-primary` — no legend. Columns max 24px wide, 4px rounded top, square baseline on a hairline `border-border`; zero days show a 2px `bg-muted` stub. Per-column hover tooltip (card + `shadow-pop`) with date and count. Values live in tooltips, not on every column.
- **Category breakdown:** rows with category icon + name (text tokens, never colored text), count right-aligned (`tabular-nums`), and a 4px proportional bar in the category's own color on a `bg-muted` track. Uncategorized uses `CircleDashed` + muted tones.

---

## Spacing & Sizing

- Border radius: buttons/tags `6px`, cards/modals `8-12px`, avatars fully round.
- Column dividers: `border-r border-[var(--border)]` (1px, `#E5E7EB`).
- Sidebar: `w-60` (240px). Middle column: fixed `w-80` (320px).
- List row hover: `hover:bg-accent` (light gray tint), `rounded-[var(--radius-md)]`.
- Section group labels: `text-xs font-medium text-muted-foreground uppercase tracking-wide`.
