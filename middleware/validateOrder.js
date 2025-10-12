// middlewares/validateOrder.js
export const validateOrder = (req, res, next) => {
  const { items, totalPrice, userDetails } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Order items are required" });
  }

  if (!totalPrice || typeof totalPrice !== 'number') {
    return res.status(400).json({ success: false, message: "Total price is required and must be a number" });
  }

  if (!userDetails || typeof userDetails !== 'object') {
    return res.status(400).json({ success: false, message: "User details are required" });
  }

  const { name, email, address, phone } = userDetails;
  if (!name || !email || !address || !phone) {
    return res.status(400).json({ success: false, message: "Incomplete user details" });
  }

  next();
};
