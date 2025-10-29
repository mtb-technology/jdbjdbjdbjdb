import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { asyncHandler, ServerError } from "../middleware/errorHandler";
import type {
  CreateChangeProposalRequest,
  ReviewChangeRequest,
  ApplyChangesRequest,
  DocumentChange,
  PendingChanges,
  SpecialistChanges,
  DocumentSnapshot,
} from "@shared/document-types";

export const documentRouter = Router();

/**
 * Get pending changes for a report
 */
documentRouter.get(
  "/:reportId/changes",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report niet gevonden", "Het rapport bestaat niet");
    }

    const pendingChanges = (report.pendingChanges as PendingChanges) || {};

    res.json({
      success: true,
      data: {
        reportId,
        pendingChanges,
      },
    });
  })
);

/**
 * Create change proposals from a specialist
 */
documentRouter.post(
  "/:reportId/changes",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;
    const { specialistId, changes } = req.body as CreateChangeProposalRequest;

    if (!specialistId || !changes || !Array.isArray(changes)) {
      throw ServerError.validation(
        "Invalid request body",
        "Specialist ID en changes zijn verplicht"
      );
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // Create DocumentChange objects with IDs and timestamps
    const documentChanges: DocumentChange[] = changes.map((c, idx) => ({
      id: `${specialistId}-${Date.now()}-${idx}`,
      type: c.type,
      position: c.position,
      oldText: c.oldText,
      newText: c.newText,
      comment: c.comment,
      specialist: specialistId,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    }));

    // Update pending changes
    const existingChanges = (report.pendingChanges as PendingChanges) || {};
    const specialistChanges: SpecialistChanges = {
      specialist: specialistId,
      stageId: report.currentStage || '',
      changes: documentChanges,
      status: 'pending',
    };

    const updatedChanges: PendingChanges = {
      ...existingChanges,
      [specialistId]: specialistChanges,
    };

    await storage.updateReport(reportId, {
      pendingChanges: updatedChanges as any,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      data: {
        specialistId,
        changesCreated: documentChanges.length,
        changes: documentChanges,
      },
    });
  })
);

/**
 * Review a single change (accept or reject)
 */
documentRouter.post(
  "/:reportId/changes/:changeId/review",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId, changeId } = req.params;
    const { action, comment } = req.body as ReviewChangeRequest;

    if (!action || !['accept', 'reject'].includes(action)) {
      throw ServerError.validation(
        "Invalid action",
        "Actie moet 'accept' of 'reject' zijn"
      );
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report niet gevonden", "Het rapport bestaat niet");
    }

    const pendingChanges = (report.pendingChanges as PendingChanges) || {};

    // Find the change and update its status
    let changeFound = false;
    for (const specialistId in pendingChanges) {
      const specialistChanges = pendingChanges[specialistId];
      const changeIndex = specialistChanges.changes.findIndex(c => c.id === changeId);

      if (changeIndex !== -1) {
        specialistChanges.changes[changeIndex].status = action === 'accept' ? 'accepted' : 'rejected';
        if (action === 'accept') {
          specialistChanges.changes[changeIndex].appliedAt = new Date().toISOString();
        }
        changeFound = true;
        break;
      }
    }

    if (!changeFound) {
      throw ServerError.notFound("Change");
    }

    await storage.updateReport(reportId, {
      pendingChanges: pendingChanges as any,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      data: {
        changeId,
        action,
        message: action === 'accept' ? 'Wijziging geaccepteerd' : 'Wijziging afgewezen',
      },
    });
  })
);

/**
 * Accept or reject all changes from a specialist
 */
documentRouter.post(
  "/:reportId/specialists/:specialistId/review-all",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId, specialistId } = req.params;
    const { action } = req.body as { action: 'accept' | 'reject' };

    if (!action || !['accept', 'reject'].includes(action)) {
      throw ServerError.validation(
        "Invalid action",
        "Actie moet 'accept' of 'reject' zijn"
      );
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report niet gevonden", "Het rapport bestaat niet");
    }

    const pendingChanges = (report.pendingChanges as PendingChanges) || {};

    if (!pendingChanges[specialistId]) {
      throw ServerError.notFound("Specialist changes");
    }

    // Update all pending changes from this specialist
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    const now = new Date().toISOString();

    pendingChanges[specialistId].changes = pendingChanges[specialistId].changes.map(change => {
      if (change.status === 'pending') {
        return {
          ...change,
          status: newStatus as any,
          ...(action === 'accept' && { appliedAt: now }),
        };
      }
      return change;
    });

    pendingChanges[specialistId].status = action === 'accept' ? 'applied' : 'rejected';
    pendingChanges[specialistId].reviewedAt = now;

    await storage.updateReport(reportId, {
      pendingChanges: pendingChanges as any,
      updatedAt: new Date(),
    });

    const changesCount = pendingChanges[specialistId].changes.filter(
      c => c.status === newStatus
    ).length;

    res.json({
      success: true,
      data: {
        specialistId,
        action,
        changesReviewed: changesCount,
        message: action === 'accept'
          ? `Alle ${changesCount} wijzigingen geaccepteerd`
          : `Alle ${changesCount} wijzigingen afgewezen`,
      },
    });
  })
);

/**
 * Apply accepted changes to the document
 */
documentRouter.post(
  "/:reportId/apply-changes",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;
    const { changeIds } = req.body as ApplyChangesRequest;

    if (!changeIds || !Array.isArray(changeIds)) {
      throw ServerError.validation(
        "Invalid request body",
        "changeIds moet een array zijn"
      );
    }

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    // This is where you would apply the changes to documentState
    // For now, we'll just mark them as applied
    const pendingChanges = (report.pendingChanges as PendingChanges) || {};

    let appliedCount = 0;
    for (const specialistId in pendingChanges) {
      const specialistChanges = pendingChanges[specialistId];
      specialistChanges.changes = specialistChanges.changes.map(change => {
        if (changeIds.includes(change.id) && change.status === 'accepted') {
          appliedCount++;
          return { ...change, status: 'applied' as const };
        }
        return change;
      });
    }

    // Create snapshot
    const snapshots = (report.documentSnapshots as any) || {};
    const snapshotId = `snapshot-${Date.now()}`;
    snapshots[snapshotId] = {
      stageId: report.currentStage || '',
      content: report.documentState,
      timestamp: new Date().toISOString(),
      appliedChanges: changeIds,
    };

    await storage.updateReport(reportId, {
      pendingChanges: pendingChanges as any,
      documentSnapshots: snapshots,
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      data: {
        appliedCount,
        snapshotId,
        message: `${appliedCount} wijzigingen toegepast`,
      },
    });
  })
);

/**
 * Get document snapshots for audit trail
 */
documentRouter.get(
  "/:reportId/snapshots",
  asyncHandler(async (req: Request, res: Response) => {
    const { reportId } = req.params;

    const report = await storage.getReport(reportId);
    if (!report) {
      throw ServerError.notFound("Report");
    }

    const snapshots = (report.documentSnapshots as Record<string, DocumentSnapshot>) || {};

    res.json({
      success: true,
      data: {
        reportId,
        snapshots: Object.entries(snapshots).map(([id, snapshot]) => ({
          id,
          ...snapshot,
        })),
      },
    });
  })
);
