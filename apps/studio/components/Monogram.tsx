/** A small lit-stage tile with the agent's initial: how agents are recognised in lists. */
export function Monogram({ name, size = 44 }: { name: string; size?: number }) {
  // Hue from the name so each agent keeps a stable tint.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: Math.round(size * 0.28),
        background: `radial-gradient(60% 50% at 50% 25%, hsl(${h} 60% 72% / .45), transparent 70%), linear-gradient(180deg, var(--stage-2), var(--stage-1))`,
        color: `hsl(${h} 70% 86%)`,
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        letterSpacing: "-0.02em",
      }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
