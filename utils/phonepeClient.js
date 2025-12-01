import PhonePeSDK from "phonepe-pg-sdk-node";

// 1️⃣ Destructure Env as well
const { StandardCheckoutClient, StandardCheckoutPayRequest, StandardCheckoutStatusRequest, Env } = PhonePeSDK;

// 2️⃣ Prepare variables
const clientId = process.env.PHONEPE_CLIENT_ID;
const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
const clientVersion = process.env.PHONEPE_CLIENT_VERSION || 1;
// 3️⃣ Select the correct Environment ENUM (not string)
const environment = process.env.PHONEPE_ENV === "PRODUCTION" ? Env.PRODUCTION : Env.SANDBOX;

// 4️⃣ Initialize with POSITIONAL arguments (Order matters!)
// Constructor signature: (clientId, clientSecret, clientVersion, env)
export const phonepe = new StandardCheckoutClient(
  clientId,
  clientSecret,
  clientVersion,
  environment
);

export { StandardCheckoutPayRequest, StandardCheckoutStatusRequest };