import express from "express";

import {
  loginController,
  logoutController,
} from "../controller/User.controller.js";

const authRouter = express.Router();

// --------------------------------------------------
// Authentication
// --------------------------------------------------

// POST /api/auth/login
authRouter.post(
  "/login",
  loginController
);

// POST /api/auth/logout
authRouter.post(
  "/logout",
  logoutController
);

export default authRouter;