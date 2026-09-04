import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.MONGODB_URI ) {
    throw new Error("Please set  MONGODB_URI in your .env");
}

export async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Main DB connected');
    } catch (error) {
        console.log("Main DB connection error", error);
        process.exit(1);
    }
}

