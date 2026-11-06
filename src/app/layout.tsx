import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraMotion",
  description: "Tạo ảnh và video bằng AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
