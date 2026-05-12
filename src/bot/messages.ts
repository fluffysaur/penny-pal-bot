export const messages = {
  notAllowed: "Sorry, this bot is private right now. Please ask the owner to grant access.",
  cancelled: "No worries, cancelled. Nothing was written.",
  welcome: (name: string) =>
    `Hey ${name}! Send me a receipt or transaction screenshot and I will help log it for you. ✨`,
  manualPrompt: (label: string) =>
    `${label}, send one or more manual entries in either format:\n` +
    "1) item | amount | category | date | remarks\n" +
    "2) item amount category [date] [remarks]\n\n" +
    "Example: Coffee | 4.50 | Food | 2026-05-04 | team lunch",
  parseInProgress: (label: string) =>
    `Thanks ${label}! I am reading your transactions now. This can take up to 2 minutes for long receipts. 👀`,
  parseTimedOut:
    "I could not finish reading that image in time 😢. Please retry with a clearer crop or fewer entries.",
  parseNoRows:
    "I could not confidently read any transactions from that image 😕. Please try again with a clearer photo or tighter crop.",
  parseError:
    "Something went wrong while reading that image 😞. Please retry in a moment.",
  processingEdit: "Got it, updating your draft now ✍️",
  submitInProgress: (label: string) => `Almost there, ${label}... saving your expense log now.`,
  submitSuccess: (label: string) => `Done! Logged successfully for ${label}. 🤑`,
  help: [
    "Here is what I can do for you:",
    "/start - show welcome message",
    "/help - show this help message",
    "/manual - manually log one or more entries",
    "/cancel - cancel current draft",
    "",
    "Edit examples:",
    "- update items 3, 5, 6 to Food",
    "- set items 2, 4 amount to 12.50",
    "- change items 1, 2 to income",
    "",
    "You can also send:",
    "- a receipt/screenshot image",
    "- free-form edit instructions while reviewing rows"
  ].join("\n")
};
