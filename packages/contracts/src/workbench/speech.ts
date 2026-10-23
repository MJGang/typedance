import { z } from "zod";

export const speechPreferencesSchema = z.object({
  language: z.enum(["auto", "zh", "en", "yue", "ja", "ko"]),
  download_origin: z.enum(["https://hf-mirror.com", "https://huggingface.co"]),
});
export const speechStatusSchema = speechPreferencesSchema.extend({
  phase: z.enum(["checking", "unprepared", "downloading", "ready", "failed"]),
  completed_bytes: z.number().nonnegative(),
  total_bytes: z.number().nonnegative(),
  error: z.string().optional(),
});
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>;
export type SpeechStatus = z.infer<typeof speechStatusSchema>;
