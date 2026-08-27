import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prototype — AI Website Generator",
  description: "Describe or upload a design. Get a live, animated prototype.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-body">{children}</body>
    </html>
  );
}
