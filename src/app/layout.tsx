import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaProvider } from "@/components/pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mound Hounds Pick'em",
  description: "INDYCAR fantasy league app",
  applicationName: "Mound Hounds Pick'em",
  other: { "apple-mobile-web-app-capable": "yes" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mound Hounds", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f3f7ff",
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
  width: "device-width"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body><PwaProvider>{children}</PwaProvider></body>
    </html>
  );
}
