import { z } from "zod";

export const harnessUserQuestionSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).refine((value) => !["constructor", "prototype"].includes(value)),
  header: z.string().min(1).max(80),
  question: z.string().min(1).max(2000),
  options: z.array(z.object({ label: z.string().min(1).max(200), description: z.string().max(1000) }).strict()).min(2).max(6).optional(),
}).strict();
export const harnessUserQuestionsSchema = z.object({ questions: z.array(harnessUserQuestionSchema).min(1).max(3) }).strict()
  .refine((value) => new Set(value.questions.map((question) => question.id)).size === value.questions.length, "Question ids must be unique");
export const harnessUserAnswersSchema = z.record(z.string(), z.string().trim().min(1).max(6000));
export type HarnessUserQuestion = z.infer<typeof harnessUserQuestionSchema>;
