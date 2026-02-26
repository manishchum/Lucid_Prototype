"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

interface CacheEntry {
    data: any;
    timestamp: number;
}

interface DataContextType {
    cache: Record<string, CacheEntry>;
    setCacheData: (key: string, data: any) => void;
    getCacheData: (key: string) => any | null;
    clearCache: (key?: string) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: React.ReactNode }) => {
    const [cache, setCache] = useState<Record<string, CacheEntry>>({});
    const cacheRef = useRef<Record<string, CacheEntry>>({});

    const setCacheData = useCallback((key: string, data: any) => {
        const entry = { data, timestamp: Date.now() };
        cacheRef.current[key] = entry;
        setCache((prev) => ({ ...prev, [key]: entry }));
    }, []);

    const getCacheData = useCallback((key: string) => {
        return cacheRef.current[key]?.data || null;
    }, []);

    const clearCache = useCallback((key?: string) => {
        if (key) {
            delete cacheRef.current[key];
            setCache((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        } else {
            cacheRef.current = {};
            setCache({});
        }
    }, []);

    return (
        <DataContext.Provider value={{ cache, setCacheData, getCacheData, clearCache }}>
            {children}
        </DataContext.Provider>
    );
};

export const useDataCache = () => {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error("useDataCache must be used within a DataProvider");
    }
    return context;
};
