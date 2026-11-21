interface MonitorGeometry {
  id: string;
  isPrimary: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
}

interface SwitcherTask {
  hwnd: number;
  monitor: string;
}

/** Physical screen order, retaining the existing MRU order within each screen. */
export function groupTasksByMonitor<T extends SwitcherTask, M extends MonitorGeometry>(tasks: T[], monitors: M[]) {
  const groups = monitors.toSorted((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top)
    .map((monitor) => ({ monitor, windows: [] as T[] }));
  const byMonitor = new Map(groups.map((group) => [group.monitor.id, group]));
  const fallback = groups.find((group) => group.monitor.isPrimary) ?? groups[0];
  const seen = new Set<number>();
  for (const task of tasks) {
    if (seen.has(task.hwnd)) continue;
    seen.add(task.hwnd);
    // A monitor can disappear between its topology event and the window update.
    (byMonitor.get(task.monitor) ?? fallback)?.windows.push(task);
  }
  return groups;
}

export function cycleTask(
  tasks: readonly SwitcherTask[],
  currentHwnd: number | null,
  direction: "next" | "previous",
): number | null {
  if (tasks.length === 0) return null;
  const current = tasks.findIndex((task) => task.hwnd === currentHwnd);
  if (current === -1) return tasks[direction === "next" ? 0 : tasks.length - 1]!.hwnd;
  const step = direction === "next" ? 1 : -1;
  return tasks[(current + step + tasks.length) % tasks.length]!.hwnd;
}
