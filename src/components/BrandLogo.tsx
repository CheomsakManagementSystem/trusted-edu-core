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
}: BrandLogoProps) => {
  const sizeClass = iconOnly
    ? "w-10"
    : compact
      ? "w-56 max-w-full"
      : "w-80 max-w-full";

  return (
    <div className={`inline-flex items-center ${className}`}>
      <img
        src="/brand-logo.png"
        alt="김윤환입시연구소"
        className={`${sizeClass} h-auto shrink-0`}
        draggable="false"
      />
    </div>
  );
};

export default BrandLogo;
