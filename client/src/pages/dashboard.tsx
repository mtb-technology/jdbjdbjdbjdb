import { ChartLine } from "lucide-react";
import ReportGenerator from "@/components/report-generator";
import { AppHeader } from "@/components/app-header";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <ReportGenerator />
      </div>
    </div>
  );
}
