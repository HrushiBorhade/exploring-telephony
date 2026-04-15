import crypto from "node:crypto";
import { logger } from "../logger";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: typeof logger;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader("x-request-id", req.id);
  next();
}
