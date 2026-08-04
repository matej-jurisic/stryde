/**
 * The calendar grid maps minutes-past-midnight to pixels. Expanded, that map is
 * the obvious linear one. Compact mode makes it piecewise: stretches of the day
 * with nothing in them shrink to a fixed-height band, so a day's actual content
 * fits on screen without scrolling past hours of blank grid.
 *
 * Every position on the grid goes through toPx/toMin - event tops, hour lines,
 * drag overlays, the now line, snapping. Two invariants keep the calendar honest:
 *
 *   1. Any drag switches the whole grid back to the linear map before it reads a
 *      coordinate (see expandForDrag in CalendarPage), so no gesture code has to
 *      reason about bands.
 *   2. An event's own span always falls inside one expanded segment, because the
 *      occupied ranges are built from those spans and padded outwards. So a pixel
 *      offset measured *within* a block - a grab offset, a block's height - means
 *      the same thing in both modes and survives the switch untouched.
 */

export const DAY_MIN = 24 * 60
/**
 * Height of one collapsed stretch: its 9px label plus its two border lines and a
 * little air. It has to stay well under an hour of grid at the *minimum* zoom
 * (32px/hr) or collapsing stops being worth doing exactly where the day is
 * already most cramped.
 */
export const COLLAPSE_BAND_PX = 20
/**
 * Shortest gap worth a band at all. Below this the band is more furniture than
 * the gap is grid, whatever the zoom.
 */
export const MIN_COLLAPSE_MIN = 45
/**
 * And it has to actually save room: half the band's height again, so a collapse
 * is always a visible gain rather than a swap of one blank strip for another.
 */
export const MIN_COLLAPSE_PX = Math.round(COLLAPSE_BAND_PX * 1.5)
/**
 * Kept either side of an event when working out what counts as occupied, so a
 * block never sits flush against a band edge.
 */
export const OCCUPIED_PAD_MIN = 15
/**
 * Occupied ranges snap outwards to this, matching the quarter-hour the rest of
 * the calendar snaps to. Segment edges are therefore *not* on the hour, which is
 * why the grid draws its hour lines at absolute positions rather than stepping
 * from a segment's start.
 */
export const SNAP_MIN = 15

export interface ScaleSegment {
  startMin: number
  endMin: number
  topPx: number
  px: number
  collapsed: boolean
}

export interface TimeScale {
  segments: ScaleSegment[]
  totalPx: number
  hourPx: number
  isCompact: boolean
  /** Minutes past midnight → pixels from the top of the column. */
  toPx: (min: number) => number
  /** Pixels from the top of the column → minutes past midnight. */
  toMin: (px: number) => number
}

function buildScale(
  parts: Array<{ startMin: number; endMin: number; collapsed: boolean }>,
  hourPx: number,
  isCompact: boolean,
): TimeScale {
  const segments: ScaleSegment[] = []
  let top = 0
  for (const p of parts) {
    const px = p.collapsed ? COLLAPSE_BAND_PX : ((p.endMin - p.startMin) / 60) * hourPx
    segments.push({ ...p, topPx: top, px })
    top += px
  }
  const totalPx = top

  return {
    segments,
    totalPx,
    hourPx,
    isCompact,
    toPx(min) {
      const m = Math.max(0, Math.min(min, DAY_MIN))
      for (const s of segments) {
        if (m <= s.endMin) return s.topPx + ((m - s.startMin) / (s.endMin - s.startMin)) * s.px
      }
      return totalPx
    },
    toMin(px) {
      const y = Math.max(0, Math.min(px, totalPx))
      for (const s of segments) {
        if (y <= s.topPx + s.px) return s.startMin + ((y - s.topPx) / s.px) * (s.endMin - s.startMin)
      }
      return DAY_MIN
    },
  }
}

export function linearScale(hourPx: number): TimeScale {
  return buildScale([{ startMin: 0, endMin: DAY_MIN, collapsed: false }], hourPx, false)
}

/**
 * Builds the piecewise scale for one day from the spans it has to show. Ranges
 * are minutes past midnight and need not be sorted, disjoint, or non-empty.
 */
export function compactScale(ranges: Array<[number, number]>, hourPx: number): TimeScale {
  /** Is a gap of this many minutes worth replacing with a band at this zoom? */
  const worthCollapsing = (gapMin: number) =>
    gapMin >= MIN_COLLAPSE_MIN && (gapMin / 60) * hourPx >= MIN_COLLAPSE_PX

  const padded = ranges
    .map(([s, e]) => [
      Math.max(0, Math.floor((s - OCCUPIED_PAD_MIN) / SNAP_MIN) * SNAP_MIN),
      Math.min(DAY_MIN, Math.ceil((e + OCCUPIED_PAD_MIN) / SNAP_MIN) * SNAP_MIN),
    ] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])

  // Merge, swallowing any gap not worth a band.
  const merged: Array<[number, number]> = []
  for (const [s, e] of padded) {
    const last = merged[merged.length - 1]
    if (last && !worthCollapsing(s - last[1])) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  // Same rule for the head and tail of the day, so no sliver band ever renders.
  if (merged.length > 0) {
    if (!worthCollapsing(merged[0][0])) merged[0][0] = 0
    const tail = merged[merged.length - 1]
    if (!worthCollapsing(DAY_MIN - tail[1])) tail[1] = DAY_MIN
  }

  const parts: Array<{ startMin: number; endMin: number; collapsed: boolean }> = []
  let cursor = 0
  for (const [s, e] of merged) {
    if (s > cursor) parts.push({ startMin: cursor, endMin: s, collapsed: true })
    parts.push({ startMin: s, endMin: e, collapsed: false })
    cursor = e
  }
  if (cursor < DAY_MIN) parts.push({ startMin: cursor, endMin: DAY_MIN, collapsed: true })

  return buildScale(parts, hourPx, true)
}
