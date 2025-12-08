/**
 * Box3NewCase Component
 *
 * Form for creating a new Box 3 validation case.
 */

import { memo, useState, useRef, useCallback } from "react";
import imageCompression from "browser-image-compression";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  FileCheck,
  Upload,
  RefreshCw,
  XCircle,
  FileText,
  Mail,
  User,
  Settings as SettingsIcon,
} from "lucide-react";

import type { PendingFile } from "@/types/box3Validator.types";

interface Box3NewCaseProps {
  isValidating: boolean;
  onBack: () => void;
  onValidate: (clientName: string, inputText: string, files: PendingFile[]) => void;
  onOpenSettings: () => void;
}

export const Box3NewCase = memo(function Box3NewCase({
  isValidating,
  onBack,
  onValidate,
  onOpenSettings,
}: Box3NewCaseProps) {
  const [clientName, setClientName] = useState("");
  const [inputText, setInputText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
                const originalSize = (file.size / 1024 / 1024).toFixed(1);
                const newSize = (compressedFile.size / 1024 / 1024).toFixed(1);
                console.log(`📸 Compressed ${file.name}: ${originalSize}MB → ${newSize}MB`);
                return {
                  file: compressedFile,
                  name: file.name,
                  originalSize: file.size,
                  compressed: true,
                };
              } catch (err) {
                console.warn(`Failed to compress ${file.name}:`, err);
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

  const handleValidate = useCallback(() => {
    onValidate(clientName, inputText, pendingFiles);
  }, [onValidate, clientName, inputText, pendingFiles]);

  const canValidate = clientName.trim() || inputText.trim() || pendingFiles.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar overzicht
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Nieuwe Case</h1>
            <p className="text-sm text-muted-foreground">
              Voer klantgegevens in en upload documenten
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <SettingsIcon className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      {/* Input Form */}
      <div className="grid gap-6">
        {/* Client Name */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center">
              <User className="h-4 w-4 mr-2 text-muted-foreground" />
              Klantnaam
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Bijv. Jan de Vries"
            />
          </CardContent>
        </Card>

        {/* Mail Text Input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base">
              <Mail className="h-4 w-4 mr-2 text-blue-500" />
              Mail van klant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Plak hier de mail tekst van de klant..."
              className="font-mono text-sm min-h-32"
            />
          </CardContent>
        </Card>

        {/* File Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base">
              <Upload className="h-4 w-4 mr-2 text-green-500" />
              Bijlages ({pendingFiles.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.jpg,.jpeg,.png"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
              disabled={isCompressing}
            >
              {isCompressing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Afbeeldingen comprimeren...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Selecteer bestanden (PDF, TXT, JPG, PNG)
                </>
              )}
            </Button>

            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                {pendingFiles.map((pf, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-muted rounded-md"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm truncate">{pf.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(pf.file.size / 1024).toFixed(1)} KB)
                        {pf.compressed && pf.originalSize && (
                          <span className="text-green-600 ml-1">
                            ✓ gecomprimeerd van {(pf.originalSize / 1024 / 1024).toFixed(1)}MB
                          </span>
                        )}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(idx)}
                    >
                      <XCircle className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Validate Button */}
        <div className="flex justify-center">
          <Button
            onClick={handleValidate}
            disabled={isValidating || !canValidate}
            size="lg"
            className="min-w-64"
          >
            {isValidating ? (
              <>
                <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                Analyseren...
              </>
            ) : (
              <>
                <FileCheck className="mr-2 h-5 w-5" />
                Start Analyse
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
