import type { Metadata } from 'next';

import './globals.css';

const TITLE = 'Catchment — flood exposure and service access in Harris County';
const DESCRIPTION =
  'Ask in plain English which Harris County neighbourhoods sit in the floodplain and lack nearby services. A language model writes the analysis plan; a fixed executor runs it over census and FEMA data.';

/**
 * Absolute base for the social-card URL.
 *
 * Without it Next resolves the generated image against http://localhost:3000,
 * and the card renders as a broken image everywhere the link is actually
 * pasted. Vercel sets the production domain at build time; the fallback is the
 * deployment this repo points at.
 */
const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://catchment-two.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  // The card that shows when the link is shared. The image itself is generated
  // at build time by app/opengraph-image.tsx.
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
