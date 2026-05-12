export interface NotionCreatePageInput {
  databaseId: string;
  properties: Record<string, unknown>;
}

interface QueryResponse {
  results?: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export class NotionClient {
  constructor(private readonly token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };
  }

  public async getDatabase(databaseId: string): Promise<unknown> {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: this.headers()
    });
    if (!res.ok) {
      throw new Error(`Notion getDatabase failed: ${res.status}`);
    }
    return res.json();
  }

  public async createPage(input: NotionCreatePageInput): Promise<unknown> {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        parent: { database_id: input.databaseId },
        properties: input.properties
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion createPage failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  public async queryDatabase(databaseId: string): Promise<unknown[]> {
    const out: unknown[] = [];
    let nextCursor: string | null = null;

    while (true) {
      const payload: Record<string, unknown> = { page_size: 100 };
      if (nextCursor) {
        payload.start_cursor = nextCursor;
      }

      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Notion queryDatabase failed: ${res.status} ${text}`);
      }

      const data = (await res.json()) as QueryResponse;
      out.push(...(data.results ?? []));
      if (!data.has_more) {
        break;
      }
      nextCursor = data.next_cursor ?? null;
    }

    return out;
  }
}
