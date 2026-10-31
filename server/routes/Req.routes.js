import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/auth.js";
import { acceptPayeeReq, createPayeeReq, getPayeeRequestsByUserId, rejectPayeeReq } from "../controller/Req.controller.js";
const upload = multer({
  storage: multer.memoryStorage(),
});

const reqRouter = express.Router();

reqRouter.post('/payee/request',authMiddleware,createPayeeReq)
reqRouter.post("/accept",authMiddleware,acceptPayeeReq)
reqRouter.post("/reject",authMiddleware,rejectPayeeReq)
reqRouter.get("/payee-req",authMiddleware,getPayeeRequestsByUserId)

export default reqRouter;