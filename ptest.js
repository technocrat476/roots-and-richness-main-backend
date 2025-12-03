// phonepe_events_probe.js
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

import paymentsModule, { getAuthToken } from './routes/payments.js';

if (typeof getAuthToken !== 'function') {
  console.error('getAuthToken not exported from ./routes/payments.js. Add: export { getAuthToken }');
  process.exit(1);
}

(async () => {
  const accessToken = await getAuthToken();
  console.log('[PROBE] token (prefix):', accessToken ? accessToken.slice(0,12) : null);

  const baseUrl = process.env.PHONEPE_EVENTS_URL || 'https://api-preprod.phonepe.com/apis/pg-meta/client/v1/events/batch';
  const alternateUrl = baseUrl.replace(/\/batch\/?$/,'').replace(/\/+$/,''); // try without /batch

  const clientId = process.env.PHONEPE_CLIENT_ID || null;
  const merchantId = process.env.PHONEPE_MERCHANT_ID || null;
  const routingKey = process.env.PHONEPE_ROUTING_KEY || null;

  const bodyVariants = [
    { events: [ { eventType: "CHECKOUT_INITIATED", merchantOrderId: "mo_test_123", timestamp: Date.now(), meta: { note: "probe" } } ] },
    { clientId: clientId || undefined, events: [ { eventType: "CHECKOUT_INITIATED", merchantOrderId: "mo_test_123", timestamp: Date.now(), meta: { note: "probe" } } ] }
  ];

  const headerVariants = [
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}` }, // base
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}`, 'X-Client-Id': clientId },
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}`, 'X-Merchant-Id': merchantId },
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}`, 'X-Client-Id': clientId, 'X-Merchant-Id': merchantId },
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}`, 'routingKey': routingKey },
    { 'Content-Type': 'application/json', Authorization: `O-Bearer ${accessToken}`, 'X-Client-Id': clientId, 'routingKey': routingKey }
  ];

  const urls = [baseUrl, alternateUrl].filter(Boolean);

  for (const url of urls) {
    for (const b of bodyVariants) {
      for (const h of headerVariants) {
        // remove undefined headers
        const headers = Object.fromEntries(Object.entries(h).filter(([,v]) => v));
        const body = Object.fromEntries(Object.entries(b).filter(([,v]) => v !== undefined));
        console.log('\n[PROBE] Trying:', url);
        console.log('[PROBE] Headers:', headers);
        console.log('[PROBE] Body keys:', Object.keys(body));
        try {
          const resp = await axios.post(url, body, { headers, timeout: 15000 });
          console.log('[PROBE] SUCCESS!', { url, status: resp.status, data: resp.data });
          process.exit(0);
        } catch (err) {
          const status = err?.response?.status || 'NO_RESPONSE';
          const data = err?.response?.data || err.message;
          console.log('[PROBE] ERROR', { status, data });
          // continue trying
        }
      }
    }
  }

  console.log('\n[PROBE] All tries failed. Paste the last error above; if you want, run again with other headers.');
  process.exit(1);
})();
