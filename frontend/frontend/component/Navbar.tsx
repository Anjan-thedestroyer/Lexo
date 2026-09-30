"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { clearAuth, isAuthenticated } from "@/app/lib/auth";
interface NavbarProps {
  transparent?: boolean;
}

const Navbar = ({ transparent  }: NavbarProps) => {
  const pathname = usePathname();

  const [sticky, setSticky] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [mounted, setMounted] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setSticky(window.scrollY > 50);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const checkAuth = () => {
      setIsLogged(isAuthenticated());
    };

    checkAuth();

    window.addEventListener("auth-change", checkAuth);

    return () => {
      window.removeEventListener("auth-change", checkAuth);
    };
  }, []);

  const handleWallet = () => {
    if (!mounted) return;

    if (isConnected) {
      disconnect();
      return;
    }

    connect({
      connector: injected(),
    });
  };

  const handleLogout = () => {
    clearAuth();

    setIsLogged(false);
    window.dispatchEvent(new Event("auth-change"));
  };

  const linkClass = (path: string) =>
    `text-sm font-medium transition-colors duration-200 ${
      pathname === path || (path !== "/" && pathname.startsWith(`${path}/`))
        ? "text-white"
        : "text-white/65 hover:text-white"
    }`;

  return (
    <header className="relative z-50">
      <nav
        className={`fixed left-0 top-0 z-50 w-full transition-all duration-300 ${
          sticky || !transparent
            ? "border-b border-white/10 bg-[#080B14]/90 shadow-lg backdrop-blur-xl"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-8">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="Lexo"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-lg font-bold text-[#080B14]">
              L
            </div>

            <span className="text-2xl font-bold tracking-tight text-white">
              Lexo
            </span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-8">
            <Link href="/" className={linkClass("/")}>
              Home
            </Link>

            <Link href="/deals" className={linkClass("/deals")}>
              Deals
            </Link>

            <Link href="/escrow" className={linkClass("/escrow")}>
              Escrow
            </Link>

            <Link href="/activity" className={linkClass("/activity")}>
              Activity
            </Link>

            <Link
              href="/how-it-works"
              className={linkClass("/how-it-works")}
            >
              How It Works
            </Link>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {isLogged ? (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
              >
                Logout
              </button>
            ) : (
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
              >
                Login
              </Link>
            )}

            {/* Wallet */}
            <button
              type="button"
              onClick={handleWallet}
              disabled={!mounted}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#080B14] transition hover:bg-white/90 disabled:cursor-default disabled:opacity-100"
            >
              {!mounted
                ? "Connect Wallet"
                : isConnected && address
                  ? `${address.slice(0, 6)}...${address.slice(-4)}`
                  : "Connect Wallet"}
            </button>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Navbar;