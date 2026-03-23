import type { Request, Response, NextFunction } from "express";
import { authStorage } from "../auth/storage";
import type { User } from "@shared/models/auth";
import { config } from "../config";

export interface RapidApiRequest extends Request {
  rapidApiUser: User;
}

export async function rapidApiAuth(req: Request, res: Response, next: NextFunction) {
  const proxySecret = req.headers["x-rapidapi-proxy-secret"];
  if (!config.RAPIDAPI_PROXY_SECRET || proxySecret !== config.RAPIDAPI_PROXY_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rapidApiUserId = req.headers["x-rapidapi-user"] as string | undefined;
  if (!rapidApiUserId) {
    return res.status(400).json({ error: "Missing X-RapidAPI-User header" });
  }

  const subscription = req.headers["x-rapidapi-subscription"] as string | undefined;

  try {
    const user = await authStorage.findOrCreateRapidApiUser(rapidApiUserId, subscription);
    (req as RapidApiRequest).rapidApiUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
