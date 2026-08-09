import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROAS — cross-platform ad efficiency for Indian D2C",
  description:
    "Track true ROAS, CAC, promotions and brand-fund spend across Amazon, Flipkart, Myntra, Nykaa, BigBasket, Blinkit and Zepto — and reallocate budget to where the next rupee actually pays back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
