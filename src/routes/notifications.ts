import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { isValidUuid } from "../lib/validation";

const router = Router();

router.get("/notifications", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const data = await prisma.notification.findMany({ where: { userId: userId }, orderBy: { createdAt: "desc" }, take: 30 });
    const unreadCount = await prisma.notification.count({ where: { userId: userId, readAt: null } });
    res.json({ data: data, unreadCount: unreadCount });
  } catch (err) {
    next(err);
  }
});

router.get("/notifications/unread-count", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    res.json({ unreadCount: unreadCount });
  } catch (err) {
    next(err);
  }
});

router.post("/notifications/read-all", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

router.post("/notifications/:id/read", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (!isValidUuid(id)) {
      throw new AppError(400, "INVALID_ID", "That notification ID is not valid");
    }
    const notification = await prisma.notification.findFirst({ where: { id: id, userId: req.user!.id } });
    if (!notification) {
      throw new AppError(404, "NOT_FOUND", "Notification not found");
    }
    const updated = notification.readAt ? notification : await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
    res.json({ notification: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
