/** Original line icons (24px grid, 1.6 stroke). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m6 12.5 4 4 8-9" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconLinkedIn = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z" />
  </Svg>
);
export const IconGitHub = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.334-5.466-5.93 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.805 5.625-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l16 16M9.6 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.2 7.6A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1" />
  </Svg>
);
export const IconGhost = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="2.2 2.4" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" fillOpacity={0.25} stroke="none" />
  </Svg>
);
export const IconIsolate = (p: P) => (
  <Svg {...p}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconFocus = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);
export const IconReset = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
    <path d="M4.5 4.5V9H9" />
  </Svg>
);
export const IconRotate = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <path d="m16 5.6 2 2.4-2.6 1.4" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </Svg>
);
export const IconTree = (p: P) => (
  <Svg {...p}>
    <path d="M5 4v14a2 2 0 0 0 2 2h3M5 9h5M5 14h5" />
    <rect x="12" y="6.5" width="8" height="5" rx="1.2" />
    <rect x="12" y="11.5" width="8" height="5" rx="1.2" transform="translate(0 5)" />
  </Svg>
);
export const IconWarning = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 21 19.5H3Z" />
    <path d="M12 10v4.5M12 17h.01" />
  </Svg>
);
export const IconSection = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M12 6c-4 0-6 2.7-6 6s2 6 6 6" />
    <path d="M12 6c4 0 6 2.7 6 6s-2 6-6 6" opacity={0.35} />
  </Svg>
);
export const IconLabel = (p: P) => (
  <Svg {...p}>
    <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h9.4l4.6 5-4.6 5H5.5A1.5 1.5 0 0 1 4 13.5z" />
    <path d="M8 19v-4" />
    <circle cx="8" cy="20" r=".8" fill="currentColor" />
  </Svg>
);
export const IconExplode = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="6" height="6" rx="1.2" />
    <path d="M5 5l2.5 2.5M19 5l-2.5 2.5M5 19l2.5-2.5M19 19l-2.5-2.5" />
  </Svg>
);
export const IconTooth = (p: P) => (
  <Svg {...p}>
    <path d="M7.3 3.9c1.6-.6 3.1-.1 4.7.6 1.6-.7 3.1-1.2 4.7-.6 2 .8 2.3 3.4 1.6 5.6-.6 2-1 3.6-1.3 5.8-.2 1.1-1.5 1.2-1.8.2l-1.3-4.2c-.4-1-1.6-1-1.9 0L10.7 15.5c-.3 1-1.6.9-1.8-.2-.3-2.2-.7-3.8-1.3-5.8-.7-2.2-.4-4.8 1.7-5.6z" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />
  </Svg>
);
export const IconFlip = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18M8 7 4 12l4 5M16 7l4 5-4 5" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
  </Svg>
);
/** Fixed orbit: a ring around a fixed centre point. */
export const IconOrbitFixed = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8.5" ry="4" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="m18.5 6.8 1.6 1.6-2.2.6" />
  </Svg>
);
/** Free orbit: a pivot that can be moved. */
export const IconOrbitFree = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
    <path d="m10.5 5 1.5-1.5L13.5 5M10.5 19l1.5 1.5 1.5-1.5M5 10.5 3.5 12 5 13.5M19 10.5l1.5 1.5-1.5 1.5" />
  </Svg>
);

/* ---- view pictograms: what the camera will face, drawn as the teeth and jaws it will show ---- */

/** Upper and lower incisors seen head-on. */
export const IconViewFront = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 5.5h13v4.2c0 .7-.6 1.3-1.3 1.3H6.8c-.7 0-1.3-.6-1.3-1.3zM9.8 5.5V11M14.2 5.5V11" />
    <path d="M6.5 18.5h11v-4.2c0-.7-.6-1.3-1.3-1.3H7.8c-.7 0-1.3.6-1.3 1.3zM10.2 18.5V13M13.8 18.5V13" />
  </Svg>
);
/** The same rows receding to the side: a three-quarter view. */
export const IconViewThreeQuarter = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5 19.5 7.2v2.6c0 .7-.6 1.2-1.3 1.2H5.8c-.7 0-1.3-.6-1.3-1.3zM10.4 5.9V11M15.3 6.6V11" />
    <path d="M5.5 19 18.5 16.8v-2.5c0-.7-.6-1.3-1.3-1.3H6.8c-.7 0-1.3.6-1.3 1.3zM10.6 18.1V13M14.9 17.4V13" />
  </Svg>
);
/** Lower jaw in profile, chin to the left: the patient's left side faces the camera. */
export const IconViewLeft = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12.5v3.2c0 1.6 1.1 2.8 2.7 2.8h8.3c1.2 0 2.1-.6 2.6-1.7L19.5 12V4.5l-1.8 1.4" />
    <path d="M6 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2M9.9 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2M13.8 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2" />
  </Svg>
);
/** Lower jaw in profile, chin to the right. */
export const IconViewRight = (p: P) => (
  <Svg {...p} style={{ transform: 'scaleX(-1)' }}>
    <path d="M4.5 12.5v3.2c0 1.6 1.1 2.8 2.7 2.8h8.3c1.2 0 2.1-.6 2.6-1.7L19.5 12V4.5l-1.8 1.4" />
    <path d="M6 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2M9.9 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2M13.8 12.5c0-1.2.6-2 1.6-2s1.6.8 1.6 2" />
  </Svg>
);
/** Skull seen from above: the crown of the head with the face at the bottom. */
export const IconViewSuperior = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c4.2 0 7 3.4 7 7.6 0 4.6-3.2 8.6-7 9.4-3.8-.8-7-4.8-7-9.4 0-4.2 2.8-7.6 7-7.6z" />
    <path d="M9.5 10.5c.8-.9 1.6-1.3 2.5-1.3s1.7.4 2.5 1.3" />
    <circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
/** Skull seen from below: the lower jaw's horseshoe inside the outline. */
export const IconViewInferior = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c4.2 0 7 3.4 7 7.6 0 4.6-3.2 8.6-7 9.4-3.8-.8-7-4.8-7-9.4 0-4.2 2.8-7.6 7-7.6z" />
    <path d="M8.5 8.5v4c0 2.6 1.6 4.6 3.5 4.6s3.5-2 3.5-4.6v-4" />
  </Svg>
);
/** Upper arch from the biting side: front teeth at the top, the palate side open below. */
export const IconViewOcclusalUpper = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 20v-8a6.5 6.5 0 0 1 13 0v8" />
    <path d="M9 20v-7.5a3 3 0 0 1 6 0V20" />
    <path d="M7.4 7.6 9.6 10M16.6 7.6 14.4 10M12 5.5v3" />
  </Svg>
);
/** Lower arch from the biting side: front teeth at the bottom. */
export const IconViewOcclusalLower = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 4v8a6.5 6.5 0 0 0 13 0V4" />
    <path d="M9 4v7.5a3 3 0 0 0 6 0V4" />
    <path d="M7.4 16.4 9.6 14M16.6 16.4 14.4 14M12 18.5v-3" />
  </Svg>
);
/** Generic "camera view" button used when the view picker is collapsed. */
export const IconView = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.6} />
  </Svg>
);
export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Svg>
);
