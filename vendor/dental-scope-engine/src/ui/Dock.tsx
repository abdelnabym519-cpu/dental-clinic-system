import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { formatTooth } from '../anatomy/notation';
import { navigate } from '../app/router';
import { nameOf, useT, type Messages } from '../i18n';
import { actions, DISSECT_LEVELS, getState, useApp, type ClipAxis } from '../state/store';
import { CameraControls } from './CameraControls';
import { useServices } from './context';
import { PanelHandle } from './PanelHandle';
import { JawMotionControls } from './JawMotionControls';
import { FEEDBACK_TEXT } from '../i18n/feedback';
import { useLang } from '../i18n';
import { IconArrowLeft, IconExplode, IconFlip, IconLabel, IconPause, IconPlay, IconReplay, IconSection, IconWarning } from './icons';
import { DevelopmentTimeline, DevelopmentTools } from './DevelopmentControls';
import { NumberingControls } from './TopBar';

/** Section planes; names and titles are in the messages (`axis`, `toothAxis`). */
const AXES: ClipAxis[] = ['sagittal', 'coronal', 'axial', 'view'];

export function Dock() {
  const dissectFdi = useApp((s) => s.dissectFdi);
  const mobileOpen = useApp((s) => s.mobileSheet === 'tools');
  const collapsed = useApp((s) => s.collapsed.dock);
  const jawControls = useApp((s) => s.jawControls);
  const development = useApp((s) => s.developmentStage !== null);
  const quiz = useApp((s) => s.mode === 'quiz');
  const clip = useApp((s) => s.clip.enabled);
  const surfaceFeatures = useApp((s) => s.surfaceFeatures);
  const quizPicked = useApp((s) => s.mode === 'quiz' && s.selectedId !== null);
  const m = useT();
  // In Quiz mode the dock shrinks to inspection tools that act on the tooth picked on
  // the board. The camera, the section plane and the surface-feature overlay are all
  // answer-safe: none of them names a tooth.
  if (quiz) {
    return (
      <div className={`ds-dock${mobileOpen ? ' is-mobile-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
        <PanelHandle panel="dock" />
        <div className="ds-panel ds-toolbar" role="toolbar" aria-label={m.toolbarScene}>
          <CameraControls />
          <div className="ds-dock-tools">
            <ToolToggle
              active={clip}
              disabled={!quizPicked}
              onClick={() => actions.setClip({ enabled: !clip, axis: 'sagittal', offset: 0 })}
              icon={<IconSection />}
              label={m.section}
              title={quizPicked ? m.sectionTitle : m.quizPickFirst}
            />
            <ToolToggle
              active={surfaceFeatures}
              disabled={!quizPicked}
              onClick={() => actions.setSurfaceFeatures(!surfaceFeatures)}
              icon={<IconLabel />}
              label={m.quizSurface}
              title={quizPicked ? m.quizSurfaceTitle : m.quizPickFirst}
            />
          </div>
        </div>
        <SectionControls />
      </div>
    );
  }
  return (
    <div className={`ds-dock${mobileOpen ? ' is-mobile-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <PanelHandle panel="dock" />
      <div className="ds-compact-settings ds-panel"><span>{m.numberingGroup}</span><NumberingControls /></div>
      {dissectFdi === null && <DevelopmentTimeline />}
      <div className="ds-panel ds-toolbar" role="toolbar" aria-label={dissectFdi !== null ? m.toolbarDissect : m.toolbarScene}>
        <CameraControls />
        {development ? <DevelopmentTools /> : dissectFdi !== null ? <DissectControls fdi={dissectFdi} /> : jawControls ? <JawMotionControls /> : <ArchControls />}
      </div>
      {!development && <SectionControls />}
    </div>
  );
}

/**
 * Arch dissection on one track: 0 → 1 pulls the structures apart in position (store `explode`),
 * the checkpoint at 1 is "In position", and 1 → 2 lays them out on the board (phase 2).
 * Play runs to the next stop: from anywhere before the checkpoint it stops at the checkpoint,
 * from the checkpoint it continues to "Laid out", and at the end it replays from the start.
 */
const PLAY_SECONDS_TO_CHECKPOINT = 2.2;
const PLAY_SECONDS_TO_LAYOUT = 1.2;

function ArchControls() {
  const { engine } = useServices();
  const lang = useLang();
  const explode = useApp((s) => s.explode);
  const phase = useApp((s) => s.explodePhase);
  const labels = useApp((s) => s.labels);
  const jawControls = useApp((s) => s.jawControls);
  const loading = useApp((s) => s.loading.teeth);
  const clip = useApp((s) => s.clip.enabled);
  const m = useT();
  // UI-only positions on the right half, where the store is discrete (phase 1 or 2)
  const [local, setLocal] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const preparation = useRef<(() => void) | null>(null);

  const stored = phase === 2 ? 2 : explode;
  const value = local ?? stored;
  const atEnd = phase === 2 && local === null;

  const stop = () => {
    preparation.current?.();
    preparation.current = null;
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  };
  useEffect(() => () => { preparation.current?.(); cancelAnimationFrame(raf.current); }, []);
  // the global Reset button stops playback and clears the local dot position
  const resetId = useApp((s) => s.resetId);
  useEffect(() => {
    preparation.current?.();
    preparation.current = null;
    cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- playback state must clear only after the frame above is cancelled; a render-phase reset could let a queued frame write stale state first.
    setPlaying(false);
    setLocal(null);
  }, [resetId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same ordering as the reset effect: cancel queued frames, then clear playback state.
    if (jawControls) { preparation.current?.(); preparation.current = null; cancelAnimationFrame(raf.current); setPlaying(false); setLocal(null); }
  }, [jawControls]);

  const tween = (from: number, to: number, seconds: number, apply: (v: number) => void, done: () => void) =>
    animateFrames(raf, from, to, seconds, easeInOutQuad, apply, done);

  const play = () => {
    if (playing) return stop();
    const s = getState();
    let from = s.explodePhase === 2 ? 2 : s.explode;
    if (from >= 2) {
      // replay from the start
      actions.setExplode(0);
      from = 0;
    }
    setPlaying(true);
    if (from < 1) {
      const separate = () => {
        preparation.current = null;
        tween(from, 1, (1 - from) * PLAY_SECONDS_TO_CHECKPOINT, (v) => actions.setExplode(v), () => {
          actions.setExplode(1);
          setPlaying(false); // pause at the checkpoint
        });
      };
      if (from === 0) preparation.current = engine.prepareArchDissection(separate, () => { preparation.current = null; setPlaying(false); });
      else separate();
    } else {
      actions.setExplodePhase(2);
      tween(1, 2, PLAY_SECONDS_TO_LAYOUT, setLocal, () => {
        setLocal(null);
        setPlaying(false);
      });
    }
  };

  const scrub = (v: number) => {
    stop();
    if (v <= 1) {
      setLocal(null);
      actions.setExplode(v);
      return;
    }
    setLocal(v);
    const s = getState();
    if (v >= 1.5 && s.explodePhase !== 2) actions.setExplodePhase(2);
    else if (v < 1.5 && s.explodePhase === 2) {
      actions.setExplodePhase(1);
      actions.setExplode(1);
    }
  };
  // releasing on the right half snaps to the nearer stop
  const release = () => {
    if (local === null || playing) return;
    setLocal(null);
  };

  const readout = value < 1 ? m.pct(Math.round(value * 100)) : value < 1.5 ? m.inPosition : m.laidOut;
  const playLabel = playing ? m.pause : atEnd ? m.replayDissection : value >= 1 ? m.playLayOut : m.playPullApart;

  return (
    <div className="ds-dock-main">
      <button type="button" data-tour="dissect-anatomy-play" className={`ds-play${playing ? ' is-playing' : ''}`} onClick={play} aria-label={playLabel} title={playLabel}>
        <PlayIcon playing={playing} atEnd={atEnd} />
      </button>
      <div className="ds-slider ds-slider--dissect">
        <div className="ds-slider-head">
          <span className="ds-slider-label">
            <IconExplode size={15} /> {m.dissectAnatomy}
          </span>
          <span className="ds-slider-value">{readout}</span>
        </div>
        <div className="ds-range-wrap">
          <span className={`ds-checkpoint${value >= 1 ? ' is-past' : ''}${Math.abs(value - 1) < 0.04 ? ' is-under-thumb' : ''}`} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={value}
            onChange={(e) => scrub(Number(e.target.value))}
            onPointerUp={release}
            onKeyUp={release}
            onBlur={release}
            aria-label={m.dissectAnatomy}
            aria-valuetext={readout}
            className="ds-range"
            style={{ ['--fill' as string]: `${(value / 2) * 100}%` }}
          />
        </div>
        <div className="ds-slider-ends ds-slider-ends--three" aria-hidden="true">
          <span>{m.assembled}</span>
          <span>{m.inPosition}</span>
          <span>{m.laidOut}</span>
        </div>
      </div>
      <div className="ds-dock-tools">
        <button type="button" className="ds-tool" onClick={() => void engine.showJaw()} title={FEEDBACK_TEXT[lang].jawMotion}>{FEEDBACK_TEXT[lang].jawMotion}</button>
        <ToolToggle active={clip} onClick={() => actions.setClip({ enabled: !clip })} icon={<IconSection />} label={m.section} title={m.sectionTitle} />
        <LabelsToggle active={labels} />
      </div>
      {clip && loading !== undefined && loading < 1 && <div className="ds-dock-note">{m.loadingInternal(Math.round(loading * 100))}</div>}
    </div>
  );
}

/** Ease in and out (quadratic). */
const easeInOutQuad = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const linear = (k: number) => k;

/**
 * Drive `apply` from `from` to `to` over `seconds` on animation frames, then call `done`.
 * The pending frame id is kept in `raf` so the caller can cancel it.
 */
function animateFrames(raf: RefObject<number>, from: number, to: number, seconds: number, ease: (k: number) => number, apply: (v: number) => void, done: () => void) {
  const t0 = performance.now();
  const ms = Math.max(1, seconds * 1000);
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    apply(from + (to - from) * ease(k));
    if (k < 1) raf.current = requestAnimationFrame(tick);
    else done();
  };
  raf.current = requestAnimationFrame(tick);
}

/** rAF tween shared by the tooth play buttons; stops on unmount. */
function useTween() {
  const raf = useRef(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const stop = () => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  };
  const run = (from: number, to: number, seconds: number, apply: (v: number) => void, ease = true) => {
    cancelAnimationFrame(raf.current);
    setPlaying(true);
    animateFrames(raf, from, to, seconds, ease ? easeInOutQuad : linear, apply, () => setPlaying(false));
  };
  return { playing, run, stop };
}

const LAST_LEVEL = DISSECT_LEVELS.length - 1;
const SECONDS_PER_LEVEL = 1.3;
const SECONDS_TO_APART = 1.8;

function PlayButton({ playing, atEnd, onClick, labels }: { playing: boolean; atEnd: boolean; onClick: () => void; labels: Messages['playLevels'] }) {
  const label = playing ? labels.pause : atEnd ? labels.replay : labels.play;
  return (
    <button type="button" className={`ds-play${playing ? ' is-playing' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <PlayIcon playing={playing} atEnd={atEnd} />
    </button>
  );
}

function PlayIcon({ playing, atEnd }: { playing: boolean; atEnd: boolean }) {
  return playing ? <IconPause size={16} /> : atEnd ? <IconReplay size={16} /> : <IconPlay size={16} />;
}

function DissectControls({ fdi }: { fdi: number }) {
  const { registry, engine } = useServices();
  const level = useApp((s) => s.dissectLevel);
  const tex = useApp((s) => s.toothExplode);
  const numbering = useApp((s) => s.numbering);
  const labels = useApp((s) => s.labels);
  const clip = useApp((s) => s.clip.enabled);
  const ctx = useApp((s) => s.isolateContext);
  const lang = useApp((s) => s.lang);
  const m = useT();
  const tooth = registry.get(`tooth-${fdi}`)!;
  const levels = useTween();
  const layers = useTween();
  const exit = () => {
    void navigate(() => { actions.exitDissect(); actions.select(`tooth-${fdi}`); engine.focus(`tooth-${fdi}`); });
  };

  // steps through every level to Root canals, holding briefly on each one
  const playLevels = () => {
    if (levels.playing) return levels.stop();
    const from = getState().dissectLevel >= LAST_LEVEL ? 0 : getState().dissectLevel;
    actions.setDissectLevel(from);
    levels.run(from, LAST_LEVEL + 0.999, (LAST_LEVEL - from + 1) * SECONDS_PER_LEVEL, (v) => {
      const l = Math.min(LAST_LEVEL, Math.floor(v));
      if (getState().dissectLevel !== l) actions.setDissectLevel(l);
    }, false);
  };
  const playLayers = () => {
    if (layers.playing) return layers.stop();
    const from = getState().toothExplode >= 1 ? 0 : getState().toothExplode;
    layers.run(from, 1, (1 - from) * SECONDS_TO_APART, (v) => actions.setToothExplode(v));
  };

  return (
    <div className="ds-dock-main ds-dissect">
      <div className="ds-dissect-bar">
        <div className="ds-dissect-head">
          <button type="button" className="ds-icon-btn ds-icon-btn--ghost" data-tour="back-mouth" onClick={exit} aria-label={m.backToFullMouth} title={m.backToFullMouthEsc}>
            <IconArrowLeft />
          </button>
          <div>
            <div className="ds-label-sm">{m.insideTooth}</div>
            <div className="ds-dissect-title">
              <span className="ds-chip ds-chip--mono">{formatTooth(fdi, numbering)}</span> {nameOf(tooth, lang)}
            </div>
          </div>
        </div>
        <div className="ds-dock-tools">
          <ToolToggle active={clip} onClick={() => actions.setClip({ enabled: !clip, axis: 'sagittal', offset: 0 })} icon={<IconSection />} label={m.section} title={m.sectionTitle} />
          <LabelsToggle active={labels} />
          <ToolToggle active={ctx} onClick={() => actions.setIsolateContext(!ctx)} icon={<IconExplode />} label={m.context} title={m.showSurrounding} />
        </div>
      </div>

      <div className="ds-play-row">
        <PlayButton playing={levels.playing} atEnd={level >= LAST_LEVEL} onClick={playLevels} labels={m.playLevels} />
        <div className="ds-play-body">
          <div className="ds-slider-head">
            <span className="ds-slider-label">
              <IconLayersStack /> {m.dissectionLevel}
            </span>
            <span className="ds-step-hint">{m.level[level][1]}</span>
          </div>
          <div className="ds-steps" role="radiogroup" aria-label={m.dissectionLevel} style={{ ['--progress' as string]: String(level / LAST_LEVEL) }}>
            {DISSECT_LEVELS.map((l) => (
              <button
                key={l.id}
                data-tour={`dissect-${l.id}`}
                type="button"
                role="radio"
                aria-checked={level === l.id}
                className={`ds-step${level === l.id ? ' is-active' : ''}${level > l.id ? ' is-past' : ''}`}
                style={{ ['--at' as string]: `${(l.id / LAST_LEVEL) * 100}%` }}
                onClick={() => {
                  levels.stop();
                  actions.setDissectLevel(l.id);
                }}
                title={m.level[l.id][1]}
              >
                <span className="ds-step-dot" aria-hidden="true" />
                <span className="ds-step-label">{m.level[l.id][0]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ds-play-row">
        <span data-tour="separate-layers"><PlayButton playing={layers.playing} atEnd={tex >= 1} onClick={playLayers} labels={m.playLayers} /></span>
        <div className="ds-play-body">
          <Slider
            label={m.separateLayers}
            icon={<IconExplode size={15} />}
            value={tex}
            onChange={(v) => {
              layers.stop();
              actions.setToothExplode(v);
            }}
            left={m.together}
            right={m.apart}
          />
        </div>
      </div>
    </div>
  );
}

function IconLayersStack() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

function SectionControls() {
  const clip = useApp((s) => s.clip);
  const inTooth = useApp((s) => s.dissectFdi !== null);
  const m = useT();
  if (!clip.enabled) return null;
  const names = inTooth ? m.toothAxis : m.axis;
  return (
    <div className="ds-panel ds-section-panel" role="group" aria-label={m.crossSection}>
      <div className="ds-segmented ds-segmented--fill" role="radiogroup" aria-label={m.sectionPlane}>
        {AXES.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={clip.axis === a} className={clip.axis === a ? 'is-active' : ''} onClick={() => actions.setClip({ axis: a, offset: 0 })} title={names[a][1]}>
            {names[a][0]}
          </button>
        ))}
      </div>
      <div className="ds-section-row">
        <input
          type="range"
          min={-1}
          max={1}
          step={0.005}
          value={clip.offset}
          onChange={(e) => actions.setClip({ offset: Number(e.target.value) })}
          aria-label={m.sectionPosition}
          className="ds-range"
        />
        <button type="button" className="ds-icon-btn" onClick={() => actions.setClip({ flip: !clip.flip })} aria-label={m.flipSection} title={m.flipSide}>
          <IconFlip />
        </button>
      </div>
    </div>
  );
}

function Slider({ label, icon, value, onChange, left, right }: { label: string; icon: React.ReactNode; value: number; onChange: (v: number) => void; left: string; right: string }) {
  const m = useT();
  return (
    <div className="ds-slider">
      <div className="ds-slider-head">
        <span className="ds-slider-label">
          {icon} {label}
        </span>
        <span className="ds-slider-value">{m.pct(Math.round(value * 100))}</span>
      </div>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} aria-valuetext={m.percent(Math.round(value * 100))} className="ds-range" />
      <div className="ds-slider-ends" aria-hidden="true">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function LabelsToggle({ active }: { active: boolean }) {
  const warnId = useId();
  const m = useT();
  return (
    <span className="ds-tool-wrap">
      <ToolToggle active={active} onClick={() => actions.toggleLabels()} icon={<IconLabel />} label={m.labels} describedBy={warnId} />
      {/* styled tooltip instead of a native title, so the performance note is visible on hover and keyboard focus */}
      <span className="ds-tool-warn" role="tooltip" id={warnId}>
        <IconWarning size={13} />
        {m.labelsLag}
        <kbd>L</kbd>
      </span>
    </span>
  );
}

function ToolToggle({
  active,
  onClick,
  icon,
  label,
  title,
  describedBy,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ds-tool${active ? ' is-active' : ''}`}
      onClick={() => {
        if (!disabled) onClick();
      }}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      title={title}
      aria-describedby={describedBy}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
