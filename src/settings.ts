// Live-tunable runtime values for the in-game debug panel (src/ui.tsx).
//
// These mirror the compile-time constants but are MUTABLE so the panel can
// tweak movement feel without an edit/rebuild/reload cycle. The movement code
// reads from `settings.*` instead of the raw constants for every value exposed
// here. Defaults are seeded from constants.ts so behaviour is identical until
// something is changed. Use the panel's "LOG VALUES" button to dump the
// current numbers, then paste them back into constants.ts to make them
// permanent.
import {
  WALK_SPEED, JOG_SPEED, SPRINT_SPEED,
  HORIZONTAL_ACCEL_TIME_GROUND, HORIZONTAL_DAMP_TIME_GROUND,
  JUMP_HEIGHT, JUMP_HEIGHT_SPRINT,
} from './constants';

export const settings = {
  // --- Movement speeds ---
  walkSpeed: WALK_SPEED,
  jogSpeed: JOG_SPEED,
  sprintSpeed: SPRINT_SPEED,
  accelTimeGround: HORIZONTAL_ACCEL_TIME_GROUND,
  dampTimeGround: HORIZONTAL_DAMP_TIME_GROUND,
  // 1 = ignore engine-provided locomotion settings and use the values above
  // (so tuning always takes effect). 0 = defer to engine locomotion when present.
  forceLocalSpeeds: 1,

  // --- Animation phasing ---
  // Horizontal speed (m/s) above which the run clip is used instead of walk.
  walkRunThreshold: 2.6,
  // Horizontal speed (m/s) above which we leave idle and play walk/run.
  moveGate: 0.1,
  // Clip-playback divisor per locomotion clip = the gait's nominal speed, so the
  // clip plays at native 1.0x when moving at that speed and scales proportionally
  // otherwise (keeps the leg cadence matched to ground speed). Lower = faster legs.
  walkPlaybackDiv: WALK_SPEED,   // Walk clip
  jogPlaybackDiv: JOG_SPEED,     // Jog clip (default movement)
  sprintThreshold: 9.5,          // h-speed boundary: jog clip below, run clip above
  sprintPlaybackDiv: SPRINT_SPEED, // Run clip (sprint)
  // Cross-fade time (s) into each clip. Locomotion blends are ~0.2 (smooth gait
  // changes); air/jump phase transitions are short so the brief one-shot clips
  // (Start/Mid/End ~0.2-0.4s) aren't swallowed by the blend.
  transWalk: 0.2,
  transRun: 0.2,
  transIdle: 0.2,
  transAir: 0.1, // jump phases / glide / double-jump / landing
  // 1 = play the Jog_Stop clip when decelerating to a halt from jog/run.
  useJogStop: 1,
  // --- Glide pose selection ---
  // Turn rate (deg/s) past which the glide avatar leans left/right.
  glideLeanRate: 30,
  // h-speed (m/s) above which glide uses the forward (pitched) pose; below it
  // uses the upright/idle pose ("lean back").
  glideForwardSpeed: 3,
  // Playback speed of the glider deploy/stow clips (Glider_Open / Glider_Close).
  // Higher = the glider snaps into the hands faster on glide start.
  gliderOpenSpeed: 2.1,

  // --- Jump look & feel ---
  // Physical jump height (m) for a standing jump / sprint jump.
  jumpHeight: JUMP_HEIGHT,
  sprintJumpHeight: JUMP_HEIGHT_SPRINT,
  // Multiplier on the auto-timed ascent clip speed (jump.glb 0 -> 0.5 = "go up").
  // 1 keeps the takeoff synced to the real rise; >1 snaps up faster.
  jumpUpAnimSpeed: 1,
  // Landing/recover portion (jump.glb 0.5 -> end) playback speed. Higher = quicker
  // recovery = less time spent in the forward-lean touchdown pose.
  landingAnimSpeed: 1.5,
  // Playback frame (0-1) the jump clip is FROZEN on while falling. 0.5 = apex
  // crouch (the default forward-lean pose). Scrub this to find a more upright
  // frame of jump.glb for the airborne fall.
  fallPoseTime: 0.5,
  // Where the landing clip starts (playbackTime). 0.5 = apex pose. Raising this
  // skips further into the clip, cutting out the early/deep forward lean.
  landingStart: 0.5,
  // 1 = play the landing/recover clip; 0 = skip it entirely (snap straight to
  // idle/run on touchdown — removes the forward lean completely).
  playLanding: 1,
  // Phased-jump thresholds (metres fallen):
  // drop past which touchdown plays Hard_Landing instead of the normal *_Jump_End.
  hardLandingDrop: 3.0,
  // drop (while still airborne & descending) past which the fall switches to Long_Fall_Loop.
  longFallDrop: 4.0,
};

// Snapshot of the original defaults, captured at load before anything is
// tweaked, so the panel's RESET button can restore them for A/B comparison.
const DEFAULTS = { ...settings };

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
}

export type SettingKey = keyof typeof settings;

// Metadata driving the debug panel: how each value is labelled and stepped.
export type Tunable = {
  key: SettingKey;
  label: string;
  step: number;
  min: number;
  max: number;
  decimals: number;
  toggle?: boolean; // render as on/off instead of -/+
};

// Bounds are intentionally very wide so tuning is essentially unrestricted; the
// only hard floors are where a value must stay > 0 (clip-speed divisors, time
// constants) to avoid divide-by-zero / NaN that would break movement. Type an
// exact number into a row's field, or use -/+ for fine steps.
// Slimmed to the knobs we still actively tune. Everything else lives in the
// `settings` object above at its tuned default (still adjustable in code, just
// not exposed live). Ask to re-expose any row if it needs tuning again.
export const TUNABLE_GROUPS: { group: string; items: Tunable[] }[] = [
  {
    group: 'SPEEDS',
    items: [
      { key: 'forceLocalSpeeds', label: 'force local speeds', step: 1, min: 0, max: 1, decimals: 0, toggle: true },
      { key: 'walkSpeed', label: 'walk speed', step: 0.25, min: 0, max: 100, decimals: 2 },
      { key: 'jogSpeed', label: 'jog speed', step: 0.25, min: 0, max: 100, decimals: 2 },
      { key: 'sprintSpeed', label: 'sprint speed', step: 0.25, min: 0, max: 100, decimals: 2 },
    ],
  },
  {
    group: 'BLENDS',
    items: [
      { key: 'transIdle', label: 'idle blend (s)', step: 0.05, min: 0, max: 20, decimals: 3 },
      { key: 'transWalk', label: 'walk blend (s)', step: 0.05, min: 0, max: 20, decimals: 3 },
      { key: 'transRun', label: 'jog/run blend (s)', step: 0.05, min: 0, max: 20, decimals: 3 },
      { key: 'transAir', label: 'air/jump blend (s)', step: 0.05, min: 0, max: 20, decimals: 3 },
    ],
  },
  {
    group: 'JUMP',
    items: [
      { key: 'hardLandingDrop', label: 'hard-land drop (m)', step: 0.5, min: 0, max: 100, decimals: 2 },
      { key: 'longFallDrop', label: 'long-fall drop (m)', step: 0.5, min: 0, max: 100, decimals: 2 },
    ],
  },
  {
    group: 'GLIDE',
    items: [
      { key: 'glideLeanRate', label: 'lean turn rate', step: 5, min: 0, max: 360, decimals: 1 },
      { key: 'glideForwardSpeed', label: 'forward @ (m/s)', step: 0.5, min: 0, max: 20, decimals: 2 },
      { key: 'gliderOpenSpeed', label: 'glider deploy spd', step: 0.5, min: 0.1, max: 20, decimals: 2 },
    ],
  },
];

// Apply a +/- step to a tunable, clamped and rounded to its decimals to avoid
// floating-point drift accumulating over many clicks.
export function bumpSetting(t: Tunable, dir: number) {
  if (t.toggle) {
    settings[t.key] = settings[t.key] === 0 ? 1 : 0;
    return;
  }
  let v = settings[t.key] + dir * t.step;
  v = Math.max(t.min, Math.min(t.max, v));
  v = parseFloat(v.toFixed(t.decimals));
  settings[t.key] = v;
}

// Apply a typed-in value (string from the panel's text field). Ignores
// non-numeric input; clamps to the tunable's bounds and rounds to its decimals.
export function setSettingFromString(t: Tunable, raw: string) {
  const n = parseFloat(raw);
  if (!isFinite(n)) return;
  let v = Math.max(t.min, Math.min(t.max, n));
  v = parseFloat(v.toFixed(t.decimals));
  settings[t.key] = v;
}

// Dump current values to the console in a form easy to copy back into code.
export function logSettings() {
  const lines = Object.entries(settings).map(([k, v]) => `  ${k}: ${v},`);
  console.log('=== movement settings ===\n{\n' + lines.join('\n') + '\n}');
}
