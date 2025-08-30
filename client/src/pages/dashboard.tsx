import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, User, ChartLine } from "lucide-react";
import ReportGenerator from "@/components/report-generator";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ChartLine className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">De Fiscale Analist</span>
              </div>
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <a href="#" className="text-primary font-medium" data-testid="nav-dashboard">
                  Dashboard
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground" data-testid="nav-reports">
                  Rapporten
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground" data-testid="nav-sources">
                  Bronnen
                </a>
                <a href="#" className="text-muted-foreground hover:text-foreground" data-testid="nav-settings">
                  Instellingen
                </a>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="icon" data-testid="button-notifications">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </Button>
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <User className="text-primary-foreground text-sm h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <ReportGenerator />
      </div>
    </div>
  );
}
