export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Hire Line Dancers"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="46" height="46" rx="2" fill="#E7A33C" stroke="#FBFAF5" strokeWidth="2" />
      {/* dancing figure */}
      <g
        fill="none"
        stroke="#1C2A44"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="24.5" cy="13" r="3.6" fill="#1C2A44" stroke="none" />
        {/* torso */}
        <path d="M24 17.5 L22.5 27.5" />
        {/* arms raised */}
        <path d="M23.6 20 L16 13.5" />
        <path d="M23.8 20.2 L32.5 15.5" />
        {/* legs mid-step */}
        <path d="M22.5 27.5 L16.5 37.5" />
        <path d="M22.5 27.5 L30 35.5" />
      </g>
      {/* floor line */}
      <path d="M9 40 H39" stroke="#1C2A44" strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <span className="brand-name">Hire Line Dancers</span>
    </span>
  );
}
