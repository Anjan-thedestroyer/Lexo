import bcrypt from "bcryptjs";
import identityRegisterService from "../services/identityRegister.service";

export async function reqAttestationForIdentityRegistration(req, res) {
    try{
    const {name,email,phone,password,rootWalletAddress,nullifier,nationality} = req.body; 
    if(!name || !email  || !phone || !password || !rootWalletAddress || !passportHash || !nationality){
        return res.status(400).json({
            message: "All fields are required",
            success: false,
        }); 
    }


    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password,salt)

    const data = await identityRegisterService(name,email,phone,nullifier,rootWalletAddress,password = hashedPassword,nationality);


    }catch(error){
        console.error("Error requesting attestation for identity registration:", error);
        return res.status(500).json({
            message: "Internal server error",
            success: false,
        });
    }
}