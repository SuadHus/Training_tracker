// The session screen is a tool held in one hand. It has its own top bar and
// drops the site masthead and footer.
export default function SessionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main id="main" tabIndex={-1}>{children}</main>;
}
