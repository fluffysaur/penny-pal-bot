import { Markup } from "telegraf";
import type { ExpenseRow } from "../types";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderPreviewText(targetLabel: string, rows: ExpenseRow[]): string {
  const lines: string[] = [`📋 <b>${escapeHtml(targetLabel)}</b>`, ""];
  rows.forEach((row, index) => {
    const isIncome = typeof row.amount === "number" && row.amount > 0;
    const icon = isIncome ? "💸" : "🛍";
    const amt =
      typeof row.amount === "number" ? row.amount.toFixed(2) : String(row.amount ?? "");
    const category = escapeHtml(row.category ?? "(guess)");
    const date = row.date ? escapeHtml(String(row.date)) : "";
    const meta = [category, date].filter(Boolean).join("  ·  ");
    lines.push(`${index + 1}. ${icon} <b>${escapeHtml(row.item)}</b>`);
    lines.push(`   ${amt}  ·  ${meta}`);
    if (row.remarks) {
      lines.push(`   📝 <i>${escapeHtml(String(row.remarks))}</i>`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

export function previewExtra() {
  return { ...previewKeyboard(), parse_mode: "HTML" as const };
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

export function removeItemKeyboard(rows: ExpenseRow[]) {
  const buttons = rows.map((row, index) => [
    Markup.button.callback(`Remove ${index + 1}: ${row.item.slice(0, 20)}`, `remove_item:${index}`)
  ]);
  buttons.push([Markup.button.callback("Back", "edit_menu")]);
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
    [Markup.button.callback("Delete item", `delete_item:${itemIndex}`)],
    [Markup.button.callback("Back", "edit_menu")],
    [Markup.button.callback("Cancel", "cancel")]
  ]);
}
