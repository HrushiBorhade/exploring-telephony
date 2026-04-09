import { type Request, type Response, type NextFunction } from "express";
import { getSessionByToken } from "@repo/db";

export interface AuthRequest extends Request {
  userId?: string;
  userPhone?: string;
  userRole?: string;
}

/**
 * Extract the raw session token from the cookie header.
 * Better Auth signs cookies as "{token}.{signature}" — we need
 * only the token portion (before the first dot) to query the DB.
 */
function getSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/
  );
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  // Strip the ".signature" suffix that Better Auth appends
  const dotIdx = raw.indexOf(".");
  return dotIdx !== -1 ? raw.slice(0, dotIdx) : raw;
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
  req.userRole = sess.role ?? "user";
  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
