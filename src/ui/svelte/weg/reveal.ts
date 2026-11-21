export interface DockBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The dock can be inset from the physical edge by another desktop bar. */
export function isDockRevealPoint(
  point: { x: number; y: number },
  monitor: DockBounds,
  hitbox: DockBounds,
  position: "Top" | "Bottom" | "Left" | "Right",
  panel: DockBounds | null,
): boolean {
  const { x, y } = point;
  if (x < monitor.left || x >= monitor.right || y < monitor.top || y >= monitor.bottom) return false;
  // The adjacent toolbar strip, rather than every nearby bottom pixel, is the launcher.
  if (position === "Bottom" && hitbox.bottom < monitor.bottom) return y >= hitbox.bottom;
  if (position === "Top" && hitbox.top > monitor.top) return y < hitbox.top;
  if (position === "Left" && hitbox.left > monitor.left) return x < hitbox.left;
  if (position === "Right" && hitbox.right < monitor.right) return x >= hitbox.right;
  // Without an adjacent bar, retain a narrow activation zone under the dock itself.
  if (!panel) return false;
  const horizontal = position === "Top" || position === "Bottom";
  if (horizontal ? x < panel.left || x >= panel.right : y < panel.top || y >= panel.bottom) return false;
  const near = (value: number, edge: number) => Math.abs(value - edge) <= 2;
  switch (position) {
    case "Top":
      return near(y, monitor.top) || near(y, hitbox.top);
    case "Bottom":
      return near(y, monitor.bottom - 1) || near(y, hitbox.bottom - 1);
    case "Left":
      return near(x, monitor.left) || near(x, hitbox.left);
    case "Right":
      return near(x, monitor.right - 1) || near(x, hitbox.right - 1);
  }
}
