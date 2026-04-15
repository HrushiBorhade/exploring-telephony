import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export function globalErrorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const log = req.log || logger;
  log.error({
    err: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    statusCode: err.status || err.statusCode || 500,
  }, "Unhandled error");

  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
}
