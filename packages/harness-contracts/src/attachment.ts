import { z } from "zod";

export const harnessAttachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  mime_type: z.string().max(150),
  size: z.number().int().min(1).max(10 * 1024 * 1024),
  content: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string().min(1).max(120_000) }),
    z.object({ type: z.literal("image"), image_url: z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/) }),
  ]),
});

export const harnessAttachmentsSchema = z.array(harnessAttachmentSchema).max(6).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "Duplicate attachment id" });
  if (new TextEncoder().encode(JSON.stringify(items)).byteLength > 7_000_000) ctx.addIssue({ code: "custom", message: "Attachments exceed 7 MB transport limit" });
});
export type HarnessAttachment = z.infer<typeof harnessAttachmentSchema>;
