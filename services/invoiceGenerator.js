// services/invoiceGenerator.js
import ejs from "ejs";
import path from "path";
import fs from "fs-extra";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "url";

// Fix __dirname since it's not available in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INVOICE_VIEW = path.join(__dirname, "../views/invoice.ejs");
const TEMP_DIR = path.join(__dirname, "../tmp_invoices");

fs.ensureDirSync(TEMP_DIR);

export async function generateInvoicePDF(templateData) {
  const html = await ejs.renderFile(INVOICE_VIEW, templateData);

  // Launch puppeteer
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();

  // Set content and wait
  await page.setContent(html, { waitUntil: "networkidle0" });

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20mm", bottom: "20mm", left: "10mm", right: "10mm" },
  });

  const debugPath = path.join(TEMP_DIR, `debug_invoice_${Date.now()}.pdf`);
await fs.writeFile(debugPath, pdfBuffer);
console.log("Debug PDF saved at:", debugPath);

  await browser.close();
  return pdfBuffer;
}

// Optionally save locally and return path
export async function savePdfToLocal(buffer, orderId) {
  const filename = `invoice_${orderId}_${Date.now()}.pdf`;
  const fullpath = path.join(TEMP_DIR, filename);
  await fs.writeFile(fullpath, buffer);
  return fullpath;
}
