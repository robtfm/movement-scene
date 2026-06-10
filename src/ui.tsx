// In-game debug panel for live-tuning movement feel. Renders as a UI overlay
// (works because this scene runs as a portable, so it draws on top of the
// client). Toggle with the floating button top-right. Each row shows the
// current value with -/+ steppers; changes take effect immediately because the
// movement code reads settings.* every frame.
import ReactEcs, { ReactEcsRenderer, UiEntity, Label, Button, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { settings, TUNABLE_GROUPS, Tunable, bumpSetting, setSettingFromString, logSettings, resetSettings } from './settings'
import { activeAnimationState, publishedAnimation, velocity } from '.'

let panelOpen = false

const BG = Color4.create(0.05, 0.05, 0.08, 0.85)
const HEADER_BG = Color4.create(0.15, 0.5, 0.9, 1)
const BTN_BG = Color4.create(0.2, 0.22, 0.3, 1)
const TOGGLE_ON = Color4.create(0.2, 0.7, 0.35, 1)
const TOGGLE_OFF = Color4.create(0.5, 0.2, 0.2, 1)

function valueText(t: Tunable): string {
  const v = settings[t.key]
  if (t.toggle) return v === 0 ? 'OFF' : 'ON'
  return v.toFixed(t.decimals)
}

function Row(t: Tunable) {
  return (
    <UiEntity
      key={t.key}
      uiTransform={{ width: '100%', height: 26, flexDirection: 'row', alignItems: 'center', margin: { bottom: 2 } }}
    >
      <Label
        value={t.label}
        fontSize={12}
        color={Color4.White()}
        uiTransform={{ width: 124, height: 26 }}
        textAlign="middle-left"
      />
      {t.toggle ? (
        <Button
          value={valueText(t)}
          fontSize={12}
          uiTransform={{ width: 150, height: 22 }}
          uiBackground={{ color: settings[t.key] === 0 ? TOGGLE_OFF : TOGGLE_ON }}
          onMouseDown={() => bumpSetting(t, 1)}
        />
      ) : (
        <UiEntity uiTransform={{ width: 160, height: 26, flexDirection: 'row', alignItems: 'center' }}>
          <Button
            value="-"
            fontSize={16}
            uiTransform={{ width: 24, height: 22 }}
            uiBackground={{ color: BTN_BG }}
            onMouseDown={() => bumpSetting(t, -1)}
          />
          {/* Live value (updates from -/+ and after a typed value is applied). */}
          <Label
            value={valueText(t)}
            fontSize={13}
            color={Color4.create(0.7, 0.9, 1, 1)}
            uiTransform={{ width: 48, height: 26 }}
            textAlign="middle-center"
          />
          <Button
            value="+"
            fontSize={16}
            uiTransform={{ width: 24, height: 22 }}
            uiBackground={{ color: BTN_BG }}
            onMouseDown={() => bumpSetting(t, 1)}
          />
          {/* Type a number + Enter to set exactly. Uncontrolled: the field
              clears on submit, and the live value Label above reflects the
              applied (clamped) result. */}
          <Input
            placeholder="set"
            placeholderColor={Color4.create(0.5, 0.55, 0.6, 1)}
            fontSize={12}
            color={Color4.create(0.85, 0.95, 1, 1)}
            uiTransform={{ width: 56, height: 22, margin: { left: 4 } }}
            uiBackground={{ color: Color4.create(0.12, 0.13, 0.18, 1) }}
            textAlign="middle-center"
            onSubmit={(v) => setSettingFromString(t, v)}
          />
        </UiEntity>
      )}
    </UiEntity>
  )
}

// Short clip name from a path like "assets/run.glb" -> "run".
function clipName(src: string | undefined): string {
  if (!src) return '-'
  const f = src.split('/').pop() ?? src
  return f.replace(/\.glb$/i, '')
}

// Live readout: what we publish vs. what the engine reports it's actually
// playing. If the "engine" row stays empty or its speed never matches the
// "sent" speed, the client isn't honoring our scene-driven animation.
function DebugReadout() {
  const hSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z)
  const sent = publishedAnimation
  const act = activeAnimationState
  const line = (label: string, text: string) => (
    <UiEntity uiTransform={{ width: '100%', height: 18, flexDirection: 'row' }}>
      <Label value={label} fontSize={11} color={Color4.create(0.6, 0.8, 1, 1)} uiTransform={{ width: 70, height: 18 }} textAlign="middle-left" />
      <Label value={text} fontSize={11} color={Color4.White()} uiTransform={{ width: 200, height: 18 }} textAlign="middle-left" />
    </UiEntity>
  )
  return (
    <UiEntity
      uiTransform={{ width: '100%', flexDirection: 'column', padding: 4, margin: { bottom: 4 } }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.4) }}
    >
      {line('h-speed', hSpeed.toFixed(2) + ' m/s')}
      {line('sent', sent ? `${clipName(sent.src)}  x${sent.speed.toFixed(2)}` : '-')}
      {line('engine', act ? `${clipName(act.src)}  x${act.speed.toFixed(2)}  t=${act.playbackTime.toFixed(2)}/${act.duration.toFixed(2)}` : '(none reported)')}
    </UiEntity>
  )
}

// Which groups are expanded. Collapsed by default except ANIMATION so the panel
// fits on screen; click a header to toggle. Keeps the list short while tuning.
const openGroups: { [g: string]: boolean } = { SPEEDS: false, ANIMATION: true, JUMP: false }

function GroupHeader(text: string) {
  const open = openGroups[text]
  return (
    <Button
      key={'h_' + text}
      value={(open ? '▼ ' : '▶ ') + text}
      fontSize={13}
      uiTransform={{ width: '100%', height: 22, margin: { top: 6, bottom: 2 } }}
      uiBackground={{ color: Color4.create(0.12, 0.22, 0.32, 1) }}
      onMouseDown={() => (openGroups[text] = !openGroups[text])}
    />
  )
}

function Panel() {
  return (
    <UiEntity
      uiTransform={{
        width: 320,
        positionType: 'absolute',
        position: { right: 12, top: 48 },
        flexDirection: 'column',
        padding: 10,
      }}
      uiBackground={{ color: BG }}
    >
      <Label
        value="MOVEMENT TUNER"
        fontSize={15}
        color={Color4.White()}
        uiTransform={{ width: '100%', height: 24 }}
        textAlign="middle-center"
      />
      {DebugReadout()}
      {TUNABLE_GROUPS.map((g) => [
        GroupHeader(g.group),
        ...(openGroups[g.group] ? g.items.map((t) => Row(t)) : []),
      ])}
      <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', margin: { top: 8 } }}>
        <Button
          value="RESET DEFAULTS"
          fontSize={12}
          uiTransform={{ width: '48%', height: 24, margin: { right: '4%' } }}
          uiBackground={{ color: Color4.create(0.55, 0.3, 0.2, 1) }}
          onMouseDown={resetSettings}
        />
        <Button
          value="LOG VALUES"
          fontSize={12}
          uiTransform={{ width: '48%', height: 24 }}
          uiBackground={{ color: HEADER_BG }}
          onMouseDown={logSettings}
        />
      </UiEntity>
    </UiEntity>
  )
}

const uiComponent = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
    <Button
      value={panelOpen ? 'X' : 'TUNE'}
      fontSize={13}
      uiTransform={{ width: 64, height: 28, positionType: 'absolute', position: { right: 12, top: 12 } }}
      uiBackground={{ color: HEADER_BG }}
      onMouseDown={() => {
        panelOpen = !panelOpen
      }}
    />
    {panelOpen ? Panel() : null}
  </UiEntity>
)

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiComponent)
}
