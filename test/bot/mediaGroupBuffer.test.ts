import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaGroupBuffer, sortMediaGroupItems } from "../../src/bot/mediaGroupBuffer";

afterEach(() => {
  vi.useRealTimers();
});

describe("media group buffering", () => {
  it("sorts grouped photos by message id before flushing", () => {
    vi.useFakeTimers();
    const calls: string[][] = [];
    const buffer = new MediaGroupBuffer<string>(50, (items) => {
      calls.push(items.map((item) => item.payload));
    });

    buffer.add({ userId: 1, mediaGroupId: "album", messageId: 20, payload: "second" });
    buffer.add({ userId: 1, mediaGroupId: "album", messageId: 10, payload: "first" });

    vi.advanceTimersByTime(50);
    expect(calls).toEqual([["first", "second"]]);
  });

  it("keeps unrelated users and media groups separate", () => {
    vi.useFakeTimers();
    const calls: string[][] = [];
    const buffer = new MediaGroupBuffer<string>(50, (items) => {
      calls.push(items.map((item) => item.payload));
    });

    buffer.add({ userId: 1, mediaGroupId: "same", messageId: 1, payload: "user-1" });
    buffer.add({ userId: 2, mediaGroupId: "same", messageId: 1, payload: "user-2" });
    buffer.add({ userId: 1, mediaGroupId: "other", messageId: 1, payload: "other-album" });

    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(3);
    expect(calls).toContainEqual(["user-1"]);
    expect(calls).toContainEqual(["user-2"]);
    expect(calls).toContainEqual(["other-album"]);
  });

  it("sorts without mutating the original array", () => {
    const items = [
      { userId: 1, mediaGroupId: "album", messageId: 2, payload: "second" },
      { userId: 1, mediaGroupId: "album", messageId: 1, payload: "first" }
    ];

    const sorted = sortMediaGroupItems(items);
    expect(sorted.map((item) => item.payload)).toEqual(["first", "second"]);
    expect(items.map((item) => item.payload)).toEqual(["second", "first"]);
  });
});
