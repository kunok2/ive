import type { Metadata, Viewport } from "next";
import { StoreProvider } from "@/lib/store";
import { TabProvider } from "@/lib/tab-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spring IVE",
  description: "Integrated Value Environment — AI가 개발을 하고, 사람은 가치를 관리한다",
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
      </head>
      <body>
        <StoreProvider><TabProvider>{children}</TabProvider></StoreProvider>
      </body>
    </html>
  );
}
