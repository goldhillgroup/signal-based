import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Signal Radar | Goldhill Group",
  description:
    "Signal-based prospecting dashboard for The Goldhill Group, surfaces family businesses showing leadership transition, succession, and growth signals.",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} h-full antialiased`}
      // The script below writes data-theme before React hydrates, so the
      // server-rendered html tag and the client's disagree by design.
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the saved theme BEFORE first paint.
          Without this, every navigation renders the light palette first and
          then swaps — a full-screen white flash on each page load, which is
          both unpleasant and the reason most hand-rolled dark modes feel
          broken. Inline and synchronous on purpose: anything deferred is too
          late, since the paint has already happened.
          Wrapped in try/catch because localStorage throws outright in some
          privacy modes, and a theme preference is never worth a blank page.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("gh-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-gh-page text-gh-ink">
        {children}
      </body>
    </html>
  );
}
