import { cookies } from "next/headers";
import { z } from "zod";
import { ACTIVE_BUSINESS_COOKIE } from "../business-constants";

const businessIdSchema = z.string().uuid();

export async function getActiveBusinessId(): Promise<string | null> {
  const value = cookies().get(ACTIVE_BUSINESS_COOKIE)?.value;
  if (!value) return null;
  const parsed = businessIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
