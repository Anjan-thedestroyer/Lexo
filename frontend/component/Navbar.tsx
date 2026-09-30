"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useAuth } from "@/hooks/useAuth";
import axiosInstance from "@/lib/axios";
import { useRouter } from "next/navigation";

interface NavbarProps {
  transparent?: boolean;
}

const Navbar = ({ transparent = false }: NavbarProps) => {
  const router = useRouter();
  
  const pathname = usePathname();

  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  const { user, loading, isAuthenticated } = useAuth();

  const [isAuthed, setIsAuthed] = useState(false)

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    setMounted(true);
    console.log(isConnected)
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY <= 20) {
        setVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setVisible(false);
      } else {
        setVisible(true);
      }

      lastScrollY = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);
  const handleLogout=async()=>{
    try{
      const response = await axiosInstance.post("/auth/logout")
      console.log(response)
       if (response.data.success) {
         window.location.reload();
       }
    }catch(error){
      console.log(error)
    }
  }
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

  const linkClass = (path: string) =>
    `text-sm font-medium transition-colors duration-200 ${
      pathname === path || (path !== "/" && pathname.startsWith(`${path}/`))
        ? "text-white"
        : "text-white/65 hover:text-white"
    }`;

  return (
    <header className="relative z-50">
      <nav
        className={`fixed left-0 top-0 z-50 w-full transition-transform duration-300 ${
          visible ? "translate-y-0" : "-translate-y-full"
        } ${
          transparent
            ? "bg-transparent"
            : "border-b border-white/10 bg-[#080B14]/90 shadow-lg backdrop-blur-xl"
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

            <Link href="/verify" className={linkClass("/verify")}>
              Verify
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
            {!loading &&
              (isAuthenticated ? (
                <>
                  <span className="hidden text-sm text-white/60 lg:block">
                    {user?.name}
                  </span>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    Logout
                  </button>

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
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    Login
                  </Link>

                  <Link
                    href="/signup"
                    className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#080B14] transition hover:bg-white/90"
                  >
                    Get Started
                  </Link>
                </>
              ))}
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
