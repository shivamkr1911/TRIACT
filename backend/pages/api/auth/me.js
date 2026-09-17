import connectDB from "../../../lib/db.js";
import User from "../../../models/User.js";
import { authMiddleware } from "../../../lib/auth.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  await connectDB();

  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        shopId: user.shopId,
        salary: user.salary,
      },
    });
  } catch (error) {
    console.error("Auth /me Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export default authMiddleware(handler);
