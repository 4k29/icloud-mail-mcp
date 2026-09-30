import { z } from "zod";
const short = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export const mailbox = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export const listSchema = z
  .object({
    offset: z.number().int().min(0).max(10_000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const searchSchema = z
  .object({
    mailbox,
    from: short.optional(),
    to: short.optional(),
    subject: short.optional(),
    keyword: short.optional(),
    since: day.optional(),
    before: day.optional(),
    unread: z.boolean().optional(),
    limit: z.number().int().min(1).max(20).default(10),
    cursor: z.string().max(2048).optional(),
    include_snippet: z.boolean().default(false),
  })
  .strict()
  .refine((x) => !x.since || !x.before || x.since < x.before, {
    message: "since must precede before",
  });
export const getSchema = z
  .object({
    message_id: z.string().min(1).max(2048),
    offset: z.number().int().min(0).max(1_048_576).default(0),
    length: z.number().int().min(2).max(16_000).default(8000),
  })
  .strict();
export type SearchInput = z.infer<typeof searchSchema>;
export type GetInput = z.infer<typeof getSchema>;
