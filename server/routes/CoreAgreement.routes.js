import express from "express";
import multer from "multer";
import { setCoreAgreement, getCoreAgreement, checkCoreDocs } from "../controller/CoreAgreement.controller.js";

const upload = multer({ storage: multer.memoryStorage() });
const CoreAgreementRouter = express.Router();

CoreAgreementRouter.post("/create", upload.single("termsDocs"), setCoreAgreement);
CoreAgreementRouter.get("/", getCoreAgreement);
CoreAgreementRouter.post("/verify", upload.single("termsDocs"), checkCoreDocs);

export default CoreAgreementRouter;