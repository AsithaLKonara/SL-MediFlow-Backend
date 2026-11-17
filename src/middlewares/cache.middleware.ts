import { Request, Response, NextFunction } from "express";
import redisClient from "../lib/redis.js";

interface AuthRequest extends Request {
    user?: { id: string; roleId: string; email: string };
}

// Resilient in-memory fallback cache
const memoryCache = new Map<string, { data: string; expiry: number }>();
export const MAX_MEMORY_CACHE_ENTRIES = 2000;

export function enforceMemoryCacheCapacity(): void {
    if (memoryCache.size < MAX_MEMORY_CACHE_ENTRIES) return;

    // 1. First sweep: Purge all expired entries
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
        if (v.expiry < now) {
            memoryCache.delete(k);
        }
    }

    // 2. Second sweep: If still at capacity, evict oldest entries (FIFO via Map keys order)
    if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
        const excess = memoryCache.size - MAX_MEMORY_CACHE_ENTRIES + 100;
        let evicted = 0;
        for (const key of memoryCache.keys()) {
            memoryCache.delete(key);
            evicted++;
            if (evicted >= excess) break;
        }
    }
}

// Periodic memory cache garbage collection every 60s
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
        if (v.expiry < now) {
            memoryCache.delete(k);
        }
    }
}, 60000).unref();

export const cacheMiddleware = (durationInSeconds: number = 60, isUserSpecific: boolean = false) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        // Only cache safe GET requests
        if (req.method !== "GET") {
            return next();
        }

        const url = req.originalUrl || req.url;
        const key = isUserSpecific && req.user 
            ? `cache:${req.user.id}:${url}` 
            : `cache:${url}`;

        try {
            // 1. Try Redis
            if (redisClient.isReady) {
                const cached = await redisClient.get(key);
                if (cached) {
                    res.setHeader("X-Cache", "HIT-REDIS");
                    res.setHeader("Content-Type", "application/json");
                    return res.send(cached);
                }
            } else {
                // 2. Fallback to memory cache
                const mem = memoryCache.get(key);
                if (mem && mem.expiry > Date.now()) {
                    res.setHeader("X-Cache", "HIT-MEMORY");
                    res.setHeader("Content-Type", "application/json");
                    return res.send(mem.data);
                }
            }
        } catch (err) {
            console.error("Cache read error:", err);
        }

        res.setHeader("X-Cache", "MISS");

        // Intercept response
        const originalSend = res.send.bind(res);
        res.send = (body: any): Response => {
            if (res.statusCode >= 200 && res.statusCode < 300 && body) {
                const dataString = typeof body === "string" ? body : JSON.stringify(body);
                try {
                    if (redisClient.isReady) {
                        redisClient.setEx(key, durationInSeconds, dataString).catch(() => {});
                    } else {
                        enforceMemoryCacheCapacity();
                        memoryCache.set(key, {
                            data: dataString,
                            expiry: Date.now() + durationInSeconds * 1000
                        });
                    }
                } catch (err) {
                    console.error("Cache write error:", err);
                }
            }
            return originalSend(body);
        };

        next();
    };
};

export const clearCache = async (pattern: string) => {
    try {
        const cleanPattern = pattern.replace(/^\//, "").replace(/\*/g, "");
        
        // Clear memory cache
        for (const k of memoryCache.keys()) {
            if (k.includes(cleanPattern)) {
                memoryCache.delete(k);
            }
        }

        // Clear Redis cache
        if (redisClient.isReady) {
            const redisPattern = pattern.startsWith("*") ? `cache:${pattern}` : `cache:*${cleanPattern}*`;
            const keys = await redisClient.keys(redisPattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
        }
    } catch (err) {
        console.error("Error clearing cache for pattern", pattern, err);
    }
};
