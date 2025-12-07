// backend/routes/sitemap.js
import express from 'express';
import dbConnect from '../config/database.js';
import Product from '../models/Product.js';
import Blog from '../models/Blog.js';

const router = express.Router();

const BASE_URL = process.env.BASE_URL || 'https://rootsandrichness.in';

/**
 * Helper: format date to YYYY-MM-DD
 */
function formatDateISO(dateLike) {
  if (!dateLike) return new Date().toISOString().split('T')[0];
  const d = new Date(dateLike);
  return isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
}

/**
 * GET /sitemap.xml
 * Returns an XML sitemap built from DB data
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    // Connect to DB (idempotent if already connected)
    await dbConnect();

    // Fetch data
    const [products, blogs] = await Promise.all([
      Product.find({}, 'slug images updatedAt featured').lean(),
      Blog.find({}, 'slug updatedAt featuredImage title').lean()
    ]);

    const currentDate = new Date().toISOString().split('T')[0];

    const urls = [
      { loc: `${BASE_URL}/`, lastmod: currentDate, changefreq: 'weekly', priority: 1.0 },
      { loc: `${BASE_URL}/products`, lastmod: currentDate, changefreq: 'daily', priority: 0.9 },
      { loc: `${BASE_URL}/about`, lastmod: currentDate, changefreq: 'monthly', priority: 0.8 },
      { loc: `${BASE_URL}/contact`, lastmod: currentDate, changefreq: 'monthly', priority: 0.7 },
      { loc: `${BASE_URL}/faq`, lastmod: currentDate, changefreq: 'monthly', priority: 0.6 },
      { loc: `${BASE_URL}/blog`, lastmod: currentDate, changefreq: 'weekly', priority: 0.8 },
      // policies
      { loc: `${BASE_URL}/policies/privacy-policy`, lastmod: currentDate, changefreq: 'yearly', priority: 0.3 },
      { loc: `${BASE_URL}/policies/terms-and-conditions`, lastmod: currentDate, changefreq: 'yearly', priority: 0.3 },
      { loc: `${BASE_URL}/policies/return-refund-policy`, lastmod: currentDate, changefreq: 'monthly', priority: 0.4 },
      { loc: `${BASE_URL}/policies/shipping-policy`, lastmod: currentDate, changefreq: 'monthly', priority: 0.4 },
    ];

    // Add products
    products.forEach(p => {
      const slug = p.slug || '';
      const loc = `${BASE_URL}/products/${slug}`;
      const lastmod = formatDateISO(p.updatedAt || currentDate);
      const images = Array.isArray(p.images) ? p.images : [];

      urls.push({
        loc,
        lastmod,
        changefreq: 'weekly',
        priority: p.featured ? 0.8 : 0.7,
        images: images
          .filter(Boolean)
          .map(img => ({
            // support both absolute URLs or site-relative paths
            loc: (typeof img === 'string' && img.startsWith('http')) ? img : `${BASE_URL}${(typeof img === 'string' ? img : '')}`,
            title: p.name || '',
            caption: p.shortDescription || p.name || ''
          }))
      });
    });

    // Add blogs (using featuredImage object {url, alt})
    blogs.forEach(b => {
      const slug = b.slug || '';
      const loc = `${BASE_URL}/blog/${slug}`;
      const lastmod = formatDateISO(b.updatedAt || currentDate);
      const images = [];
      if (b.featuredImage && b.featuredImage.url) {
        images.push({
          loc: b.featuredImage.url.startsWith('http') ? b.featuredImage.url : `${BASE_URL}${b.featuredImage.url}`,
          title: (b.title || '').trim(),
          caption: (b.featuredImage.alt || b.title || '').trim()
        });
      }

      urls.push({
        loc,
        lastmod,
        changefreq: 'monthly',
        priority: 0.6,
        images
      });
    });

    // Build XML
    const xmlParts = [];
    xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlParts.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    xmlParts.push('        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">');

    urls.forEach(u => {
      xmlParts.push('  <url>');
      xmlParts.push(`    <loc>${u.loc}</loc>`);
      if (u.lastmod) xmlParts.push(`    <lastmod>${u.lastmod}</lastmod>`);
      if (u.changefreq) xmlParts.push(`    <changefreq>${u.changefreq}</changefreq>`);
      if (typeof u.priority !== 'undefined') xmlParts.push(`    <priority>${u.priority}</priority>`);

      if (u.images && u.images.length) {
        u.images.forEach(img => {
          if (!img.loc) return;
          xmlParts.push('    <image:image>');
          xmlParts.push(`      <image:loc>${img.loc}</image:loc>`);
          if (img.title) xmlParts.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
          if (img.caption) xmlParts.push(`      <image:caption>${escapeXml(img.caption)}</image:caption>`);
          xmlParts.push('    </image:image>');
        });
      }

      xmlParts.push('  </url>');
    });

    xmlParts.push('</urlset>');
    const sitemapXml = xmlParts.join('\n');

    // Set appropriate headers and return
    res.setHeader('Content-Type', 'application/xml');
    // Light caching for performance, but allow updates fairly quickly
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=300');
    return res.send(sitemapXml);
  } catch (err) {
    console.error('Sitemap generation error:', err);
    return res.status(500).send('Error generating sitemap');
  }
});

/**
 * Basic XML escape for title/captions to avoid breaking the XML
 */
function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
