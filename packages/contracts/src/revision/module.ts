import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const resumeModuleTypeSchema = z.enum([
  "BasicInfo",
  "CareerSummary",
  "JobIntent",
  "CoreSkills",
  "WorkExperience",
  "ProjectExperience",
  "Education",
  "InternshipExperience",
  "Certificates",
  "Awards",
  "Portfolio",
  "SelfEvaluation",
  "CustomModule",
]);

export const documentModuleStatusSchema = z.enum([
  "clean",
  "needs_review",
  "needs_confirmation",
  "weak",
  "hidden",
]);

export const documentModuleSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  pack_id: z.string().min(1),
  type: resumeModuleTypeSchema.or(z.string().min(1)),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  visibility: z.enum(["visible", "hidden"]),
  status: documentModuleStatusSchema,
  data: z.record(z.unknown()),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type ResumeModuleType = z.infer<typeof resumeModuleTypeSchema>;
export type DocumentModuleStatus = z.infer<typeof documentModuleStatusSchema>;
export type DocumentModule = z.infer<typeof documentModuleSchema>;
