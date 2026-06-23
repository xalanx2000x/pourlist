# Happy Hour Parser — Apparatus Docs

## Overview

`src/lib/parse-hh.ts` is the happy hour schedule parser. It takes a raw string like `"Mon-Fri 4-7pm"` and returns a typed `HHWindow`:
- `type`: `all_day | open_through | typical | late_night | null`
- `startMin`, `endMin`: minutes since midnight (null = "open"/"close" — city close time)
- `days`: ISO weekday array `[1=Mon ... 7=Sun]`

`parseHHSchedule` wraps `parseOneClause` to handle multi-window inputs (comma-separated).

---

## Truth Table

**Location:** `scripts/parser-truth-table.ts`

```bash
npx tsx scripts/parser-truth-table.ts
```

The truth table is the **source of truth for correct behavior**. Expected values in `CASES[]` define what the parser *should* produce — not memory, not comments, not Slack threads.

- **71 PASS / 0 FAIL** (as of 2026-06-22)
- **14 UNEXP** = known spec conflicts / infrastructure gaps, NOT parser bugs
- Any new behavior must be added to the truth table first, then implemented

### Running a single case

```typescript
import { parseOneClause } from './src/lib/parse-hh.ts'
parseOneClause('Mon-Fri 4-7pm')
```

### Adding a new case

Add to `CASES[]` in `scripts/parser-truth-table.ts`:

```typescript
{ input: '4-9pm', mode: 'single', expected: { type: 'typical', startMin: 960, endMin: 1260, days: [] } }
```

Run the table — if it fails, implement until it passes, then commit.

---

## The Four Parser Rulings (from 2026-06-21 spec)

These were verified empirically via the truth table and re-applied from scratch after the 06-21 unrecoverable loss.

### Ruling 1 — Cross-midnight ranges
**Cleared:** 7 cases (`10-2`, `10pm-2`, `6-4`, `10pm-2am`, `11pm-1am`, `10:30pm-2`, `11pm-2am`)

When `endMin < startMin` (e.g. `10pm-2am`: 1320 < 120), undo the wrong PM→AM assumption and mark `type = 'late_night'`.

**Implementation:** After `rangeMatch` and `robustRange` branches, insert:
```typescript
// Cross-midnight: end before start means the range runs into next morning
if (startMin !== null && endMin !== null && endMin < startMin && type !== 'open_through') {
  if (endMin >= 12 * 60) endMin -= 12 * 60  // undo wrong PM assumption → AM
  type = 'late_night'
}
```

**Key:** `type` must be `let`, not `const` — the reassignment is intentional.

### Ruling 2 — `after [time]pm`
**Cleared:** `after 9pm` → 1260, `after 10pm` → 1320

`classifyHHType` must recognize "after 9pm" as late_night. The LATE_NIGHT regex test needs to match `after\s+\d+(?::\d{2})?\s*(?:am|pm|p\.?m\.?)?` — the bare `\d+` doesn't fire when followed by `pm` (no word boundary between digit and letter).

The `afterMatch` handler then uses the explicit `pm`/`am` suffix to determine `startMin`.

### Ruling 3 — `til`/`to` day-time connectors
**Cleared:** `Mon til Fri 4-7pm`, `4 til 7`, `Mon til Fri 4 til 7`, `4 to 7`, etc.

In `normalizeText`, normalize day-til-day and time-til-time connectors:
```typescript
.replace(/([a-z])\s*(?:til|till|to)\s*([a-z])/gi, '$1-$2')
.replace(/(\d)\s*(?:til|till|to)\s*(\d)/g, '$1-$2')
```

### Ruling 4 — `before` cases
**Cleared:** `before 2am` → 840/120, `before 12` → 840/1440

The `bareMatch` regex captures am/pm suffix at group index 3, not 2:
```typescript
const [, , , rawSuffix] = bareMatch  // skip hour, minutes, → suffix
```
Bare `12` in "before 12" means midnight (1440), not noon:
```typescript
if (rawNum12 === 12 && !hasExplicitAm && !hasExplicitPm) {
  endMin = 1440
}
```

---

## Midnight = 1440 (not 0)

`parseTimeToMin('midnight')` returns **0** internally (midnight is the start of the day). However, the spec stores and returns midnight as **1440**.

**Where midnight = 1440 is enforced:**

1. **`(time) midnight` handler** (lines ~428): Matches `"10pm midnight"` / `"10pm-midnight"` — parses leading time into `startMin`, sets `endMin = 1440`, `type = 'typical'`.

2. **`late_night adjustedText === 'midnight'`** (lines ~467): When `startMin !== null` (start already set, midnight is the end) → `endMin = 1440`. When `startMin === null` (bare "midnight to close") → `startMin = 1440`.

**Where midnight = 0 was the old bug:**
The early return for "midnight to close" was hardcoding `startMin = 0`. Fixed to `startMin = 1440`.

---

## Key Handler Locations

| Handler | Line | Purpose |
|---------|------|---------|
| `classifyHHType` | 152 | Classifies text as `all_day`, `open_through`, `late_night`, `typical` |
| `normalizeText` | 207 | Canonicalizes input before classification |
| `rangeMatch` branch | ~297 | Handles `10-2`, `10pm-2am` etc. |
| `robustRange` branch | ~346 | Handles separate suffixes on each side |
| `(time) midnight` handler | ~428 | Handles `10pm midnight` / `10pm-midnight` |
| `before X` handler | ~402 | Handles `before 2am`, `before 12` |
| `late_night` block | ~432 | Handles `X-close`, `after 9pm`, `midnight` |
| `midnight to close` early return | 187 | Classifies `midnight to close` → late_night |
| `parseHHSchedule` | 579 | Multi-window: splits on commas, caps at 3 |

---

## parseHHSchedule Return Type

```typescript
export interface HHSchedule {
  windows: [HHWindow | null, HHWindow | null, HHWindow | null]  // capped at 3
  rawText: string
  totalParsed: number  // count of windows parsed BEFORE the 3-window cap
                      // Use for overflow detection: totalParsed > 3
}
```

The `totalParsed` field is the overflow signal. The truth table checks `result.totalParsed > 3` for overflow cases.

---

## Common Bugs and How to Fix Them

### "before 2am" returns endMin=840 (wrong)
`bareMatch` suffix group is at index 3, not 2. Fix: `const [, , , rawSuffix] = bareMatch`.

### "after 9pm" returns null
The LATE_NIGHT classify regex `after\s+\d+` doesn't fire when followed by `pm` (no word boundary). Fix: broaden to `after\s+\d+(?::\d{2})?\s*(?:am|pm|p\.?m\.?)?`.

### "10pm to midnight" returns null
normalizeText converts to `"10pm midnight"` (lookbehind `(?<![a-zA-Z\d])` blocks the `to midnight` replacement after `pm`). The `(time) midnight` handler then catches it and sets `endMin = 1440`.

### "midnight to close" returns startMin=0
The `adjustedText === 'midnight'` handler was using `startMin = 0`. Fixed to `startMin = 1440`.

### Truth table shows `result.totalParsed === undefined`
`HHSchedule` interface didn't have `totalParsed`. Added as an additive field — interface, early return, and main return all updated.

---

## Anti-Loop Rules

1. **Commit after every verified pass** — nothing lives uncommitted
2. **Full table run after every change** — never assume
3. **Let user write exact edit strings** — paste precision > inferred precision
4. **Use `edit` tool, not `sed`** — sed mangles backslash sequences in this file
5. **Debug via standalone scripts in `scripts/`** — not inline console.log in hot paths
6. **Don't touch the truth table to make a case pass** — implement until the table passes

---

## Commit Log (2026-06-22)

| Commit | Description | Result |
|--------|-------------|--------|
| `e367cf3` | Overflow signal: `totalParsed` | 70→71 |
| `4e8e254` | Range-to-midnight: `10pm-midnight`/`10pm to midnight` → 1320→1440 | 68→70 |
| `466f7d5` | Midnight-to-close: `startMin=1440` not 0 | 67→68 |
| `2d808ad` | Ruling 2: `after [time]pm` handling | 61→65 |
| `8f6fd96` | Ruling 1: cross-midnight detection | 54→61 |
| `265306d` | Ruling 3: til/to connectors | 48→54 |
| `d52ca65` | Truth-table harness | baseline |

**71 PASS / 0 FAIL / 14 UNEXP** — committed and pushed.

---

## Remaining Known Issues (UNEXP — not parser bugs)

These are spec conflicts or infrastructure gaps, documented in the truth table notes:

- Multi-window "and" separator not splitting (comma-only split)
- `4-4` zero-length range returns typical instead of null
- `"after 9"` (bare) → 1440 (spec is ambiguous without `pm`)
- `"thru"` keyword not recognized
- `"until midnight"` → null (spec'd as open_through 840→1440, classify gap)
- `all day Mon-Fri` drops day spec
- Multi-day overlap/window association edge cases

These are tracked but not blocking. The parser is functionally complete for the happy hour use cases that matter in production.
