export function extractJsonArray(text: string): Record<string, unknown>[] {
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
    }
    if (parsed && typeof parsed === "object") {
      const asObject = parsed as Record<string, unknown>;
      for (const key of ["rows", "result", "data", "content", "text"]) {
        const value = asObject[key];
        if (Array.isArray(value)) {
          return value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
        }
        if (typeof value === "string") {
          return extractJsonArray(value);
        }
      }
    }
  } catch {
    // Fall through to bracket extraction.
  }

  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first !== -1 && last !== -1 && last > first) {
    try {
      const parsed = JSON.parse(text.slice(first, last + 1)) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
      }
    } catch {
      return [];
    }
  }

  return [];
}
