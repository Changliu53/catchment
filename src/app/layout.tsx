import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Catchment — flood exposure and service access in Harris County',
  description:
    'Ask in plain English which Harris County neighbourhoods sit in the floodplain and lack nearby services. A language model writes the analysis plan; a fixed executor runs it over census and FEMA data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
