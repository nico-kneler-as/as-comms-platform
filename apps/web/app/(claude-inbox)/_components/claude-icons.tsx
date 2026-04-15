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
 * Adventure Scientists monogram logo. Drawn inline so the prototype has no
 * binary dependency — the outer circle has a small satellite dot at the
 * top-left and a simple two-peak mountain silhouette inside.
 */
export function AdventureScientistsLogo(props: IconProps) {
  const { className, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="currentColor"
        strokeWidth={1.4}
        fill="none"
      />
      <circle cx="4.8" cy="6.3" r="1.5" fill="currentColor" />
      <path
        d="M6 16.25l3.9-5.3 2.6 3.1 2.1-2.5 3.4 4.7z"
        fill="currentColor"
      />
    </svg>
  );
}
