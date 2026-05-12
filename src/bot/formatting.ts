import { Markup } from "telegraf";
import type { ExpenseRow } from "../types";

export function renderPreviewText(targetLabel: string, rows: ExpenseRow[]): string {
  const lines: string[] = [`Detected owner/database: ${targetLabel}`, "", "I parsed the following rows:"];
  rows.forEach((row, index) => {
    const signHint = typeof row.amount === "number" && row.amount < 0 ? " (income/refund offset)" : "";
    lines.push(`${index + 1}. ${row.item} - ${row.amount} - ${row.category ?? "(guess)"} - ${row.date ?? ""}${signHint}`);
    if (row.remarks) {
      lines.push(`   Remarks: ${row.remarks}`);
    }
  });
  return lines.join("\n");
}

export function previewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Approve", "approve")],
    [Markup.button.callback("Edit", "edit_menu")],
    [Markup.button.callback("Cancel", "cancel")]
  ]);
}

export function editMenuKeyboard(rows: ExpenseRow[]) {
  const buttons = rows.map((row, index) => [
    Markup.button.callback(`Edit ${index + 1}: ${row.item.slice(0, 20)}`, `edit_item:${index}`)
  ]);
  buttons.push([
    Markup.button.callback("Add entry", "edit_add"),
    Markup.button.callback("Remove entry", "edit_remove")
  ]);
  buttons.push([Markup.button.callback("Back", "show_preview")]);
  buttons.push([Markup.button.callback("Cancel", "cancel")]);
  return Markup.inlineKeyboard(buttons);
}

export function itemFieldKeyboard(itemIndex: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Name", `edit_field:${itemIndex}:name`),
      Markup.button.callback("Amount", `edit_field:${itemIndex}:amount`)
    ],
    [
      Markup.button.callback("Category", `edit_field:${itemIndex}:category`),
      Markup.button.callback("Date", `edit_field:${itemIndex}:date`)
    ],
    [Markup.button.callback("Remarks", `edit_field:${itemIndex}:remarks`)],
    [
      Markup.button.callback("Mark as income/refund", `edit_type:${itemIndex}:income`),
      Markup.button.callback("Mark as expense", `edit_type:${itemIndex}:expense`)
    ],
    [Markup.button.callback("Delete item", `delete_item:${itemIndex}`)],
    [Markup.button.callback("Back", "edit_menu")],
    [Markup.button.callback("Cancel", "cancel")]
  ]);
}
