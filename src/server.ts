import "dotenv/config";
process.env.TZ = "Asia/Colombo";
process.env.TIMEZONE = "Asia/Colombo";
import app from "./app.js";
import healthRoutes from "./routes/health.routes.js";

import { websocketService } from "./services/websocket.service.js";
import { realandWsService } from "./services/realand-ws.service.js";
import { NotificationService } from "./services/notification.service.js";
import { initTokenLifecycleScheduler } from "./services/token-lifecycle.service.js";

// Mount health & timezone verification routes before 404 handler
const appRouter = (app as any).router || (app as any)._router;
if (appRouter?.stack) {
    const healthIdx = appRouter.stack.findIndex((l: any) => l.route?.path === "/health");
    if (healthIdx >= 0) {
        appRouter.stack.splice(healthIdx, 1);
    }
    const notFoundIdx = appRouter.stack.findIndex((l: any) => !l.route && l.handle?.length === 2);
    app.use(healthRoutes);
    const newLayer = appRouter.stack.pop();
    appRouter.stack.splice(notFoundIdx >= 0 ? notFoundIdx : appRouter.stack.length, 0, newLayer);
}

const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, () => {
    console.log(`SL MediFlow API running on port ${PORT}`);
});

websocketService.initialize(server);
realandWsService.initialize(server);
NotificationService.initSweeper();
initTokenLifecycleScheduler();
