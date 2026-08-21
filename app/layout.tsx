import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.rasphia.com"),
  title: "Rasphia — Find the right move for your business",
  description: "Rasphia diagnoses where local service businesses are losing momentum, then helps run the moves that matter most.",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/rasphia_logo.png", type: "image/png", sizes: "1024x1024" }, { url: "/favicon.ico", type: "image/x-icon" }],
    shortcut: "/rasphia_logo.png",
    apple: "/rasphia_logo.png",
  },
  openGraph: { title: "Rasphia — Find the next move that pays back", description: "AI agents for local-business growth, retention, and revenue.", images: [{ url: "/rasphia_logo.png", width: 1024, height: 1024, alt: "Rasphia" }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Rasphia",
    url: "https://www.rasphia.com",
    logo: "https://www.rasphia.com/rasphia_logo.png",
    description: "Rasphia diagnoses growth, retention, and revenue opportunities for local service businesses, then helps execute the highest-priority moves with AI agents.",
    sameAs: [],
  };

  return <html lang="en"><body>
    {children}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
  </body></html>;
}
