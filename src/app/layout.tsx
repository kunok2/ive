import type { Metadata, Viewport } from "next";
import { StoreProvider } from "@/lib/store";
import { TabProvider } from "@/lib/tab-context";
import PWARegister from "@/components/PWARegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spring IVE",
  description: "Integrated Value Environment — AI가 개발을 하고, 사람은 가치를 관리한다",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "IVE",
  },
  themeColor: "#0e160e",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
      </head>
      <body>
        <PWARegister />
        <StoreProvider><TabProvider>{children}</TabProvider></StoreProvider>
      </body>
    </html>
  );
}
