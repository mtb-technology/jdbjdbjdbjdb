import { useState, memo } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { Menu, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  testId: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/pipeline", label: "Pipeline", testId: "pipeline" },
  { href: "/cases", label: "Cases", testId: "cases" },
  { href: "/assistant", label: "Assistent", testId: "assistant" },
  { href: "/text-styler", label: "Text Styler", testId: "text-styler" },
  { href: "/settings", label: "Instellingen", testId: "settings" },
];

interface AppHeaderProps {
  title: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}

export const AppHeader = memo(function AppHeader({ title, icon: Icon = Zap, actions }: AppHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (href: string) => {
    if (href === "/pipeline") {
      return location === "/" || location === "/pipeline";
    }
    return location === href || location.startsWith(href + "/");
  };

  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link href="/pipeline" className="flex-shrink-0 flex items-center hover:opacity-80 transition-opacity">
              <Zap className="text-2xl text-primary mr-2 h-7 w-7" />
              <span className="text-lg font-bold text-primary">Fiscale Pipeline</span>
            </Link>
            {title !== "Fiscale Pipeline" && (
              <>
                <span className="mx-3 text-muted-foreground">/</span>
                <div className="flex items-center">
                  <Icon className="text-muted-foreground mr-2 h-5 w-5" />
                  <span className="text-lg font-medium text-foreground">{title}</span>
                </div>
              </>
            )}
            {/* Desktop Navigation */}
            <nav className="hidden md:ml-10 md:flex md:space-x-8">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={isActive(item.href)
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                  }
                  data-testid={`nav-${item.testId}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <DarkModeToggle />
            {actions}
            {/* Mobile Navigation */}
            <div className="md:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64">
                  <nav className="flex flex-col space-y-4 mt-8">
                    {NAV_ITEMS.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`p-2 rounded-md ${
                          isActive(item.href)
                            ? "text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        data-testid={`nav-mobile-${item.testId}`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
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
