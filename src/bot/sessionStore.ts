import type { ExpenseRow, ParsedCategoryIssue } from "../types";

export type EditMode = "manual_add" | "freeform_edit" | "category_clarify" | "add_entry" | "remove_entry";
export type EditableField = "name" | "amount" | "category" | "date" | "remarks";

export interface PendingFieldEdit {
  itemIndex: number;
  field: EditableField;
}

export interface UserSession {
  targetDb: string;
  targetLabel: string;
  pendingRows: ExpenseRow[];
  mode?: EditMode;
  categoryOptions?: string[];
  ambiguousItems?: ParsedCategoryIssue[];
  currentAmbiguousPos?: number;
  pendingFieldEdit?: PendingFieldEdit;
}

const sessions = new Map<number, UserSession>();

export function getSession(userId: number): UserSession | undefined {
  return sessions.get(userId);
}

export function setSession(userId: number, session: UserSession): void {
  sessions.set(userId, session);
}

export function patchSession(userId: number, partial: Partial<UserSession>): UserSession {
  const current = sessions.get(userId) ?? {
    targetDb: "",
    targetLabel: "Unknown",
    pendingRows: []
  };

  const next: UserSession = {
    ...current,
    ...partial,
    pendingRows: partial.pendingRows ?? current.pendingRows
  };

  sessions.set(userId, next);
  return next;
}

export function clearSession(userId: number): void {
  sessions.delete(userId);
}
