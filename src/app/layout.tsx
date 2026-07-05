import "./globals.css";

export const metadata = {
  title: "RollVault — no-gi grappling records",
  description: "The definitive database of professional no-gi grappling.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
