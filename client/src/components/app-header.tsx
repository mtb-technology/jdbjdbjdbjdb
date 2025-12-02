import { useState, memo } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { Menu, Zap, FolderOpen, MessageSquare, Calculator, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/pipeline", label: "Pipeline", icon: Zap, testId: "pipeline" },
  { href: "/cases", label: "Cases", icon: FolderOpen, testId: "cases" },
  { href: "/assistant", label: "Assistent", icon: MessageSquare, testId: "assistant" },
  { href: "/box3-validator", label: "Box 3", icon: Calculator, testId: "box3-validator" },
  { href: "/settings", label: "Instellingen", icon: Settings, testId: "settings" },
];

interface AppHeaderProps {
  title?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}

export const AppHeader = memo(function AppHeader({ actions }: AppHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (href: string) => {
    if (href === "/pipeline") {
      return location === "/" || location === "/pipeline";
    }
    return location === href || location.startsWith(href + "/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Zap className="h-6 w-6 text-primary" />
            <span className="font-semibold text-foreground hidden sm:inline">Fiscale Pipeline</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const ItemIcon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  data-testid={`nav-${item.testId}`}
                >
                  <ItemIcon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {actions}
            <DarkModeToggle />

            {/* Mobile Menu */}
            <div className="md:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72">
                  <div className="flex items-center gap-2 mb-8 mt-2">
                    <Zap className="h-6 w-6 text-primary" />
                    <span className="font-semibold">Fiscale Pipeline</span>
                  </div>
                  <nav className="flex flex-col gap-1">
                    {NAV_ITEMS.map((item) => {
                      const ItemIcon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                          data-testid={`nav-mobile-${item.testId}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          <ItemIcon className="h-5 w-5" />
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
