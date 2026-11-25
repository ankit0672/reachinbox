import { useState } from "react";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
}

/**
 * Photo avatar with the Figma letter-circle fallback (green circle, white
 * initial), used when there is no URL or the image fails to load.
 */
export function Avatar({ name, src, size = 32 }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { width: size, height: size };

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        referrerPolicy="no-referrer" // Google avatars refuse some referrers
        className="shrink-0 rounded-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      style={{ ...style, fontSize: size * 0.42 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-avatar font-semibold text-white"
    >
      {initial(name)}
    </span>
  );
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
