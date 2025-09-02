"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Card } from "@/components/ui/card";

interface EmployeeNavigationProps {
  showBack?: boolean;
  showForward?: boolean;
  customBackPath?: string;
  customForwardPath?: string;
  className?: string;
}

const EmployeeNavigation = ({ 
  showBack = true, 
  showForward = true,
  customBackPath,
  customForwardPath,
  className = ""
}: EmployeeNavigationProps) => {
  const router = useRouter();

  const handleBack = () => {
    if (customBackPath) {
      router.push(customBackPath);
    } else {
      router.back();
    }
  };

  const handleForward = () => {
    if (customForwardPath) {
      router.push(customForwardPath);
    } else {
      // Default forward behavior - could be customized per page
      router.push("/employee/welcome");
    }
  };

  const handleHome = () => {
    router.push("/employee/welcome");
  };

  return (
    <Card className={`p-3 mb-4 ${className}`}>
      <div className="flex items-center justify-between">
        {/* Back Navigation */}
        <div className="flex items-center gap-2">
          {showBack && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="flex items-center gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          )}
        </div>

        {/* Home Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleHome}
          className="flex items-center gap-2"
        >
          <Home className="h-4 w-4" />
          Dashboard
        </Button>

        {/* Forward Navigation */}
        <div className="flex items-center gap-2">
          {showForward && customForwardPath && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleForward}
              className="flex items-center gap-2"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default EmployeeNavigation;
