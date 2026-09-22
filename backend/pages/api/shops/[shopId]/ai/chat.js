import connectDB from "../../../../../lib/db.js";
import Product from "../../../../../models/Product.js";
import Order from "../../../../../models/Order.js";
import User from "../../../../../models/User.js";
import { authMiddleware } from "../../../../../lib/auth.js";
import { getGeminiModel } from "../../../../../lib/gemini.js";
import mongoose from "mongoose";

const formatINR = (val) => {
  const num = Number(val) || 0;
  return (
    "₹" +
    num.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
};

const formatNum = (val) => (Number(val) || 0).toLocaleString("en-IN");

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  await connectDB();
  const { shopId } = req.query;

  if (req.user?.shopId?.toString() !== shopId) {
    return res.status(403).json({ message: "Access denied." });
  }

  const { message, query, history } = req.body;
  const userMessage = message || query;

  if (!userMessage || typeof userMessage !== "string" || !userMessage.trim()) {
    return res.status(400).json({ message: "Message is required" });
  }

  try {
    // 1. Fetch live data and lifetime aggregation concurrently
    const [products, orders, employees, aggResult] = await Promise.all([
      Product.find({ shopId }).lean(),
      Order.find({ shopId }).sort({ date: -1 }).limit(200).lean(),
      User.find({ shopId, role: "employee" }).lean(),
      Order.aggregate([
        { $match: { shopId: new mongoose.Types.ObjectId(shopId) } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$total" },
            totalProfit: { $sum: "$totalProfit" },
            count: { $sum: 1 },
          },
        },
      ]).catch(() => []),
    ]);

    const stats = aggResult?.[0];
    const lifetimeRevenue = stats?.totalRevenue ?? orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const lifetimeProfit = stats?.totalProfit ?? orders.reduce((sum, o) => sum + (o.totalProfit || 0), 0);
    const lifetimeOrdersCount = stats?.count ?? orders.length;

    // 2. Date-based Analytics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    lastMonthEnd.setHours(23, 59, 59, 999);

    const todayOrders = orders.filter((o) => new Date(o.date) >= today);
    const thisMonthOrders = orders.filter((o) => new Date(o.date) >= thisMonthStart);
    const lastMonthOrders = orders.filter((o) => {
      const orderDate = new Date(o.date);
      return orderDate >= lastMonthStart && orderDate <= lastMonthEnd;
    });

    const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const todayProfit = todayOrders.reduce((sum, o) => sum + (o.totalProfit || 0), 0);
    const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const thisMonthProfit = thisMonthOrders.reduce((sum, o) => sum + (o.totalProfit || 0), 0);
    const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const lastMonthProfit = lastMonthOrders.reduce((sum, o) => sum + (o.totalProfit || 0), 0);

    const revenueChange =
      lastMonthRevenue > 0
        ? (((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)
        : "0.0";
    const profitChange =
      lastMonthProfit > 0
        ? (((thisMonthProfit - lastMonthProfit) / lastMonthProfit) * 100).toFixed(1)
        : "0.0";

    const totalMonthlySalary = employees.reduce(
      (sum, emp) => sum + (emp.salary?.amount || 0),
      0,
    );
    const laborCostPercentage =
      thisMonthRevenue > 0
        ? ((totalMonthlySalary / thisMonthRevenue) * 100).toFixed(1)
        : "0.0";

    // 3. Employee Performance
    const employeeStats = {};
    orders.forEach((order) => {
      const biller = order.billerName || "Unknown";
      if (!employeeStats[biller]) {
        employeeStats[biller] = {
          name: biller,
          orderCount: 0,
          totalRevenue: 0,
          totalProfit: 0,
        };
      }
      employeeStats[biller].orderCount++;
      employeeStats[biller].totalRevenue += order.total || 0;
      employeeStats[biller].totalProfit += order.totalProfit || 0;
    });

    const employeePerformance = Object.values(employeeStats)
      .map((emp) => ({
        ...emp,
        avgRevenuePerOrder:
          emp.orderCount > 0 ? (emp.totalRevenue / emp.orderCount).toFixed(2) : "0.00",
        avgProfitPerOrder:
          emp.orderCount > 0 ? (emp.totalProfit / emp.orderCount).toFixed(2) : "0.00",
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    // 4. Detailed Stock & Inventory Breakdown (Accurate Stock Ranking)
    const sortedByStockAsc = [...products].sort((a, b) => (a.stock || 0) - (b.stock || 0));
    const lowestStockProducts = sortedByStockAsc.slice(0, 10);
    const highestStockProducts = [...sortedByStockAsc].reverse().slice(0, 5);
    const outOfStockProducts = products.filter((p) => (p.stock || 0) <= 0);
    const lowStockProducts = products.filter(
      (p) => (p.stock || 0) <= (p.lowStockThreshold || 10),
    );
    const totalInventoryUnits = products.reduce((sum, p) => sum + (p.stock || 0), 0);

    // Full compact product stock list for accurate arbitrary stock queries
    const allProductsStockSummary = sortedByStockAsc
      .map((p) => `${p.name} (${p.stock} units, ₹${p.price})`)
      .join(", ");

    // 5. Product Sales Velocity & Margins
    const productStats = new Map();
    products.forEach((product) => {
      productStats.set(product.name, {
        name: product.name,
        unitsSold: 0,
        revenue: 0,
        profit: 0,
        stock: product.stock || 0,
        price: product.price || 0,
        cost: product.cost || 0,
      });
    });

    orders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const existing = productStats.get(item.name);
        if (existing) {
          const qty = item.quantity || 0;
          existing.unitsSold += qty;
          existing.revenue += (item.price || 0) * qty;
          existing.profit += ((item.price || 0) - (item.cost || 0)) * qty;
        }
      });
    });

    // Determine timespan of orders in days (for sales velocity)
    const orderTimestamps = orders
      .map((o) => new Date(o.date).getTime())
      .filter((t) => !isNaN(t));
    let orderDaysSpan = 30;
    if (orderTimestamps.length > 1) {
      const minDate = Math.min(...orderTimestamps);
      const maxDate = Math.max(...orderTimestamps);
      const diffDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
      orderDaysSpan = Math.max(diffDays, 1);
    }

    // 6. Actionable Restock Intelligence (Urgency, Velocity, Runway, Reorder Advice)
    const restockIntelligence = products
      .filter((p) => (p.stock || 0) <= (p.lowStockThreshold || 10))
      .map((p) => {
        const stat = productStats.get(p.name) || { unitsSold: 0 };
        const stock = p.stock || 0;
        const threshold = p.lowStockThreshold || 10;
        const unitsSold = stat.unitsSold;
        const dailyVelocity = unitsSold / orderDaysSpan;

        let runway = "No recent sales";
        let urgency = "⚠️ Low Stock";

        if (stock <= 0) {
          urgency = "🚨 OUT OF STOCK";
          runway = "0 days (Out of stock)";
        } else if (dailyVelocity >= 0.5) {
          // Fast-moving item (sells regularly, >= 0.5 unit/day)
          const days = Math.max(1, Math.round(stock / dailyVelocity));
          runway = days <= 1 ? "< 1 day of stock remaining" : `~${days} days of stock remaining`;
          if (days <= 5) {
            urgency = "🚨 Critical (High Demand, Running Out Fast)";
          } else {
            urgency = "⚠️ Low Stock Alert";
          }
        } else if (unitsSold > 0) {
          // Slow-moving item: do not quote misleading hundreds of days of runway
          runway = "Slow-moving inventory (low recent sales velocity)";
          urgency = "ℹ️ Below Threshold (Low Movement)";
        } else {
          runway = "No recorded sales yet";
          urgency = "ℹ️ Below Threshold (No Sales)";
        }

        // Recommend realistic reorder quantity based on demand:
        let recommendedOrder = 10;
        if (stock <= 0) {
          recommendedOrder = Math.max(20, Math.ceil(dailyVelocity * 30));
        } else if (dailyVelocity >= 0.5) {
          recommendedOrder = Math.max(threshold * 2, Math.ceil(dailyVelocity * 30));
        } else {
          // For slow moving items, suggest just enough to cross threshold safely without over-purchasing
          recommendedOrder = Math.max(5, (threshold - stock) + 5);
        }

        return {
          name: p.name,
          stock,
          threshold,
          unitsSold,
          dailyVelocity: dailyVelocity.toFixed(1),
          runway,
          recommendedOrder,
          urgency,
          category: p.category || "General",
        };
      })
      .sort((a, b) => {
        if (a.stock <= 0 && b.stock > 0) return -1;
        if (b.stock <= 0 && a.stock > 0) return 1;
        return b.unitsSold - a.unitsSold;
      });

    // 7. Frequently Bought Together (Product Pairs)
    const productPairs = new Map();
    orders.forEach((order) => {
      const itemNames = (order.items || []).map((item) => item.name).filter(Boolean);
      for (let i = 0; i < itemNames.length; i++) {
        for (let j = i + 1; j < itemNames.length; j++) {
          const pair = [itemNames[i], itemNames[j]].sort().join(" + ");
          productPairs.set(pair, (productPairs.get(pair) || 0) + 1);
        }
      }
    });

    const topBundles = Array.from(productPairs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, count]) => `${pair} (${count} times)`);

    const allProductStats = Array.from(productStats.values());
    const topSellingProducts = [...allProductStats]
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 10);
    const leastSellingProducts = [...allProductStats]
      .sort((a, b) => a.unitsSold - b.unitsSold)
      .slice(0, 10);
    const topProfitProducts = [...allProductStats]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    const enrichedTopProfitProducts = topProfitProducts.map((p) => {
      const marginPercent = p.price > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : "0.0";
      const stockHealth =
        p.stock <= 0
          ? "🚨 OUT OF STOCK"
          : p.stock <= 10
          ? `⚠️ Low Stock (${p.stock} left)`
          : `🟢 ${p.stock} units in stock (Healthy)`;
      return {
        ...p,
        marginPercent,
        stockHealth,
      };
    });

    const enrichedTopSellers = topSellingProducts.map((p) => {
      const stockHealth =
        p.stock <= 0
          ? "🚨 OUT OF STOCK"
          : p.stock <= 10
          ? `⚠️ Low Stock (${p.stock} left)`
          : `🟢 ${p.stock} units in stock`;
      return `${p.name} (${p.unitsSold} sold | Stock: ${stockHealth})`;
    });

    const productMargins = products
      .map((p) => {
        const price = p.price || 0;
        const cost = p.cost || 0;
        const margin = price - cost;
        const marginPercent = price > 0 ? ((margin / price) * 100).toFixed(1) : "0.0";
        return {
          name: p.name,
          price,
          cost,
          margin,
          marginPercent,
          stock: p.stock || 0,
        };
      })
      .sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent));

    const neverSoldProducts = allProductStats
      .filter((p) => p.unitsSold === 0)
      .map((p) => `${p.name} (Stock: ${p.stock})`);

    // 8. Category Stats
    const categoryStatsThisMonth = {};
    const categoryStatsLastMonth = {};

    thisMonthOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const product = products.find((p) => p.name === item.name);
        const category = item.category || product?.category || "General";
        if (!categoryStatsThisMonth[category])
          categoryStatsThisMonth[category] = { revenue: 0, profit: 0 };
        categoryStatsThisMonth[category].revenue += (item.price || 0) * (item.quantity || 0);
        categoryStatsThisMonth[category].profit +=
          ((item.price || 0) - (item.cost || 0)) * (item.quantity || 0);
      });
    });

    lastMonthOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const product = products.find((p) => p.name === item.name);
        const category = item.category || product?.category || "General";
        if (!categoryStatsLastMonth[category])
          categoryStatsLastMonth[category] = { revenue: 0, profit: 0 };
        categoryStatsLastMonth[category].revenue += (item.price || 0) * (item.quantity || 0);
        categoryStatsLastMonth[category].profit +=
          ((item.price || 0) - (item.cost || 0)) * (item.quantity || 0);
      });
    });

    const categoryComparison = Object.keys({
      ...categoryStatsThisMonth,
      ...categoryStatsLastMonth,
    }).map((category) => {
      const thisMonth = categoryStatsThisMonth[category] || { revenue: 0, profit: 0 };
      const lastMonth = categoryStatsLastMonth[category] || { revenue: 0, profit: 0 };
      const revenueGrowth =
        lastMonth.revenue > 0
          ? (((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100).toFixed(1)
          : "N/A";
      return `${category}: This Month ${formatINR(thisMonth.revenue)}, Last Month ${formatINR(lastMonth.revenue)}, Growth: ${revenueGrowth}%`;
    });

    // 9. Construct Comprehensive Store Context
    const storeContext = `You are TRIACT AI, an expert, professional business intelligence assistant for a retail store owner.
Answer the user's questions clearly, accurately, and concisely based strictly on the live store data provided below.

========================================
CRITICAL FORMATTING & PRESENTATION RULES:
========================================
1. STRICTLY AVOID wide ASCII or Markdown tables (| col | col |). Chat containers are narrow; tables collapse or become unreadable.
2. ALWAYS format responses using standard Markdown bullet lists (- Item) with every item on its own new line. NEVER put multiple bullet items on the same line.
3. Use clear status emojis:
   - 🚨 for Out of Stock or Urgent restock
   - ⚠️ for Low Stock alerts
   - ℹ️ for Slow-moving items below threshold
   - 🟢 for Healthy stock
   - 🏆 for Top Performers (Best Sellers, Top Profit, Top Employee)
4. When presenting multi-metric statistics (such as Employee Performance, Store Sales, or Payroll), ALWAYS format each metric with a separate bullet point on a new line:
   - **Metric Name:** Value
5. When asked about restock or low stock:
   - If an item has low movement, DO NOT quote exaggerated hundreds of days of runway or call it a critical emergency. State that it is a slow-moving item below threshold, and suggest a modest order to maintain a safe shelf buffer.
   - Only call items 🚨 Critical if they are out of stock or selling rapidly with < 7 days of stock left.
6. When asked about top profit products, provide: Total Profit (₹), Profit Margin (%), Selling Price & Cost, Total Units Sold, and Current Stock Health.
7. Format all currency in Indian Rupees (₹) with proper comma separators (e.g., ₹28,520, ₹1,240.00).
8. Keep answers concise, direct, and focused (under 250 words) so responses stream quickly without getting truncated.

=== LIVE STORE DATA ===

CURRENT INVENTORY & STOCK LEVELS:
- Total Product Types: ${products.length}
- Total Stock Units: ${formatNum(totalInventoryUnits)}
- Out of Stock Items (${outOfStockProducts.length}): ${outOfStockProducts.length > 0 ? outOfStockProducts.map((p) => p.name).join(", ") : "None (All products in stock)"}
- Low Stock Items (${lowStockProducts.length}): ${lowStockProducts.length > 0 ? lowStockProducts.map((p) => `${p.name} (${p.stock} left, Threshold: ${p.lowStockThreshold || 10})`).join(", ") : "None"}

COMPLETE STORE INVENTORY (Sorted ascending by stock):
${allProductsStockSummary || "No products found"}

RESTOCK INTELLIGENCE & RUNWAY (Based on Sales Velocity):
${
  restockIntelligence.length > 0
    ? restockIntelligence
        .map(
          (item, i) =>
            `${i + 1}. ${item.urgency} **${item.name}**:\n` +
            `   • Current Stock: ${item.stock} units (Threshold: ${item.threshold})\n` +
            `   • Sales Velocity: ${item.unitsSold} units sold (~${item.dailyVelocity}/day)\n` +
            `   • Stock Runway: ${item.runway}\n` +
            `   • Recommended Restock: ${item.recommendedOrder} units`
        )
        .join("\n")
    : "All products have sufficient stock levels. No urgent restock required."
}

LOWEST STOCK PRODUCTS (Top 10):
${lowestStockProducts.length > 0 ? lowestStockProducts.map((p, i) => `${i + 1}. **${p.name}**: ${p.stock} units (Price: ${formatINR(p.price)}, Category: ${p.category || "General"}, Threshold: ${p.lowStockThreshold || 10})`).join("\n") : "No products found"}

HIGHEST STOCK PRODUCTS (Top 5):
${highestStockProducts.length > 0 ? highestStockProducts.map((p, i) => `${i + 1}. **${p.name}**: ${p.stock} units`).join("\n") : "No products found"}

TODAY'S SALES:
• Revenue: ${formatINR(todayRevenue)}
• Profit: ${formatINR(todayProfit)}
• Orders Count: ${todayOrders.length}

THIS MONTH vs LAST MONTH:
• This Month: ${formatINR(thisMonthRevenue)} Revenue | ${formatINR(thisMonthProfit)} Profit | ${thisMonthOrders.length} Orders
• Last Month: ${formatINR(lastMonthRevenue)} Revenue | ${formatINR(lastMonthProfit)} Profit | ${lastMonthOrders.length} Orders
• MoM Growth: Revenue ${revenueChange}% | Profit ${profitChange}%

LIFETIME OVERVIEW:
• Total Orders: ${formatNum(lifetimeOrdersCount)}
• All-Time Revenue: ${formatINR(lifetimeRevenue)}
• All-Time Profit: ${formatINR(lifetimeProfit)}

CATEGORY PERFORMANCE (Month-over-Month):
${categoryComparison.length > 0 ? categoryComparison.join("\n") : "No category data available"}

EMPLOYEE PERFORMANCE OVERVIEW:
- Total Employees: ${employees.length}
- Monthly Payroll: ${formatINR(totalMonthlySalary)} (${laborCostPercentage}% of revenue)
- Employee Rankings:
${
  employeePerformance.length > 0
    ? employeePerformance
        .map(
          (emp, i) =>
            `${i + 1}. 🏆 **${emp.name}**:\n` +
            `   • Orders Handled: ${emp.orderCount} orders\n` +
            `   • Total Revenue: ${formatINR(emp.totalRevenue)}\n` +
            `   • Total Profit: ${formatINR(emp.totalProfit)}\n` +
            `   • Avg Revenue/Order: ${formatINR(emp.avgRevenuePerOrder)}\n` +
            `   • Avg Profit/Order: ${formatINR(emp.avgProfitPerOrder)}`
        )
        .join("\n")
    : "No employee sales recorded yet"
}

BEST & WORST SELLING PRODUCTS:
- Top 10 Best Sellers: ${enrichedTopSellers.join(", ") || "None"}
- Top 10 Least Sellers: ${leastSellingProducts.map((p) => `${p.name} (${p.unitsSold} sold, ${p.stock} in stock)`).join(", ") || "None"}
- Never Sold (${neverSoldProducts.length} items): ${neverSoldProducts.slice(0, 10).join(", ") || "None"}

TOP PROFIT PRODUCTS:
${
  enrichedTopProfitProducts.length > 0
    ? enrichedTopProfitProducts
        .map(
          (p, i) =>
            `${i + 1}. 🏆 **${p.name}**:\n` +
            `   • Total Profit: ${formatINR(p.profit)} (${p.marginPercent}% margin)\n` +
            `   • Pricing: Selling ${formatINR(p.price)} | Cost ${formatINR(p.cost)}\n` +
            `   • Units Sold: ${p.unitsSold} units\n` +
            `   • Stock Status: ${p.stockHealth}`
        )
        .join("\n")
    : "None"
}

PROFIT MARGINS (Top 5):
${productMargins.slice(0, 5).map((p, i) => `${i + 1}. **${p.name}**: ${p.marginPercent}% margin (Selling: ${formatINR(p.price)}, Cost: ${formatINR(p.cost)})`).join("\n") || "None"}

POPULAR BUNDLES (Frequently Bought Together):
${topBundles.length > 0 ? topBundles.join("\n") : "No frequent purchase combinations yet"}

=== END OF LIVE DATA ===`;

    // 10. Build Conversation History (Multi-Turn Chat)
    const messagesPayload = [{ role: "system", content: storeContext }];

    if (Array.isArray(history) && history.length > 0) {
      // Keep last 6 dialogue turns for context memory
      const recentTurns = history.slice(-6);
      for (const turn of recentTurns) {
        const role = turn.sender === "ai" || turn.role === "assistant" ? "assistant" : "user";
        const content = turn.text || turn.content;
        if (content && typeof content === "string" && content.trim()) {
          messagesPayload.push({ role, content: content.trim() });
        }
      }
    }

    messagesPayload.push({ role: "user", content: userMessage.trim() });

    // 11. Call OpenRouter with Primary & Fallback Models (Stream or Non-Stream)
    const client = getGeminiModel();
    const isStreamRequested = req.body.stream !== false;

    const candidateModels = [
      "openrouter/free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "qwen/qwen3.8-27b:free",
      "z-ai/glm-5.2:free",
    ];

    const isInvalidOrSafetyOutput = (text) => {
      if (!text || typeof text !== "string") return true;
      const trimmed = text.trim();
      if (/user safety:\s*safe/i.test(trimmed) || /response safety:\s*safe/i.test(trimmed)) {
        return true;
      }
      return false;
    };

    if (isStreamRequested) {
      let streamStarted = false;

      for (const model of candidateModels) {
        try {
          const stream = await client.chat.completions.create({
            model,
            messages: messagesPayload,
            max_tokens: 1000,
            stream: true,
          });

          let initialBuffer = "";
          let headersSent = false;

          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta?.content || "";
            if (!delta) continue;

            if (!headersSent) {
              initialBuffer += delta;
              // Buffer the first 20 characters to filter out safety classifier outputs
              if (initialBuffer.length >= 20 || initialBuffer.includes("\n")) {
                const origin = req.headers.origin || process.env.FRONTEND_URL || "*";
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("Connection", "keep-alive");
                res.setHeader("X-Accel-Buffering", "no");

                headersSent = true;
                streamStarted = true;
                res.write(initialBuffer);
              }
            } else {
              res.write(delta);
            }
          }

          if (headersSent) {
            res.end();
            return;
          } else if (initialBuffer && !isInvalidOrSafetyOutput(initialBuffer)) {
            const origin = req.headers.origin || process.env.FRONTEND_URL || "*";
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");

            res.write(initialBuffer);
            res.end();
            return;
          }
        } catch (modelErr) {
          console.warn(`[AI Chat] Streaming model ${model} failed, trying fallback:`, modelErr.message);
        }
      }

      if (!streamStarted && !res.headersSent) {
        throw new Error("All AI streaming endpoints failed or were unavailable.");
      }
      return;
    }

    // Fallback: Non-streaming mode
    let aiResponse = null;
    for (const model of candidateModels) {
      try {
        const completion = await client.chat.completions.create({
          model,
          messages: messagesPayload,
          max_tokens: 1000,
        });

        const replyContent = completion.choices?.[0]?.message?.content;
        if (replyContent && !isInvalidOrSafetyOutput(replyContent)) {
          aiResponse = replyContent.trim();
          break;
        } else if (replyContent) {
          console.warn(`[AI Chat] Model ${model} returned safety output: "${replyContent}". Trying next model.`);
        }
      } catch (modelErr) {
        console.warn(`[AI Chat] Model ${model} failed, trying fallback:`, modelErr.message);
      }
    }

    if (!aiResponse) {
      throw new Error("All AI endpoints failed or returned empty content.");
    }

    // Return rich markdown response directly
    res.status(200).json({ reply: aiResponse, answer: aiResponse });
  } catch (error) {
    // Log full error details securely on the server for debugging
    console.error("[AI Chat Error]:", error);

    // Return clean, human-friendly message for UI
    let userMessage = "I'm having trouble analyzing the store data right now. Please try again in a moment.";
    if (error?.status === 429 || error?.message?.includes("429")) {
      userMessage = "The AI assistant is receiving high traffic right now. Please wait a moment and retry.";
    }

    res.status(500).json({
      reply: userMessage,
      message: userMessage,
    });
  }
}

export const config = {
  maxDuration: 45,
};

export default authMiddleware(handler);
