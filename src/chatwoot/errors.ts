export type ChatwootErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "upstream"
  | "network"
  | "invalid"
  | "redirect";

export class ChatwootError extends Error {
  readonly status: number;
  readonly kind: ChatwootErrorKind;

  constructor(message: string, status: number, kind: ChatwootErrorKind) {
    super(message);
    this.name = "ChatwootError";
    this.status = status;
    this.kind = kind;
  }
}
