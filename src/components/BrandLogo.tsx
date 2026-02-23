import { useId } from "react";

type BrandLogoProps = {
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
  showTagline?: boolean;
};

const BrandLogo = ({
  compact = false,
  iconOnly = false,
  className = "",
  showTagline = true,
}: BrandLogoProps) => {
  const clipPathId = useId();

  const mark = (
    <svg viewBox="0 0 120 120" className={compact ? "h-9 w-9" : "h-11 w-11"} aria-hidden="true">
      <defs>
        <clipPath id={clipPathId}>
          <polygon points="60,10 104,35 104,85 60,110 16,85 16,35" />
        </clipPath>
      </defs>
      <polygon
        points="60,3 111,32 111,88 60,117 9,88 9,32"
        fill="#233772"
        stroke="#233772"
        strokeWidth="4"
      />
      <polygon
        points="60,10 104,35 104,85 60,110 16,85 16,35"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
      />
      <g clipPath={`url(#${clipPathId})`}>
        <path
          d="M28 38h18v27c0 8 6 15 14 17 8 3 17 0 22-7l2-3c4-6 10-9 16-9 11 0 20 9 20 20s-9 20-20 20c-7 0-13-4-17-10"
          transform="translate(-14 -16) scale(1.05)"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="74" cy="57" r="2.8" fill="#ffffff" />
        <path
          d="M47 57c3-4 9-6 15-3"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );

  if (iconOnly) {
    return <div className={`inline-flex ${className}`}>{mark}</div>;
  }

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        {mark}
        <span className="text-base font-extrabold leading-none tracking-tight text-inherit">
          김윤환입시연구소
        </span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {mark}
      <div className="leading-tight">
        <p className="text-xl font-black tracking-tight text-inherit">김윤환입시연구소</p>
        {showTagline && (
          <p className="text-[11px] font-semibold text-inherit/80">
            논구술을 꿰뚫는 힘, 합격으로 증명하다
          </p>
        )}
      </div>
    </div>
  );
};

export default BrandLogo;
