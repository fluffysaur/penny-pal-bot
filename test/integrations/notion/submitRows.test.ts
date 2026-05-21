import { describe, expect, it } from "vitest";
import { fetchRelationOptionTitles, submitRowsToNotion } from "../../../src/integrations/notion/submitRows";

function makeSchema() {
  return {
    properties: {
      Item: { type: "title" },
      Amount: { type: "number" },
      Date: { type: "date" },
      Category: { type: "relation", relation: { database_id: "rel-db" } },
      Remarks: { type: "rich_text" }
    }
  };
}

function makeRelationPages() {
  return [
    {
      id: "rel-food",
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Food" }]
        }
      }
    },
    {
      id: "rel-life",
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Lifestyle" }]
        }
      }
    }
  ];
}

describe("submitRowsToNotion", () => {
  it("submits normalized rows with relation and remarks", async () => {
    const created: Array<{ databaseId: string; properties: Record<string, unknown> }> = [];
    const client = {
      getDatabase: async () => makeSchema(),
      queryDatabase: async (dbId: string) => (dbId === "rel-db" ? makeRelationPages() : []),
      createPage: async (input: { databaseId: string; properties: Record<string, unknown> }) => {
        created.push(input);
        return { id: "page-1" };
      }
    };

    const result = await submitRowsToNotion(
      client as any,
      "expenses-db",
      [
        {
          item: "Claude",
          amount: "29.98",
          category: "Software/Subscription",
          date: "2026-05-12",
          remarks: "monthly",
          type: "income"
        }
      ]
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(created).toHaveLength(1);
    expect(created[0].databaseId).toBe("expenses-db");

    const props = created[0].properties as Record<string, any>;
    expect(props.Item.title[0].text.content).toBe("Claude");
    expect(props.Amount.number).toBe(29.98);
    expect(props.Date.date.start).toBe("2026-05-12");
    expect(props.Category.relation[0].id).toBe("rel-life");
    expect(props.Remarks.rich_text[0].text.content).toContain("monthly");
    expect(props.Remarks.rich_text[0].text.content).toContain("income/refund offset");
  });

  it("throws on invalid date after normalization", async () => {
    const client = {
      getDatabase: async () => makeSchema(),
      queryDatabase: async () => makeRelationPages(),
      createPage: async () => ({ id: "page-1" })
    };

    await expect(
      submitRowsToNotion(client as any, "expenses-db", [
        {
          item: "Coffee",
          amount: "4.50",
          category: "Food",
          date: "not-a-date"
        }
      ])
    ).rejects.toThrow("Invalid date after normalization");
  });
});

describe("fetchRelationOptionTitles", () => {
  it("returns relation option titles", async () => {
    const client = {
      getDatabase: async () => makeSchema(),
      queryDatabase: async (dbId: string) => (dbId === "rel-db" ? makeRelationPages() : [])
    };

    const titles = await fetchRelationOptionTitles(client as any, "expenses-db");
    expect(titles).toEqual(["Food", "Lifestyle"]);
  });
});
