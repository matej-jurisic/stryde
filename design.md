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
- **Content:** "Floating" first (already-committed work needing a time), then activities grouped by recommendation tier label ("Focus Goals", "Active Goals", "Based on Your Habits").
- **Suggestion list items:** two side-by-side targets, never nested buttons.
  - *Body* (opens the event modal): title, effort floated right (`~45m`), reason line beneath in `text-[11px] text-muted-foreground/80`, goal tag pill below (color-matched to goal status).
  - *Action* (right edge): a `History` icon at 50% opacity rising to full on row hover, then when the server returned a suggested slot, an outlined mono pill showing `+ 18:00` that schedules there in one click, hover shifting to primary tint. With no slot the pill degrades to the plain `CalendarPlus` icon that opens the modal. The history icon never hides entirely: there is no hover on touch to reveal it with.
  - The reason line is optional: activities with no completion history show title and action only.
- Separated from canvas by 1px border-r.

### 3. Right Canvas (fluid)

- White background.
- **Top bar:** Current date, prev/next arrows, view toggle, zoom in/out controls (adjusts pixel-per-hour scale).
- **Floating row:** All-day row pinned above the time grid — shows floating occurrences as compact chips. Overdue occurrences are rendered in a separate sticky band at the top of the scroll container so they stay visible while scrolling.
- **Content:** Time-based vertical grid. Hours listed on the far left. Event blocks placed in their time slots.
- **Event blocks:** Light-tinted background + solid 1px colored left border, matching the event's goal color. Title + time range inside.
- **Clicking empty grid** opens the state snapshot dialog for that quarter-hour (see below). Creating an occurrence keeps the drag, and the long press on touch: the gesture that costs nothing answers a question, and the one that writes has to be deliberate.
- On touch, what counts as a tap is left to the browser: the dialog opens on the click the platform's own gesture recognizer fires, which it withholds when the finger scrolled. A press that turns into a drag, a swipe or a pinch opens nothing.
- **Suggestion ghosts:** Toggled by the `Sparkles` button in the top bar (tinted primary when on), capped per day by the `Calendar suggestions` setting. Placeholder blocks drawn where the engine would place a suggested activity: **dotted** 1.5px border in the activity's category color (planned occurrences own the dashed border, real ones the solid one), a very faint tint over an opaque card base, `Sparkles` icon + title, and `opacity-70` rising to full on hover. They render *below* the event layer, so a real block always wins the pixels. A ghost is often under 26px tall, so it gets no second button: click schedules, and **right-click or a 400ms hold** opens the activity history dialog. The `title` names both, since neither gesture announces itself.

---

## UI Components

### Nav Items

- 14px text, `gap-3`, `px-3 py-2`, `rounded-[var(--radius-md)]`.
- Active: `bg-accent`, icon `text-primary`, label `text-foreground font-semibold`.
- Inactive: icon + label both `text-muted-foreground`. Hover: `bg-accent`.
- A sidebar item stays active on its sub-routes (an activity, a goal, the Types and States tabs), so drilling in never leaves the sidebar looking like nowhere is selected.

### Page tabs

- One screen split into sections gets an **underline** tab strip directly under the `PageHeader`: full-width `border-b border-border` bar, items `gap-4`, 12px medium text, active item `border-b-2 border-primary text-foreground` pulled onto the bar with `-mb-px`, inactive `text-muted-foreground` with no border.
- Reserved for *navigation between sub-pages* (Activities / Types / States). Filters and grouping stay pills and segmented controls in the toolbar below, so the two never read as the same control.
- The strip is a shared component (`ActivitiesTabs`) rendered by each of its routes, not a wrapper: each tab owns its own header action.

### Buttons

- Primary: `bg-primary text-primary-foreground`, `rounded-[var(--radius-md)]`, no shadow.
- Outlined: `border border-border bg-transparent text-foreground`, hover `bg-accent`.
- Ghost: transparent bg, `hover:bg-accent`.
- Height: `h-9` (md), `h-8` (sm). Font: regular weight (not semibold or bold).
- Border radius: 6-8px.
- **Delete is an icon-only square button**, never a labelled one: `Trash2` in `text-destructive` on a transparent ground, hover `bg-destructive/10`, sized to the row it sits in (`h-9 w-9` beside md buttons, `h-8 w-8` beside sm). It carries the name in `aria-label`, swaps the icon for an inline spinner while the delete is in flight, and always opens a `ConfirmDialog` rather than acting. Where the same footer holds Cancel and Save it gets `mr-auto`, so the full width separates it from the button the user actually meant to press. Used by `EventDetailModal`, the type editor and the state editor.
- The `Button` component sets no gap between its children, so **never give a `Button` an icon and a label together** - they render flush and read as one glyph. Icon plus label is a hand-rolled `flex ... gap-1.5` button (see the empty-state "New state" / "New type" buttons).

### Duration fields

- A span of time the user *chooses the scale of* is a number input plus a unit select (`minutes / hours / days`), both on the shared `inputCls` treatment, reading as a sentence off the end of the control it qualifies: `Physical  [Fresh] [Tired]  for [10] [hours]`. Never a bare minutes box - the values people want are "10 hours" and "2 days", and a raw `2880` is a small arithmetic exam. Used by the "Changes" field in `ActivityModal`.
- **The duration attaches to the pick, it does not summarise it.** A list underneath that restates `Physical: Tired  for [10] [hours]` prints the state name and value a second time for no new information; hang the input off the row that made the choice instead.
- **Changing the unit reinterprets the number, it does not convert it.** Typing 2 and switching hours to days means 2 days, not 0.08 of one.
- Blank means "no limit", and that only gets a helper line while the field is actually blank.
- A fixed-scale span (a time-of-day window, a minimum block) stays a plain field; the unit select is for the ones that legitimately range from minutes to weeks.

### State pickers (activity modal)

- The two state fields are **one panel**, not two loose fields: `divide-y divide-border rounded-lg border border-border bg-muted/40`, a `text-xs font-medium` sub-label per half ("Only suggest when" / "Doing it changes"). Both halves draw the same chips from the same states, so as bare labelled rows they read as one control accidentally rendered twice - the divider and the sub-labels are the only thing that says which half is the condition and which is the consequence.
- **One row per state, name in a fixed left column** (`h-8 w-20`, `text-xs text-muted-foreground`, truncating with a `title`), chips wrapping in the rest of the width. A name on its own line above its chips doubles the height of the field and leaves the right half of every row empty.
- Chips are the activity-type chip: `h-8 rounded-lg border px-2.5 text-xs font-medium`, selected `border-primary bg-primary/10 text-foreground`.
- Explain a *missing* control where it would have been, in three words, not in a paragraph below: picking a state's default value shows `defaults don't expire` where the duration would sit.

### State snapshot dialog (calendar)

- Opened by clicking empty grid. Titled with the moment itself (`States at Thu 30 Jul, 14:15`), so the dialog needs no restating line inside it.
- Reuses the activity modal's state panel shape: `divide-y divide-border rounded-lg border border-border bg-muted/40`, one row per state, **name in a fixed left column** (`w-20`, `text-xs text-muted-foreground`), value on the right. The value is the selected chip (`border-primary bg-primary/10`) - the same glyph that would pick it, here just showing it.
- Under the chip, `text-xs text-muted-foreground` prose carrying the cause then the expiry, as **two short sentences**: `Set by commute in at 09:00. Holds until 17:30, then Home.` One line, not a table: the fields are only ever read together, and half of them are absent for a value nothing has touched. Two facts though, so two sentences - comma-joining them stacks separators of different weight and the reader has to sort out which is which. The only comma left is the handover to the next value. A timestamp mid-sentence drops its own comma too (`Tue 28 Jul 19:30`), unlike the title's (`Thu 30 Jul, 14:15`), for the same reason.
- **No buttons.** A derived reading has nothing to save, and offering an edit here would invite fixing the symptom instead of the schedule that produced it.
- While loading, placeholder rows in the real rows' shape and count (from the cached state list). The panel is animating in as the request lands, so it must already be its final height: a one-line "loading" that grows into the answer reads as a stutter, and the first open - the slow one - is exactly when it happens.

### Activity history dialog

- Titled `<activity> - history`, opened from a suggestion. Meta line first (type, category, goal badge), then four stat tiles, then the day strip, then the recent list. Widest-to-narrowest: the tiles answer the question in one glance, the strip shows the shape, the list is the detail you only sometimes want.
- **Stat tiles:** `grid-cols-2 sm:grid-cols-4`, each `rounded-lg border border-border bg-muted/40 px-2.5 py-2` with a `text-[10px] uppercase tracking-wide` label over a `text-sm` value. A tile with nothing to show reads `Unknown` in muted text rather than vanishing: a missing figure is itself an answer, and four tiles that come and go make the dialog resize between activities.
- **Day strip:** centered, laid out the way a calendar is - seven weekday columns under their `Mon`-`Sun` names, eight week rows, current week last. Eight is two months: enough to read a rhythm, not so much that the grid outweighs the tiles above it. Cells are `h-7 w-7 rounded-[4px]` with `gap-1`, sized so a three-letter weekday fits above the column rather than being abbreviated to an initial. Done is solid `bg-primary`, skipped `bg-muted-foreground/60`, pending an outlined `border-primary/50 bg-primary/10`, an empty day flat `bg-muted`, and a day that has not happened yet nothing at all. Each cell carries its date as a `title`; the legend, also centered, spells out the three fills and the window.
- **Recent list:** the activity detail page's occurrence row, at ten rows: status dot, date with `HH:mm` in mono when the occurrence has a time, status word on the right. The box is a **fixed `h-[11.5rem]`** that scrolls - the row count is the one thing here that varies with the data, so it is the one thing not allowed to set the dialog's height.
- **While loading**, the whole shell renders at its final height, as in the state snapshot: tiles with a pulsing bar where the value goes, the strip empty (its size does not depend on the data), and five placeholder rows filling the recent box.
- **Read-only**, like the state snapshot: the two footer buttons are `Close` and an outlined `Open activity` that leads to the detail page for anything this dialog deliberately leaves out.

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

The `/plan` view follows the three-pane layout: suggestions in the middle column, and the right canvas holds (top to bottom):

1. **Day header** — 57px bar: prev/next chevrons, day title (full on `sm+`, compact below), jump-to-today button (only when the viewed day is not today), date input (`sm+` only), and a `+`. Same pattern as the calendar header.
2. **Briefing hero** — `rounded-xl border` card on a `from-card to-muted/40` gradient: a 56px progress ring (5px stroke, primary) holding the day's completion percentage, a greeting line with a `Sunrise`/`MoonStar` icon, a `text-lg font-semibold` headline, and a stat row (done / left / planned / overdue) where the numbers are `tabular-nums` `text-foreground` and only overdue takes `text-destructive`.
3. **Focus goal chips** — inside the hero, one bordered chip per Focus goal in a 1-up / `sm:`2-up grid: status dot, title, last-session recency, and either the milestone percentage (mono) or the ongoing occurrence bar.
4. **Overdue** — `border-destructive/30 bg-destructive/5` card: the count, a "Move to tomorrow" button (`bg-foreground text-background`), then the rows in a plain card list.
5. **Timeline agenda** — a three-column grid (content-sized time gutter, 0.75rem spine, fluid rows) so every row shares one time column. The spine is a 1px `border` line with a 2px dot per row, ringed in `background`; the current time is a primary label, dot, and hairline splitting past from upcoming. Relative labels ("now", "in 40m") sit under the gutter time. No hour grid: this is a checklist, not a scheduling surface.
6. **Planned** and **Floating** — uppercase section labels over bordered card lists.

Mobile: single column, suggestions behind the header's `Menu` toggle.

---

## Mobile Navigation

- **Bottom tab bar is capped at 5 slots**, icon-only: Plan, Categories, Calendar, Goals, and a "More" button (`Ellipsis` icon). New pages go in the More sheet, never a 6th tab.
- **More sheet:** bottom sheet (same overlay + slide-up animation as mobile modals: `bg-black/40 backdrop-blur-sm`, `rounded-t-2xl`, drag handle) listing secondary destinations — Activities, Insights, Settings — as icon + label rows styled like sidebar nav items. Closes on backdrop tap, Escape, or navigation. The More button shows the active (primary) tint when the current route is one of its items.

---

## Insights Page

One `max-w-2xl` column of sections, each an uppercase label over a bordered card with `divide-y` rows. No chart: every stat here is a duration, and a labelled row with a bar reads better than a column per day.

- **Period toggle:** segmented control (7 days / 30 days) on a `bg-muted` track with a `p-0.5` inset; the active option is a raised `bg-card` chip. Sits above the first section, left-aligned.
- **Unaccounted time:** headline row (label left, duration right in `tabular-nums`) with the trend against the previous period as a `text-xs text-muted-foreground` line beneath.
- **Gap lists** (*Biggest empty blocks*, *Often empty*): one row each — day or time range on the left, duration or "empty on X of Y days" right-aligned, all figures `tabular-nums`.
- **Time by activity / by category:** rows with title (category rows lead with the category icon; never colored text), duration right-aligned (`tabular-nums`), and a 4px proportional bar underneath in the category's own color on a `bg-muted` track. Uncategorized uses `CircleDashed` + muted tones.

---

## Spacing & Sizing

- Border radius: buttons/tags `6px`, cards/modals `8-12px`, avatars fully round.
- Column dividers: `border-r border-[var(--border)]` (1px, `#E5E7EB`).
- Sidebar: `w-60` (240px). Middle column: fixed `w-80` (320px).
- List row hover: `hover:bg-accent` (light gray tint), `rounded-[var(--radius-md)]`.
- Section group labels: `text-xs font-medium text-muted-foreground uppercase tracking-wide`.

---

## Copy

Single-user app: the user designed the domain, so the UI never explains it back to them.

- **No concept explainers.** Empty states are a title and a CTA, never a paragraph defining what a state, type, activity, or occurrence is.
- **No restating the controls.** A helper line under a field is only worth its space if it says something the field itself does not.
- **Generated data summaries are fine** (`describeProfile`/`profileHint`: the type's actual numbers), because they show values that are not otherwise on screen. Keep them to one terse line.
- **Field labels are labels, not sentences.** "Assumed cadence", not "Before I've learned from your history, assume this happens".
