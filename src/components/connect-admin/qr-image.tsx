// A QR code as inline SVG built from module paths (no injected markup). The quiet zone and colors
// come from the same renderer as the downloads, so what organizers preview is what prints.
export function QrImage({ path, modules, margin, colors, label, className }: {
  path: string; modules: number; margin: number; colors: { ink: string; background: string; frame: string | null };
  label: string; className?: string;
}) {
  const total = modules + margin * 2;
  return <svg role="img" aria-label={label} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" className={className}>
    {colors.frame && <rect width={total} height={total} fill={colors.frame} />}
    <rect x={colors.frame ? 2 : 0} y={colors.frame ? 2 : 0} width={colors.frame ? total - 4 : total} height={colors.frame ? total - 4 : total} fill={colors.background} />
    <path fill={colors.ink} d={path} />
  </svg>;
}
