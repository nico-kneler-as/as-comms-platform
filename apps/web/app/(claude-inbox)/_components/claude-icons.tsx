import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

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
      path="M4 13l2.5-6.5A2 2 0 018.4 5.2h7.2a2 2 0 011.9 1.3L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5zM4 13h4a2 2 0 012 2 2 2 0 002 2h0a2 2 0 002-2 2 2 0 012-2h4"
    />
  );
}

export function StarIcon(props: IconProps & { readonly filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 16.9 6.8 19.8l1-5.9-4.3-4.2 5.9-.8z" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M12 9v4m0 3v.01M4.5 19h15a1.5 1.5 0 001.3-2.25l-7.5-13a1.5 1.5 0 00-2.6 0l-7.5 13A1.5 1.5 0 004.5 19z"
    />
  );
}

export function SearchIcon(props: IconProps) {
  return <Base {...props} path="M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-3.5-3.5" />;
}

export function FilterIcon(props: IconProps) {
  return <Base {...props} path="M4 5h16M7 12h10M10 19h4" />;
}

export function UsersIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 21a7 7 0 0118 0M17 7a3 3 0 010 6"
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

export function ArrowLeftIcon(props: IconProps) {
  return <Base {...props} path="M19 12H5M12 5l-7 7 7 7" />;
}

export function ChevronLeftIcon(props: IconProps) {
  return <Base {...props} path="M15 6l-6 6 6 6" />;
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

export function PanelRightOpenIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M4 5h16v14H4zM15 5v14M11 10l-2 2 2 2"
    />
  );
}

export function PanelRightCloseIcon(props: IconProps) {
  return (
    <Base
      {...props}
      path="M4 5h16v14H4zM15 5v14M9 10l2 2-2 2"
    />
  );
}
