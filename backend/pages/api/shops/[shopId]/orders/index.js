// backend/pages/api/shops/[shopId]/orders/index.js

import connectDB from "../../../../../lib/db.js";
import Order from "../../../../../models/Order.js";
import Product from "../../../../../models/Product.js";
import Invoice from "../../../../../models/Invoice.js";
import Notification from "../../../../../models/Notification.js";
import Shop from "../../../../../models/Shop.js";
import { authMiddleware } from "../../../../../lib/auth.js";
import PDFDocument from "pdfkit";
import mongoose from "mongoose";

// ===== FIXED: Generate PDF and return buffer =====
function generateInvoicePDF(order, shop) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    // Collect PDF data into buffer
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const formatCurrency = (amount) => `Rs. ${(amount || 0).toFixed(2)}`;

    // Header
    doc.fontSize(20).text(shop.shopName, { align: "center" });
    doc.fontSize(10).text(shop.address || "", { align: "center" });
    doc.moveDown(2);

    // Invoice Title
    doc.fontSize(16).text("INVOICE", { align: "left" });
    const detailsTop = doc.y;
    doc.fontSize(11).text(`Invoice #: ${order._id}`, 50, detailsTop);
    doc.text(`Customer: ${order.customerName}`, 50, detailsTop + 15);

    // Date & Biller Info
    doc.text(
      `Date: ${new Date(order.date).toLocaleString("en-IN")}`,
      300,
      detailsTop,
      { align: "right" },
    );
    doc.text(`Billed by: ${order.billerName}`, 300, detailsTop + 15, {
      align: "right",
    });
    doc.moveDown(3);

    // Table Header
    const tableTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Item", 50, tableTop);
    doc.text("Quantity", 250, tableTop, { width: 100, align: "right" });
    doc.text("Unit Price", 350, tableTop, { width: 100, align: "right" });
    doc.text("Total", 450, tableTop, { width: 100, align: "right" });
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    // Table Rows
    let y = tableTop + 25;
    doc.font("Helvetica").fontSize(10);
    order.items.forEach((item) => {
      doc.text(item.name, 50, y);
      doc.text(item.quantity.toString(), 250, y, {
        width: 100,
        align: "right",
      });
      doc.text(formatCurrency(item.price), 350, y, {
        width: 100,
        align: "right",
      });
      doc.text(formatCurrency(item.quantity * item.price), 450, y, {
        width: 100,
        align: "right",
      });
      y += 20;
    });

    doc.moveTo(50, y).lineTo(550, y).stroke();
    doc.moveDown();

    // Grand Total
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(`Grand Total: ${formatCurrency(order.total)}`, 300, doc.y + 10, {
        width: 250,
        align: "right",
      });

    doc.end();
  });
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  await connectDB();
  const { shopId } = req.query;
  const { customerName, items } = req.body;

  // ===== VALIDATION =====
  if (req.user.shopId !== shopId) {
    return res.status(403).json({ message: "Access denied." });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Order must contain items." });
  }

  if (!req.user || !req.user.name) {
    return res
      .status(400)
      .json({ message: "Biller name not found in authentication token." });
  }

  // Validate quantities and consolidate duplicate productIds
  const consolidatedMap = new Map();
  for (const item of items) {
    if (!item.productId) {
      return res.status(400).json({ message: "Each item must have a valid productId." });
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({
        message: `Quantity for all items must be a positive whole number. Invalid quantity received: ${item.quantity}`,
      });
    }

    const key = item.productId.toString();
    consolidatedMap.set(key, (consolidatedMap.get(key) || 0) + qty);
  }

  const consolidatedItems = Array.from(consolidatedMap.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  const decrementedProducts = [];

  try {
    // ===== FETCH SHOP DETAILS =====
    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Atomically decrement stock for each product; rollback if any fails
    for (const item of consolidatedItems) {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        // Rollback already deducted products
        for (const prev of decrementedProducts) {
          await Product.findByIdAndUpdate(prev.productId, { $inc: { stock: prev.quantity } });
        }
        return res.status(400).json({ message: `Invalid product ID: ${item.productId}` });
      }

      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          shopId: shopId,
          stock: { $gte: item.quantity },
        },
        {
          $inc: { stock: -item.quantity },
        },
        { new: true }
      );

      if (!updatedProduct) {
        // Insufficient stock or product not found -> Rollback previous decrements
        for (const prev of decrementedProducts) {
          await Product.findByIdAndUpdate(prev.productId, { $inc: { stock: prev.quantity } });
        }

        const existing = await Product.findOne({ _id: item.productId, shopId: shopId });
        if (!existing) {
          return res.status(404).json({ message: `Product not found: ${item.productId}` });
        } else {
          return res.status(400).json({
            message: `Insufficient stock for ${existing.name}. Available: ${existing.stock}, Requested: ${item.quantity}`,
          });
        }
      }

      decrementedProducts.push({
        productId: updatedProduct._id,
        quantity: item.quantity,
        product: updatedProduct,
      });

      // Create low stock notification if needed
      if (updatedProduct.stock <= (updatedProduct.lowStockThreshold || 10)) {
        const existingNotification = await Notification.findOne({
          shopId: shopId,
          message: {
            $regex: `Low stock alert: ${updatedProduct.name}`,
            $options: "i",
          },
          isRead: false,
        });

        if (!existingNotification) {
          await Notification.create({
            shopId: shopId,
            message: `Low stock alert: ${updatedProduct.name} has only ${updatedProduct.stock} units left`,
            isRead: false,
          });
        }
      }
    }

    // Build order items using the locked product prices and snapshot categories
    let total = 0;
    let totalProfit = 0;
    const orderItems = [];

    for (const entry of decrementedProducts) {
      const { product, quantity } = entry;
      const itemTotal = product.price * quantity;
      const itemCost = (product.cost || 0) * quantity;
      const itemProfit = itemTotal - itemCost;

      orderItems.push({
        productId: product._id,
        name: product.name,
        category: product.category || "General",
        quantity: quantity,
        price: product.price,
        cost: product.cost || 0,
      });

      total += itemTotal;
      totalProfit += itemProfit;
    }

    // Create order
    const newOrder = await Order.create({
      shopId: shopId,
      customerName: customerName ? customerName.trim() : "Walk-in Customer",
      billerName: req.user.name,
      items: orderItems,
      total: total,
      totalProfit: totalProfit,
      date: new Date(),
    });

    // ===== PDF GENERATION & STORAGE =====
    let savedInvoice = null;

    try {
      const invoiceBuffer = await generateInvoicePDF(newOrder, shop);
      const pdfBase64 = invoiceBuffer.toString("base64");

      savedInvoice = await Invoice.create({
        shopId: shopId,
        orderId: newOrder._id,
        pdfData: pdfBase64,
        customerName: newOrder.customerName,
        billerName: newOrder.billerName,
        total: newOrder.total,
        date: newOrder.date,
      });
    } catch (pdfError) {
      console.error("[INVOICE] PDF generation failed, rolling back order and stock:", pdfError);
      // Rollback created order
      await Order.findByIdAndDelete(newOrder._id);
      // Rollback stock
      for (const prev of decrementedProducts) {
        await Product.findByIdAndUpdate(prev.productId, { $inc: { stock: prev.quantity } });
      }
      throw pdfError;
    }

    // ===== RETURN COMPLETE RESPONSE =====
    res.status(201).json({
      message: "Order created successfully",
      order: newOrder,
      invoice: savedInvoice,
    });
  } catch (error) {
    console.error("[ORDER] Error:", error);
    // Ensure rollback on any unexpected error
    for (const prev of decrementedProducts) {
      try {
        await Product.findByIdAndUpdate(prev.productId, { $inc: { stock: prev.quantity } });
      } catch (rollbackErr) {
        console.error("[ORDER] Rollback error:", rollbackErr);
      }
    }

    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

export default authMiddleware(handler);
