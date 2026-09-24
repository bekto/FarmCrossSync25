# 57: TS — FS25 folder selection controller

**What to build:** A DOM-free controller `src/lib/fs25Root.ts` for the new onboarding step. It detects candidate folders, lets the user pick one, normalizes the pick, lists its slots, and persists the choice.

**Priority:** P0

**Blocked by:** 50, 52, 53

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:** new `src/lib/fs25Root.ts` and `src/lib/fs25Root.test.ts`. Use the same dependency-injection style as `src/lib/onboarding.ts` (read it first).

**API:**
```ts
export interface Fs25RootDeps {
  detectFs25Roots(): Promise<string[]>;
  listSlots(root: string): Promise<SlotInfo[]>;
  pickFolder(): Promise<string | null>;
  setFs25Root(path: string): Promise<unknown>;
}
export interface Fs25RootView { candidates: string[]; root: string | null; slots: SlotInfo[]; busy: boolean; error: string | null; }
export function normalizeRoot(path: string): string; // ".../savegame3" or ".../savegame3/" -> parent; handles both / and \
export function createFs25Root(deps): { snapshot(); detect(); choose(path); selectFolder(); confirm(): Promise<boolean>; }
```
- `detect()` auto-chooses the first candidate if there is one. Otherwise it sets `error` to "FS25 folder not found automatically. Use Select Folder to choose it."
- `choose(path)` normalizes the path and calls `listSlots`. If that errors, it sets `error` and `root` stays null.
- `confirm()` persists the root with `setFs25Root`. It returns false when there is no root.
- `normalizeRoot` is the only path manipulation allowed in TS: stripping the last segment when it matches `/^savegame\d+$/`.

**Acceptance:**
- [x] normalizeRoot tests cover Linux and Windows paths, a trailing separator, and a non-savegame folder (returned unchanged)
- [x] detect with zero candidates, one candidate, and two candidates
- [x] A cancelled picker changes nothing
- [x] confirm without a root returns false and does not call setFs25Root

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check` — all pass, 0 errors.

## Work Log
- Done: added DOM-free `fs25Root.ts` controller (normalizeRoot/detect/choose/selectFolder/confirm) + tests; node tests 111 pass, check clean.
