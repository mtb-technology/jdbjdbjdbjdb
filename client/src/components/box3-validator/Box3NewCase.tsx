/**
 * Box3NewCase Component
 *
 * Form for creating a new Box 3 validation case.
 * Modern styling matching Pipeline page design.
 */

import { memo, useState, useRef, useCallback, DragEvent } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  FileCheck,
  Upload,
  Loader2,
  X,
  FileText,
  FolderOpen,
} from "lucide-react";

import type { PendingFile } from "@/types/box3Validator.types";

interface Box3NewCaseProps {
  isValidating: boolean;
  onBack: () => void;
  onValidate: (clientName: string, inputText: string, files: PendingFile[]) => void;
}

export const Box3NewCase = memo(function Box3NewCase({
  isValidating,
  onBack,
  onValidate,
}: Box3NewCaseProps) {
  const [clientName, setClientName] = useState("");
  const [inputText, setInputText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Image compression options
  const compressionOptions = {
    maxSizeMB: 1, // Max 1MB per image
    maxWidthOrHeight: 2048, // Max dimension
    useWebWorker: true,
  };

  // File handling with auto-compression for images
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;

      const files = Array.from(e.target.files);
      setIsCompressing(true);

      try {
        const processedFiles: PendingFile[] = await Promise.all(
          files.map(async (file) => {
            const isImage = file.type.startsWith("image/");

            // Compress images > 1MB
            if (isImage && file.size > 1024 * 1024) {
              try {
                const compressedFile = await imageCompression(file, compressionOptions);
                return {
                  file: compressedFile,
                  name: file.name,
                  originalSize: file.size,
                  compressed: true,
                };
              } catch {
                // Compression failed, use original file
                return { file, name: file.name };
              }
            }

            return { file, name: file.name };
          })
        );

        setPendingFiles((prev) => [...prev, ...processedFiles]);
      } finally {
        setIsCompressing(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    []
  );

  const handleRemoveFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    // Filter valid file types
    const validTypes = ['.pdf', '.txt', '.jpg', '.jpeg', '.png'];
    const files = Array.from(droppedFiles).filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return validTypes.includes(ext);
    });

    if (files.length === 0) return;

    setIsCompressing(true);

    try {
      const processedFiles: PendingFile[] = await Promise.all(
        files.map(async (file) => {
          const isImage = file.type.startsWith("image/");

          if (isImage && file.size > 1024 * 1024) {
            try {
              const compressedFile = await imageCompression(file, compressionOptions);
              return {
                file: compressedFile,
                name: file.name,
                originalSize: file.size,
                compressed: true,
              };
            } catch {
              return { file, name: file.name };
            }
          }

          return { file, name: file.name };
        })
      );

      setPendingFiles((prev) => [...prev, ...processedFiles]);
    } finally {
      setIsCompressing(false);
    }
  }, [compressionOptions]);

  const handleValidate = useCallback(() => {
    onValidate(clientName, inputText, pendingFiles);
  }, [onValidate, clientName, inputText, pendingFiles]);

  const canValidate = clientName.trim() || inputText.trim() || pendingFiles.length > 0;

  return (
    <div className="min-h-[calc(100vh-80px)] relative -mx-4 sm:-mx-6 lg:-mx-8 -my-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Full-page gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#F5A623]/5 via-slate-50 to-[#1E4DB7]/5 dark:via-slate-950 -z-10" />
      <div className="fixed top-0 right-0 w-[600px] h-[600px] bg-[#F5A623]/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 -z-10" />
      <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-[#1E4DB7]/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 -z-10" />

      <div className="relative mx-auto max-w-3xl py-4">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-6 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Terug naar overzicht
        </Button>

        {/* Page Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Nieuwe Case
          </h1>
          <p className="text-muted-foreground">
            Voer klantgegevens in en upload documenten
          </p>
        </div>

        {/* Main Input Card */}
        <Card className="border-0 shadow-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm">
          <CardContent className="p-8 space-y-6">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.jpg,.jpeg,.png"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Client Name Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Klantnaam
              </label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Bijv. Jan de Vries"
                className="text-base border-slate-200 dark:border-slate-700 focus:border-[#1E4DB7] focus:ring-[#1E4DB7]/20"
              />
            </div>

            {/* Mail Text Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Mail van klant
              </label>
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Plak hier de mail tekst van de klant..."
                className="min-h-32 resize-none text-base border-slate-200 dark:border-slate-700 focus:border-[#1E4DB7] focus:ring-[#1E4DB7]/20"
              />
            </div>

            {/* Attachments - Drag & Drop Zone */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground">
                Bijlages ({pendingFiles.length})
              </label>

              <div
                ref={dropZoneRef}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => !isCompressing && fileInputRef.current?.click()}
                className={cn(
                  "relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all",
                  isDragging
                    ? "border-[#1E4DB7] bg-[#1E4DB7]/5 scale-[1.01]"
                    : "border-slate-200 dark:border-slate-700 hover:border-[#1E4DB7]/50 hover:bg-[#1E4DB7]/5",
                  isCompressing && "pointer-events-none opacity-60"
                )}
              >
                {isDragging ? (
                  <div className="space-y-1">
                    <Upload className="h-8 w-8 mx-auto text-[#1E4DB7] animate-bounce" />
                    <p className="text-sm font-medium text-[#1E4DB7]">Laat los om te uploaden</p>
                  </div>
                ) : isCompressing ? (
                  <div className="space-y-1">
                    <Loader2 className="h-6 w-6 mx-auto text-muted-foreground animate-spin" />
                    <p className="text-sm text-muted-foreground">Afbeeldingen comprimeren...</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
                    <p className="text-sm">
                      Sleep bestanden of <span className="text-[#1E4DB7] font-medium">klik om te uploaden</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF, TXT, JPG, PNG
                    </p>
                  </div>
                )}
              </div>

              {/* Pending files badges */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((pf, idx) => (
                    <Badge key={idx} variant="secondary" className="gap-2 pr-1 bg-slate-100 dark:bg-slate-800">
                      <FileText className="h-3 w-3" />
                      <span className="text-xs max-w-[150px] truncate">{pf.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({Math.round(pf.file.size / 1024)}KB)
                        {pf.compressed && pf.originalSize && (
                          <span className="text-green-600 ml-1">
                            gecomprimeerd
                          </span>
                        )}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFile(idx);
                        }}
                        className="ml-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-sm p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                onClick={handleValidate}
                disabled={isValidating || !canValidate || isCompressing}
                className="flex-1 h-12 text-base font-semibold bg-[#1E4DB7] hover:bg-[#1E4DB7]/90 shadow-lg shadow-[#1E4DB7]/20"
                size="lg"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Analyseren...
                  </>
                ) : (
                  <>
                    <FileCheck className="mr-2 h-5 w-5" />
                    Start Analyse
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onBack}
                className="h-12 w-full sm:w-auto border-slate-300 dark:border-slate-600 hover:bg-white/50 dark:hover:bg-slate-800/50"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Bekijk Cases
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});
