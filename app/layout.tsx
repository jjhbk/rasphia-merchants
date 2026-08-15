import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rasphia — Find the right move for your business",
  description: "Rasphia diagnoses where local service businesses are losing momentum, then helps run the moves that matter most.",
  icons: {
    icon: [{ url: "/favicon.ico", type: "image/x-icon" }, { url: "/icon128.png", type: "image/png", sizes: "128x128" }],
    shortcut: "/favicon.ico",
    apple: "/icon128.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
