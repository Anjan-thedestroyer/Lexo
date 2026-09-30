import UserModel from "../model/User.model.js"
import jwt from 'jsonwebtoken'

const genertedRefreshToken = async (userId) => {
    const token = await jwt.sign({ id: userId },
        process.env.SECRET_KEY_REFRESH_TOKEN,
        { expiresIn: '9d' }
    )

    const updateRefreshTokenUser = await UserModel.updateOne(
        { _id: userId },
        {
            refresh_token: token
        }
    )

    return token;
}
//name
export default genertedRefreshToken        