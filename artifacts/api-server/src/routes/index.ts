import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import tradersRouter from "./traders";
import profileRouter from "./profile";
import subscriptionsRouter from "./subscriptions";
import savedTradersRouter from "./saved-traders";
import enquiriesRouter from "./enquiries";
import categoriesRouter from "./categories";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(tradersRouter);
router.use(profileRouter);
router.use(subscriptionsRouter);
router.use(savedTradersRouter);
router.use(enquiriesRouter);
router.use(categoriesRouter);
router.use(contactRouter);

export default router;
