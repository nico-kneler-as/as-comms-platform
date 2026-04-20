import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

/**
 * Adventure Scientists monogram — inlined from the official AS-Mark SVG.
 *
 * The artwork is authored in a Y-flipped coordinate system (typical of
 * converted Illustrator exports); we preserve the source `translate/scale`
 * transform rather than re-projecting, so the paths stay pixel-identical to
 * the asset on disk. Fill is `currentColor` so the caller can recolor via
 * Tailwind text classes.
 *
 * Lives under `app/_components/` so both `/inbox` and `/settings` can render
 * it from the shared {@link ./primary-icon-rail.PrimaryIconRail} without
 * reaching into inbox-scoped files.
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
