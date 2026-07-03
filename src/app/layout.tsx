export const metadata = {
  title: 'Grappledex',
  description: 'No-gi elite grappling records',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
