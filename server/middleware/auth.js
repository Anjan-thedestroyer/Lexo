import jwt from "jsonwebtoken";

const authMiddleware = (req, res, next) => {
    try {
        const accessToken = req.cookies?.accessToken;

        if (!accessToken) {
            return res.status(401).json({
                message: "Authentication required",
                success: false,
                error: true,
            });
        }

        const decoded = jwt.verify(
            accessToken,
            process.env.SECRET_KEY_ACCESS_TOKEN
        );

        req.userId = decoded.id;

        next();
    } catch (error) {
        return res.status(401).json({
            message: "Access token expired or invalid",
            success: false,
            error: true,
        });
    }
};

export default authMiddleware;