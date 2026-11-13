const PATHS = {
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  models: (
    <>
      <path d="M4 4h5v16H4z" />
      <path d="M11 4h4v16h-4z" />
      <path d="M17 5l3 1-3 14-3-1z" />
    </>
  ),
  orgModel: (
    <>
      <rect x="9" y="3" width="6" height="5" />
      <rect x="3" y="16" width="6" height="5" />
      <rect x="15" y="16" width="6" height="5" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  notes: (
    <>
      <path d="M5 4h14v12l-4 4H5z" />
      <path d="M15 20v-4h4M8 9h8M8 13h5" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  organization: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3 19c.8-3 3.2-5 6-5s5.2 2 6 5M15 15c2.6 0 4.6 1.4 5.5 4" />
    </>
  ),
  workforce: <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6" />
    </>
  ),
  admin: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />,
  feedback: <path d="M4 5h16v11H8l-4 4z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  reset: (
    <>
      <path d="M4 4v6h6" />
      <path d="M5.5 15a7 7 0 101.6-8.1L4 10" />
    </>
  ),
  register: (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 21c1-4 3.8-6 7-6 1.3 0 2.5.3 3.5.9M18 14v6M15 17h6" />
    </>
  ),
  tree: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M12.5 8h5M12.5 12h5M12.5 16h3" />
    </>
  ),
  focus: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
};

export default function WorkspaceIcon({ name, size = 18 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] || null}
    </svg>
  );
}
