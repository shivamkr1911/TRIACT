import connectDB from "../../../../../lib/db.js";
import Invoice from "../../../../../models/Invoice.js";
import { authMiddleware } from "../../../../../lib/auth.js";

async function handler(req, res) {
  // --- Handle OPTIONS explicitly if needed (though handleCors should cover it) ---
  if (req.method === "OPTIONS") {
    console.log(`Invoice Route: Responding OK to OPTIONS preflight.`);
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { shopId, invoiceId } = req.query;

  // Authentication check (req.user is added by authMiddleware)
  if (!req.user || req.user.shopId !== shopId) {
    return res
      .status(403)
      .json({ message: "Access denied to this shop's resources." });
  }

  await connectDB();

  try {
    const invoice = await Invoice.findOne({ _id: invoiceId, shopId });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    if (!invoice.pdfData) {
      return res.status(404).json({ message: "Invoice PDF data not found." });
    }

    // --- Convert base64 back to buffer ---
    const pdfBuffer = Buffer.from(invoice.pdfData, "base64");

    // --- Set cache control headers ---
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // --- Set PDF response headers ---
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${invoiceId}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.length);

    // --- Send PDF buffer ---
    res.status(200).end(pdfBuffer);
  } catch (error) {
    console.error("Get Invoice [invoiceId] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal Server Error" });
    } else {
      res.end();
    }
  }
}

export default authMiddleware(handler);
