export interface MediaGroupItem<T> {
  userId: number;
  mediaGroupId: string;
  messageId: number;
  payload: T;
}

export function mediaGroupKey(item: Pick<MediaGroupItem<unknown>, "userId" | "mediaGroupId">): string {
  return `${item.userId}:${item.mediaGroupId}`;
}

export function sortMediaGroupItems<T>(items: MediaGroupItem<T>[]): MediaGroupItem<T>[] {
  return [...items].sort((a, b) => a.messageId - b.messageId);
}

export class MediaGroupBuffer<T> {
  private readonly groups = new Map<string, { items: MediaGroupItem<T>[]; timer: NodeJS.Timeout }>();

  constructor(
    private readonly debounceMs: number,
    private readonly onFlush: (items: MediaGroupItem<T>[]) => void | Promise<void>
  ) {}

  public add(item: MediaGroupItem<T>): void {
    const key = mediaGroupKey(item);
    const current = this.groups.get(key);
    if (current) {
      clearTimeout(current.timer);
      current.items.push(item);
      current.timer = this.scheduleFlush(key);
      return;
    }

    this.groups.set(key, { items: [item], timer: this.scheduleFlush(key) });
  }

  public pendingGroupCount(): number {
    return this.groups.size;
  }

  private scheduleFlush(key: string): NodeJS.Timeout {
    return setTimeout(() => {
      const group = this.groups.get(key);
      if (!group) {
        return;
      }
      this.groups.delete(key);
      void this.onFlush(sortMediaGroupItems(group.items));
    }, this.debounceMs);
  }
}
