/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@react-pdf/renderer',
    '@react-pdf/reconciler',
    '@react-pdf/font',
    '@react-pdf/pdfkit',
    '@react-pdf/layout',
    '@react-pdf/image',
    '@react-pdf/png-js',
  ],
};

module.exports = nextConfig;
