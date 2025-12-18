import type { Request, Response } from "express";
import type { StreamingEvent } from "@shared/streaming-types";
import { StreamingSessionManager } from "./streaming-session-manager";
import { logger } from "../logger";

export class SSEHandler {
  private clients: Map<string, Response> = new Map();
  private sessionManager: StreamingSessionManager;

  constructor() {
    this.sessionManager = StreamingSessionManager.getInstance();
  }

  // Handle SSE connection
  handleConnection(req: Request, res: Response): void {
    const { reportId, stageId } = req.params;
    const clientId = `${reportId}-${stageId}-${Date.now()}`;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send initial connection event
    this.sendEvent(res, {
      type: 'progress',
      stageId,
      percentage: 0,
      message: 'Connected to streaming service',
      timestamp: new Date().toISOString()
    } as StreamingEvent);

    // Store client
    this.clients.set(clientId, res);

    logger.info(clientId, `SSE client connected for ${reportId}-${stageId}`);

    // Subscribe to events for this session
    const unsubscribe = this.sessionManager.subscribe(reportId, stageId, (event: StreamingEvent) => {
      this.sendEvent(res, event);
    });

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(clientId);
      unsubscribe();
      logger.debug(clientId, 'SSE client disconnected');
    });

    // Send existing session data if available
    const session = this.sessionManager.getSession(reportId, stageId);
    if (session) {
      this.sendEvent(res, {
        type: 'progress',
        stageId,
        percentage: session.progress.percentage,
        message: `Resuming: ${session.progress.currentSubstep || 'In progress'}`,
        timestamp: new Date().toISOString()
      } as StreamingEvent);
    }

    // Keep-alive ping
    const pingInterval = setInterval(() => {
      if (this.clients.has(clientId)) {
        res.write(': ping\n\n');
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(pingInterval);
    });
  }

  // Send event to specific client
  private sendEvent(res: Response, event: StreamingEvent): void {
    try {
      // Check of connectie nog open is voordat we schrijven
      if (res.destroyed || res.writableEnded) {
        return;
      }
      const data = JSON.stringify(event);
      res.write(`data: ${data}\n\n`);
    } catch (error) {
      // Silently ignore write errors - client likely disconnected
      console.debug('SSE write failed (client likely disconnected)');
    }
  }

  // Broadcast to all clients for a session
  broadcast(reportId: string, stageId: string, event: StreamingEvent): void {
    const sessionKey = `${reportId}-${stageId}`;
    
    const entries = Array.from(this.clients.entries());
    for (const [clientId, res] of entries) {
      if (clientId.startsWith(sessionKey)) {
        this.sendEvent(res, event);
      }
    }
  }

  // Get connected client count
  getClientCount(reportId?: string, stageId?: string): number {
    if (reportId && stageId) {
      const sessionKey = `${reportId}-${stageId}`;
      return Array.from(this.clients.keys()).filter(id => id.startsWith(sessionKey)).length;
    }
    return this.clients.size;
  }

  // Close all connections for a session
  closeSession(reportId: string, stageId: string): void {
    const sessionKey = `${reportId}-${stageId}`;
    
    const entries = Array.from(this.clients.entries());
    for (const [clientId, res] of entries) {
      if (clientId.startsWith(sessionKey)) {
        try {
          res.end();
        } catch (error) {
          logger.error('sse-handler', 'Error closing SSE connection', {}, error instanceof Error ? error : undefined);
        }
        this.clients.delete(clientId);
      }
    }

    logger.info('sse-handler', `Closed all SSE connections for ${sessionKey}`);
  }

  // Cleanup disconnected clients
  cleanup(): void {
    const entries = Array.from(this.clients.entries());
    for (const [clientId, res] of entries) {
      if (res.destroyed || res.closed) {
        this.clients.delete(clientId);
      }
    }
  }
}