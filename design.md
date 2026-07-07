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

- **Primary Brand:** Vibrant Purple `#8B5CF6`. Logo text, active nav icons, primary action buttons, checkboxes (checked state), active progress bars.
- **Goal Status Colors (calendar blocks and tags):**
  - Focus Goals: Purple/Pink tones
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
- **Top:** Brand name "Stryde" in `text-primary` (purple), semibold. Bottom border.
- **Middle:** Vertical nav. Items: icon + label. Gap `gap-0.5` between items. Padding `px-3 py-4`.
- **Active nav item:** `bg-accent` (gray tint) pill. Icon in `text-primary` (purple). Label in `text-foreground font-semibold`.
- **Inactive nav item:** Icon and label both in `text-muted-foreground`. Hover: `bg-accent`.
- **Bottom (pinned):** Settings item, separated by `border-t`.
- Sidebar is `sticky top-0 h-screen` — does not scroll.

### 2. Middle Column (320px fixed)

- White background (`--card`).
- **Purpose:** In the Daily Plan and Calendar day views — Recommendation Engine surface. In other views — contextual panel or collapsed.
- **Top:** Column header ("Recommendations"), followed by a full-width outlined "+ New Event" button.
- **Content:** Events grouped by recommendation tier label (e.g., "Due Today", "Overdue", "Focus", "Floating").
- **Event list items:**
  - Custom checkbox (square, 4px radius, purple fill with white checkmark when done).
  - Event title (strikethrough + muted when done/skipped).
  - Duration floated right (e.g., `00:30`).
  - Goal tag pills below the title (small text, color-matched to goal status).
- Separated from canvas by 1px border-r.

### 3. Right Canvas (fluid)

- White background.
- **Top bar:** Current date, prev/next arrows, view toggle.
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
- Colors via `color-mix`: soft tinted bg + saturated text. Tones: `neutral | violet | red | blue | amber | green`.

### Modals

- White card, centered overlay, `backdrop-blur-sm` backdrop at `bg-black/40`.
- `shadow-[var(--shadow-pop)]` — the ONE place drop shadows are used.
- `rounded-[var(--radius-xl)]`, `border border-border`.

### Shadows — strictly flat

- **No `shadow-card`** on any internal element (cards, list rows, panels, sidebar).
- **Only `shadow-pop`** on floating elements: modals, dropdowns, popovers.
- `shadow-pop: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.06)`.

---

## Dark Mode

- Toggled by adding `.dark` to `<html>`; all colors flow from the CSS variables in `index.css`.
- User preference (light / dark / system) lives on the Settings page, persisted in localStorage (`stryde-theme`), default system. Implementation: `client/src/lib/theme.ts`.
- Never branch on the theme in components — style with semantic tokens only.

---

## Daily Plan Page (planned — plan.md Phase 11)

The `/plan` view follows the three-pane layout: recommendations in the middle column, and the right canvas holds (top to bottom):

1. **Day header** — date, prev/next/today controls (same pattern as the calendar header).
2. **Goal health strip** — one compact row per Focus goal: title, believed vs actual progress bars.
3. **Agenda** — the day's scheduled events as a vertical list (checkbox, title, time range, goal tags), ordered by start time. No hour grid; this is a checklist, not a scheduling surface.

Mobile: single column, agenda first, recommendations collapsed behind a toggle.

---

## Spacing & Sizing

- Border radius: buttons/tags `6px`, cards/modals `8-12px`, avatars fully round.
- Column dividers: `border-r border-[var(--border)]` (1px, `#E5E7EB`).
- Sidebar: `w-60` (240px). Middle column: fixed `w-80` (320px).
- List row hover: `hover:bg-accent` (light gray tint), `rounded-[var(--radius-md)]`.
- Section group labels: `text-xs font-medium text-muted-foreground uppercase tracking-wide`.
