import dotenv from 'dotenv';
dotenv.config();

console.log("KEY_ID:", process.env.RAZORPAY_KEY_ID);
console.log("KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET);


console.log("PUBLIC:", process.env.SHIPPING_PUBLIC_KEY);
console.log("PRIVATE:", process.env.SHIPPING_PRIVATE_KEY);