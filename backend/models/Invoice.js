import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    pdfData: {
      type: String,
      required: true,
      description: "Base64 encoded PDF data",
    },
    customerName: {
      type: String,
      required: true,
    },
    billerName: {
      type: String,
      required: true,
      default: "Unknown",
    },
    total: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export default mongoose.models.Invoice ||
  mongoose.model("Invoice", invoiceSchema);
