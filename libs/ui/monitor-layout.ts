/** Widget-owned profiles keep each physical monitor's layout independent. */
export interface PanelLayout {
  isReorderDisabled: boolean;
  left: unknown[];
  center: unknown[];
  right: unknown[];
}

export interface LayoutFiles {
  read(filename: string): Promise<string>;
  write(filename: string, content: string): Promise<void>;
}

export function monitorLayoutFilename(monitorId: string): string {
  if (!monitorId) throw new Error("Missing monitor identity");
  return `fxpw-monitor-${encodeURIComponent(monitorId)}.json`;
}

function validateLayout(value: unknown): asserts value is PanelLayout {
  const layout = value as PanelLayout | null;
  if (
    !layout || typeof layout.isReorderDisabled !== "boolean" ||
    !Array.isArray(layout.left) || !Array.isArray(layout.center) || !Array.isArray(layout.right)
  ) throw new Error("Invalid monitor layout");
}

export class MonitorLayout<T extends PanelLayout> {
  readonly filename: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(private monitorId: string, private files: LayoutFiles, private legacy: () => Promise<T>) {
    this.filename = monitorLayoutFilename(monitorId);
  }

  async load(): Promise<T> {
    await this.pending;
    let content: string;
    try {
      content = await this.files.read(this.filename);
    } catch (error) {
      // Only absence allows migration. Never overwrite inaccessible or corrupt profiles.
      if (!/os error 2\b|not found|cannot find|не удается найти/i.test(String(error))) throw error;
      const layout = await this.legacy();
      await this.save(layout);
      return layout;
    }
    const profile = JSON.parse(content);
    if (profile.version !== 1 || profile.monitorId !== this.monitorId) throw new Error("Invalid monitor profile");
    validateLayout(profile.layout);
    return profile.layout as T;
  }

  save(layout: T): Promise<void> {
    validateLayout(layout);
    // Snapshot before queuing so later reactive changes cannot modify this write.
    const content = JSON.stringify({ version: 1, monitorId: this.monitorId, layout });
    const write = this.pending.then(() => this.files.write(this.filename, content));
    this.pending = write.catch(() => {});
    return write;
  }
}

export function isSameMonitor(localId: string, remoteId: string | undefined): boolean {
  return remoteId === localId;
}
