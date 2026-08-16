import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://rasphia.com"),
  title: "Rasphia — Find the right move for your business",
  description: "Rasphia diagnoses where local service businesses are losing momentum, then helps run the moves that matter most.",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/favicon.ico", type: "image/x-icon" }, { url: "/icon128.png", type: "image/png", sizes: "128x128" }],
    shortcut: "/favicon.ico",
    apple: "/icon128.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Rasphia",
    url: "https://rasphia.com",
    description: "Rasphia diagnoses growth, retention, and revenue opportunities for local service businesses, then helps execute the highest-priority moves with AI agents.",
    sameAs: [],
  };

  return <html lang="en"><body>
    {children}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
  </body></html>;
}
