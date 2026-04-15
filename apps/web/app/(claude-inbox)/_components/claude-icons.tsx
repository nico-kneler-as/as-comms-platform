import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

/**
 * Inline icon library for the Claude Inbox prototype.
 *
 * The project doesn't ship with shadcn/ui or lucide-react as dependencies,
 * so we maintain a small set of stroke-first icons drawn in the same house
 * style (24x24, 1.75 stroke, round linecaps). Shapes intentionally track
 * common lucide outlines so swapping in a real icon pack later is trivial.
 */

function Base(props: IconProps & { readonly path: string }) {
  const { path, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"
    />
  );
}

export function MegaphoneIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM14 8a5 5 0 010 8M18 5a9 9 0 010 14"
    />
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13.5a1 1 0 00.2 1.1l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1 1 0 00-1.1-.2 1 1 0 00-.6.9V18a2 2 0 01-4 0v-.1a1 1 0 00-.7-.9 1 1 0 00-1.1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1 1 0 00.2-1.1 1 1 0 00-.9-.6H5.9a2 2 0 010-4H6a1 1 0 00.9-.6 1 1 0 00-.2-1.1l-.1-.1a2 2 0 112.8-2.8l.1.1a1 1 0 001.1.2h0a1 1 0 00.6-.9V5.9a2 2 0 014 0V6a1 1 0 00.6.9 1 1 0 001.1-.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1 1 0 00-.2 1.1V11a1 1 0 00.9.6h.1a2 2 0 010 4h-.1a1 1 0 00-.9.6z"
    />
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-3.5-3.5"
    />
  );
}

export function FilterIcon(props: IconProps) {
  return <Base {...props} path="M4 5h16M7 12h10M10 19h4" />;
}

export function MailIcon(props: IconProps) {
  return <Base {...props} path="M4 6h16v12H4zM4 7l8 6 8-6" />;
}

export function PhoneIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M5 4h3l2 5-2.5 1.5a12 12 0 006 6L15 14l5 2v3a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z"
    />
  );
}

export function NoteIcon(props: IconProps) {
  return <Base {...props} path="M5 4h10l4 4v12H5zM14 4v5h5M8 13h7M8 17h5" />;
}

export function SparkleIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"
    />
  );
}

export function SendIcon(props: IconProps) {
  return <Base {...props} path="M4 12l16-8-6 18-3-8-7-2z" />;
}

export function ChevronRightIcon(props: IconProps) {
  return <Base {...props} path="M9 6l6 6-6 6" />;
}

export function MapPinIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
    />
  );
}

export function CalendarIcon(props: IconProps) {
  return <Base {...props} path="M4 7h16v13H4zM4 10h16M8 3v4M16 3v4" />;
}

export function ClockIcon(props: IconProps) {
  return <Base {...props} path="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2" />;
}

export function PanelRightOpenIcon(props: IconProps) {
  return <Base {...props} path="M4 5h16v14H4zM15 5v14M11 10l-2 2 2 2" />;
}

export function PanelRightCloseIcon(props: IconProps) {
  return <Base {...props} path="M4 5h16v14H4zM15 5v14M9 10l2 2-2 2" />;
}

export function CornerUpLeftIcon(props: IconProps) {
  return <Base {...props} path="M9 14l-5-5 5-5M4 9h11a5 5 0 015 5v6" />;
}

export function XIcon(props: IconProps) {
  return <Base {...props} path="M6 6l12 12M18 6L6 18" />;
}

export function LogOutIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
    />
  );
}

/**
 * Adventure Scientists monogram — inlined from the official AS-Mark SVG.
 * The artwork is authored in a Y-flipped coordinate system (typical of
 * converted Illustrator exports); we preserve the source `translate/scale`
 * transform rather than re-projecting, so the paths stay pixel-identical to
 * the asset on disk. Fill is `currentColor` so the caller can recolor via
 * Tailwind text classes.
 */
export function AdventureScientistsLogo(props: IconProps) {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 1200 1200"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <g
        transform="translate(0,1200) scale(0.1,-0.1)"
        fill="currentColor"
        stroke="none"
      >
        <path d="M5735 10984 c-705 -46 -1339 -214 -1944 -515 l-195 -97 -60 49 c-107 87 -223 129 -356 129 -392 0 -659 -393 -514 -756 l25 -63 -159 -156 c-503 -489 -890 -1066 -1151 -1712 -452 -1121 -475 -2393 -65 -3531 551 -1527 1813 -2692 3382 -3122 636 -175 1370 -218 2030 -120 1480 220 2785 1097 3554 2389 83 140 228 425 293 576 537 1254 535 2679 -7 3930 -192 444 -436 840 -756 1225 -130 156 -478 501 -640 635 -294 243 -587 433 -937 611 -546 276 -1132 447 -1745 510 -147 14 -627 26 -755 18z m616 -204 c611 -48 1173 -198 1714 -459 232 -112 357 -184 585 -336 272 -181 471 -345 716 -590 215 -214 311 -324 460 -522 645 -860 979 -1909 950 -2978 -7 -264 -23 -434 -66 -692 -73 -437 -204 -845 -404 -1258 -115 -236 -187 -363 -332 -580 -396 -595 -900 -1076 -1519 -1450 -971 -587 -2129 -805 -3255 -614 -1246 211 -2380 927 -3105 1960 -198 282 -424 697 -540 994 -296 753 -397 1567 -295 2372 115 897 481 1732 1074 2448 101 121 435 468 469 487 14 7 30 2 71 -27 119 -82 290 -114 430 -81 309 73 501 396 411 692 -14 45 -13 50 3 63 36 29 385 192 542 254 429 170 903 279 1370 316 154 12 566 13 721 1z" />
        <path d="M5348 7940 c-9 -6 -497 -600 -1085 -1320 -713 -875 -1071 -1322 -1077 -1344 -13 -48 18 -107 65 -123 26 -9 672 -12 2747 -12 2949 -1 2754 -5 2800 54 31 39 28 86 -5 127 -96 114 -1650 1905 -1662 1915 -9 7 -34 13 -57 13 -48 0 -40 8 -373 -362 -118 -131 -217 -238 -221 -238 -4 0 -229 282 -501 628 -272 345 -504 637 -516 650 -24 24 -83 30 -115 12z" />
      </g>
    </svg>
  );
}
