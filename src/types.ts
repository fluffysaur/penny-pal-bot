export type TransactionType = "income" | "expense";

export interface ExpenseRow {
  item: string;
  amount: number | string;
  category?: string;
  date?: string;
  confidence?: number;
  remarks?: string;
  type?: TransactionType;
}

export interface ParsedCategoryIssue {
  index: number;
  rawCategory: string;
}
