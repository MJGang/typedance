import { z } from "zod";

export const harnessContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image"),
    image_url: z.string().url().max(8_000_000),
    detail: z.enum(["low", "high", "original", "auto"]).optional(),
  }),
]);

export type HarnessContentPart = z.infer<typeof harnessContentPartSchema>;
export type HarnessModelContent = string | HarnessContentPart[];
