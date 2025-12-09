// utils/html-normalize.js
import he from 'he';
import sanitizeHtml from 'sanitize-html';

/**
 * Normalize incoming html:
 *  - If content contains encoded entities (&lt; &gt; &amp;), decode once
 *  - Sanitize allowed tags/attributes and return the cleaned HTML
 */
export function normalizeIncomingHtml(rawHtml) {
  if (!rawHtml) return '';

  // If it contains common encoded entities, decode once
  const containsEntities = /&lt;|&gt;|&amp;/.test(rawHtml);
  const decoded = containsEntities ? he.decode(rawHtml) : rawHtml;

  // Sanitize, but keep headings, lists, images etc.
  const sanitized = sanitizeHtml(decoded, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1','h2','h3','h4','img']),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
    },
    allowedSchemes: ['http','https','mailto','tel','data'],
  });

  return sanitized;
}
