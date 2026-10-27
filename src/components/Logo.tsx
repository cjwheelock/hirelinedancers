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
      <rect x="1" y="1" width="46" height="46" rx="2" fill="#FBFAF5" stroke="#E7A33C" strokeWidth="2" />
      <svg x="3" y="4" width="42" height="40" viewBox="130 45 1190 1000">
        <image href="/images/brand-boots.png" width="1473" height="1068" />
      </svg>
    </svg>
  );
}

export function LogoWordmark() {
  return (
    <span className="brand-name" role="img" aria-label="Hire Line Dancers">
      <svg
        className="brand-wordmark brand-wordmark-full"
        viewBox="70 280 2000 210"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <image href="/images/brand-wordmark.png" width="2132" height="738" />
      </svg>
      <svg
        className="brand-wordmark brand-wordmark-compact"
        viewBox="0 0 1025 440"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <svg width="1025" height="210" viewBox="70 280 1025 210">
          <image href="/images/brand-wordmark.png" width="2132" height="738" />
        </svg>
        <svg y="230" width="1025" height="210" viewBox="1125 280 950 210" preserveAspectRatio="xMinYMid meet">
          <image href="/images/brand-wordmark.png" width="2132" height="738" />
        </svg>
      </svg>
    </span>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <LogoWordmark />
    </span>
  );
}
