import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import {connectDB} from "./config/connectDB.js";
import CoreAgreementRouter from "./routes/CoreAgreement.routes.js";
import authRouter from "./routes/auth.routes.js";
import escrowRouter from "./routes/Escrow.routes.js";
import verificationRouter from "./routes/Verification.routes.js";
import { startIdentityRegisterListener } from "./listener/identityRegister.listener.js";
import agreementRoutes from "./routes/Agreement.routes.js";
import reqRouter from "./routes/Req.routes.js";
// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;


// Security Middleware
app.use(helmet());

// Cross-Origin Resource Sharing Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));


// startAgreementListeners();
// startEscrowListener();
startIdentityRegisterListener();
// Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

// Sample API Route Integration
// import agreementRoutes from "./routes/agreement.routes.js";
// app.use("/api/v1/agreements", agreementRoutes);

app.use("/api/core-agreement",CoreAgreementRouter);
app.use("/api/auth",authRouter);
app.use("/api/escrow",escrowRouter)
app.use("/api/verification",verificationRouter)
app.use("/api/agreement",agreementRoutes)
app.use("/api/req",reqRouter)
// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Resource not found",
  });
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(` Server running http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database Connection Failure:", error.message);
    process.exit(1);
  }
};

startServer();