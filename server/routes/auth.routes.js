import express from "express";
import {
    registerController,
    loginController,
    logoutController,
    meController,
} from "../controller/User.controller.js";
import authMiddleware from "../middleware/auth.js";

const authRouter = express.Router();

// POST /api/auth/register
authRouter.post(
    "/register",
    registerController
);

// POST /api/auth/login
authRouter.post(
    "/login",
    loginController
);

// GET /api/auth/me
authRouter.get(
    "/me",
    authMiddleware,
    meController
);

// POST /api/auth/logout
authRouter.post(
    "/logout",
    authMiddleware,
    logoutController
);

export default authRouter;