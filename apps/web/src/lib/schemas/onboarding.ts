import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  age: z.number({ error: "Age is required" }).int().min(18, "Must be 18+").max(100, "Must be under 100"),
  gender: z.string().min(1, "Gender is required"),
  state: z.string().min(1, "State is required"),
  city: z.string().min(2, "City must be at least 2 characters"),
  upiId: z.string()
    .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/, "Enter a valid UPI ID (e.g., name@upi)")
    .max(50, "UPI ID must be under 50 characters")
    .optional()
    .or(z.literal("")),
});

export const languagesSchema = z.object({
  primaryLanguage: z.string().min(1, "Select a primary language"),
  additionalLanguages: z.array(z.string()).default([]),
  dialects: z.array(z.string()).default([]),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
export type LanguagesFormValues = z.infer<typeof languagesSchema>;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const INDIAN_LANGUAGES = [
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "ta", name: "Tamil" },
  { code: "ur", name: "Urdu" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "as", name: "Assamese" },
  { code: "mai", name: "Maithili" },
  { code: "sa", name: "Sanskrit" },
  { code: "sd", name: "Sindhi" },
  { code: "ne", name: "Nepali" },
  { code: "kok", name: "Konkani" },
  { code: "doi", name: "Dogri" },
  { code: "mni", name: "Manipuri" },
  { code: "sat", name: "Santali" },
  { code: "ks", name: "Kashmiri" },
  { code: "bo", name: "Bodo" },
  { code: "en", name: "English" },
] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu & Kashmir", "Ladakh",
  "Chandigarh", "Puducherry", "Lakshadweep",
  "Andaman & Nicobar Islands", "Dadra & Nagar Haveli and Daman & Diu",
] as const;
