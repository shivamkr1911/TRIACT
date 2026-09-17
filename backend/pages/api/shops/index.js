import connectDB from "../../../lib/db.js";
import Shop from "../../../models/Shop.js";
import User from "../../../models/User.js";
import { ownerMiddleware, signToken } from "../../../lib/auth.js";


async function handler(req, res) {
  
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  await connectDB();

  const { shopName, address } = req.body;
  const ownerId = req.user.id;

  if (!shopName) {
    return res.status(400).json({ message: "Shop name is required" });
  }

  try {
    const existingShop = await Shop.findOne({ ownerId });
    if (existingShop) {
      return res
        .status(409)
        .json({ message: "You have already created a shop." });
    }

    const newShop = new Shop({
      shopName,
      ownerId,
      address: address || "Address not set",
    });

    const savedShop = await newShop.save();

    const updatedUser = await User.findByIdAndUpdate(
      ownerId,
      { shopId: savedShop._id },
      { new: true }
    );

    const token = signToken(updatedUser);

    res.status(201).json({
      message: "Shop created successfully",
      shop: savedShop,
      token,
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        shopId: updatedUser.shopId,
      },
    });
  } catch (error) {
    console.error("Shop Creation Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export default ownerMiddleware(handler);
