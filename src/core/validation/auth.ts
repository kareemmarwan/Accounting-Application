import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "البريد الإلكتروني مطلوب")
  .email("صيغة البريد الإلكتروني غير صحيحة")
  .toLowerCase();

export const passwordSchema = z
  .string()
  .min(6, "كلمة المرور يجب ألا تقل عن 6 أحرف")
  .max(72, "كلمة المرور طويلة جداً");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "كلمة المرور مطلوبة")
});

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "الاسم مطلوب (حرفان على الأقل)")
      .max(80, "الاسم طويل جداً"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"]
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
