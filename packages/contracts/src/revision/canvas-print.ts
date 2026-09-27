import { z } from "zod";

export const canvasPrintSnapshotSchema = z.object({
  html: z.string().min(1).max(5_000_000),
  page_width: z.number().finite().positive(),
  page_height: z.number().finite().positive(),
  page_tops: z.array(z.number().finite().nonnegative()).min(1),
}).refine(({ page_tops }) => page_tops.every((top, index) => index === 0 || top > page_tops[index - 1]), {
  message: "Page offsets must increase",
  path: ["page_tops"],
});

export type CanvasPrintSnapshot = z.infer<typeof canvasPrintSnapshotSchema>;
