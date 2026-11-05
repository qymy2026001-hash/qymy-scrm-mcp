import { z } from "zod";

export const conversationStatusSchema = z.enum(["open", "resolved", "pending", "snoozed"]);

export const listConversationsInput = z.object({
  status: conversationStatusSchema.default("open"),
  inbox_id: z.number().int().positive().optional(),
  page: z.number().int().positive().max(100).default(1),
  limit: z.number().int().positive().max(25).optional(),
});

export const getConversationInput = z.object({
  conversation_id: z.number().int().positive(),
});

export const listMessagesInput = z
  .object({
    conversation_id: z.number().int().positive(),
    before: z.number().int().positive().optional(),
    after: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(20).optional(),
  })
  .refine((value) => !(value.before !== undefined && value.after !== undefined), {
    message: "Pass only one of before or after.",
  });

export const sendReplyInput = z
  .object({
    conversation_id: z.number().int().positive(),
    content: z.string().trim().min(1).max(5000),
    private: z.boolean().default(false),
  })
  .strict();

export const searchContactsInput = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.number().int().positive().max(50).default(1),
});

export const getContactInput = z.object({
  contact_id: z.number().int().positive(),
});

export type ListConversationsInput = z.output<typeof listConversationsInput>;
export type GetConversationInput = z.output<typeof getConversationInput>;
export type ListMessagesInput = z.output<typeof listMessagesInput>;
export type SendReplyInput = z.output<typeof sendReplyInput>;
export type SearchContactsInput = z.output<typeof searchContactsInput>;
export type GetContactInput = z.output<typeof getContactInput>;
