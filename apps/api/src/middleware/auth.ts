import { type Request, type Response, type NextFunction } from "express";
import { getSessionByToken } from "@repo/db";

export interface AuthRequest extends Request {
  userId?: string;
  userPhone?: string;
}

function getSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getSessionToken(req.headers.cookie);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sess = await getSessionByToken(token);

  if (!sess) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }

  req.userId = sess.userId;
  req.userPhone = sess.phoneNumber ?? undefined;
  next();
}
