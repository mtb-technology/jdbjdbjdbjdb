import { useState, memo } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { Menu, Sparkles, FolderOpen, MessageSquare, Calculator, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import janLogo from "@/../../assets/Symbol + font logo-dark - bigger size.png";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/pipeline", label: "Analyse", icon: Sparkles, testId: "pipeline" },
  { href: "/cases", label: "Cases", icon: FolderOpen, testId: "cases" },
  { href: "/assistant", label: "Assistent", icon: MessageSquare, testId: "assistant" },
  { href: "/box3-validator", label: "Box 3", icon: Calculator, testId: "box3-validator" },
  { href: "/settings", label: "Instellingen", icon: Settings, testId: "settings" },
];

export const AppHeader = memo(function AppHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (href: string) => {
    if (href === "/pipeline") {
      return location === "/" || location === "/pipeline";
    }
    return location === href || location.startsWith(href + "/");
  };

  return (
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center gap-2 hover:opacity-80 transition-all duration-200 hover:scale-[1.02]">
            <img src={janLogo} alt="Jan de Belastingman" className="h-9" />
          </Link>

          {/* Desktop Navigation - Centered pill nav */}
          <nav className="hidden md:flex items-center bg-slate-100/80 dark:bg-slate-800/50 rounded-full px-1.5 py-1.5 gap-1">
            {NAV_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 ${
                    active
                      ? "bg-white dark:bg-slate-900 text-[#1E4DB7] shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                  }`}
                  data-testid={`nav-${item.testId}`}
                >
                  <ItemIcon className={`h-4 w-4 ${active ? 'text-[#1E4DB7]' : ''}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-3">
            <DarkModeToggle />

            {/* Mobile Menu */}
            <div className="md:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-mobile-menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl">
                  <div className="flex items-center gap-2 mb-8 mt-2">
                    <img src={janLogo} alt="Jan de Belastingman" className="h-10" />
                  </div>
                  <nav className="flex flex-col gap-1">
                    {NAV_ITEMS.map((item) => {
                      const ItemIcon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                            active
                              ? "bg-[#1E4DB7]/10 text-[#1E4DB7]"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                          data-testid={`nav-mobile-${item.testId}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <ItemIcon className={`h-5 w-5 ${active ? 'text-[#1E4DB7]' : ''}`} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});

export default AppHeader;
