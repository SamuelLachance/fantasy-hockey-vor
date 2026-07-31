interface BrandEyebrowProps {
  className?: string;
}

/** Shared cyan uppercase brand mark for loading / error / empty surfaces. */
export function BrandEyebrow({
  className = "text-sm text-cyan-400",
}: BrandEyebrowProps) {
  return (
    <p className={`font-medium uppercase tracking-[0.2em] ${className}`.trim()}>
      Fantasy Hockey VOR
    </p>
  );
}
