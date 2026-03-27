import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { StoreProvider } from "@/lib/store";
import { TabProvider } from "@/lib/tab-context";
import { DialogProvider } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/ui/Toast";
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0e160e",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
      </head>
      <body>
        <PWARegister />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <StoreProvider><TabProvider><DialogProvider><ToastProvider>{children}</ToastProvider></DialogProvider></TabProvider></StoreProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
