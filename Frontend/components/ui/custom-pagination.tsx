import React from 'react';
import { Button } from '@/components/ui/button';

interface CustomPaginationProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  setItemsPerPage: (val: number) => void;
  setCurrentPage: (val: number | ((prev: number) => number)) => void;
  itemsPerPageOptions?: number[];
  className?: string;
}

export function CustomPagination({
  currentPage,
  totalPages,
  itemsPerPage,
  setItemsPerPage,
  setCurrentPage,
  itemsPerPageOptions = [10, 50, 100],
  className = '',
}: CustomPaginationProps) {
  if (totalPages <= 0) return null;

  return (
    <div className={`p-4 flex flex-col sm:flex-row items-center justify-between gap-4 ${className}`}>
      <div>
        <span className="text-sm text-gray-600">
          Page {currentPage} of {totalPages}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((prev: number) => Math.max(prev - 1, 1))}
          disabled={currentPage === 1}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((prev: number) => Math.min(prev + 1, totalPages))}
          disabled={currentPage === totalPages}
        >
          Next
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Items per page:</span>
        <select
          value={itemsPerPage}
          onChange={(e) => {
            setItemsPerPage(Number(e.target.value));
            setCurrentPage(1);
          }}
          className="border border-gray-300 rounded-md shadow-sm text-sm p-1.5 focus:ring-blue-500 focus:border-blue-500"
        >
          {itemsPerPageOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
