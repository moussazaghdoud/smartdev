import type { Request, Response, NextFunction } from 'express';

export function tokenAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.BRIDGE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'BRIDGE_TOKEN not configured' });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
