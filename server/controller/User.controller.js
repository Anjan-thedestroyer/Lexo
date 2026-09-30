import bcrypt from "bcryptjs";
import UserModel from "../model/User.model.js";
import generatedAccessToken from "../utils/generatedAccessToken.js";
import genertedRefreshToken from "../utils/generatedRefreshToken.js";

export async function loginController(req, res) {
    try {
        const { email, password } = req.body;

        // 1. Validate
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
                success: false,
                error: true,
            });
        }

        // 2. Find user
        const user = await UserModel.findOne({
            email: email.toLowerCase().trim(),
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password",
                success: false,
                error: true,
            });
        }

        // 3. Check account status
        if (user.status && user.status !== "Active") {
            return res.status(403).json({
                message: "Your account is not active",
                success: false,
                error: true,
            });
        }

        // 4. Check password
        const isPasswordValid = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                message: "Invalid email or password",
                success: false,
                error: true,
            });
        }

        // 5. Generate tokens
        const accessToken = await generatedAccessToken(user._id);
        const refreshToken = await genertedRefreshToken(user._id);

        // 6. Save refresh token if your model supports it
        await UserModel.findByIdAndUpdate(user._id, {
            refresh_token: refreshToken,
            last_login_date: new Date(),
        });

        // 7. Cookie options
       const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production",
         sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", };

        res.cookie("accessToken", accessToken, cookieOptions);
        res.cookie("refreshToken", refreshToken, cookieOptions);

        // Don't return the JWTs to frontend JS
        return res.status(200).json({
            message: "Login successful",
            success: true,
            error: false,
            data: {
                userId: user._id,
                name: user.name,
                email: user.email,
                rootWalletAddress: user.rootWalletAddress,
            },
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
            error: true,
        });
    }
}
export async function logoutController(req, res) {
    try {
        const userId = req.userId;

        // Clear cookies
        const cookieOptions = {
            httpOnly: true,
            secure: true,
            sameSite: "None",
        };

        res.clearCookie("accessToken", cookieOptions);
        res.clearCookie("refreshToken", cookieOptions);

        // Remove stored refresh token
        if (userId) {
            await UserModel.findByIdAndUpdate(userId, {
                refresh_token: "",
            });
        }

        return res.status(200).json({
            message: "Logout successful",
            success: true,
            error: false,
        });

    } catch (error) {
        console.error("Logout error:", error);

        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
            error: true,
        });
    }
}
export async function registerController(req, res) {
    try {
        const { name, email, phone, password } = req.body;

        // 1. Validate
        if (!name || !email || !phone || !password) {
            return res.status(400).json({
                message: "Name, email, phone and password are required",
                success: false,
                error: true,
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must be at least 8 characters",
                success: false,
                error: true,
            });
        }

        // 2. Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // 3. Check existing user
        const existingUser = await UserModel.findOne({
            email: normalizedEmail,
        });

        if (existingUser) {
            return res.status(409).json({
                message: "An account with this email already exists",
                success: false,
                error: true,
            });
        }

        // 4. Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 5. Create user
        const user = await UserModel.create({
            name: name.trim(),
            email: normalizedEmail,
            phone: phone.trim(),
            password: hashedPassword,
            status: "Active",
            role: "USER",
        });

        // 6. Response
        return res.status(201).json({
            message: "Account created successfully",
            success: true,
            error: false,
            data: {
                userId: user._id,
                name: user.name,
                email: user.email,
            },
        });
    } catch (error) {
        console.error("Register error:", error);

        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
            error: true,
        });
    }
}
export async function meController(req, res) {
    try {
        const user = await UserModel.findById(req.userId)
            .select("-password -refresh_token");

        if (!user) {
            return res.status(404).json({
                message: "User not found",
                success: false,
                error: true,
            });
        }

        if (user.status !== "Active") {
            return res.status(403).json({
                message: "Your account is not active",
                success: false,
                error: true,
            });
        }

        return res.status(200).json({
            message: "Authenticated",
            success: true,
            error: false,
            data: {
                userId: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status,
                identityVerification: user.identityVerification,
                rootWallet: user.rootWallet,
                wallets: user.wallets,
                passport: user.passport,
            },
        });
    } catch (error) {
        console.error("Me controller error:", error);

        return res.status(500).json({
            message: error.message || "Internal server error",
            success: false,
            error: true,
        });
    }
}