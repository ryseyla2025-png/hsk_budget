import type { NextConfig } from 'next';

/** Security headers for every page and API response. */
const securityHeaders = [
  // no other site may show this app inside a frame (clickjacking)
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  // browsers must not guess file types
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // don't leak full URLs to other sites
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // the app needs no camera, mic, location, etc.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // HTTPS only (ignored by browsers on http://localhost)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
