import { useState } from "react";
import { motion } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GlassCard } from "@/components/ui/glass-card";
import { FileText, User, AlertCircle, CheckCircle, Sparkles } from "lucide-react";
import { fadeIn, slideUp, staggerContainer, staggerItem } from "@/lib/animations";

interface IntakeStepProps {
  clientName: string;
  rawText: string;
  onClientNameChange: (name: string) => void;
  onRawTextChange: (text: string) => void;
  isValid: boolean;
}

export function IntakeStep({
  clientName,
  rawText,
  onClientNameChange,
  onRawTextChange,
  isValid,
}: IntakeStepProps) {
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  const charCount = rawText.length;

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header with gradient */}
      <motion.div variants={staggerItem} className="text-center mb-8">
        <motion.div
          className="flex justify-center mb-4"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
        >
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-2xl shadow-lg shadow-blue-500/50">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
        </motion.div>
        <motion.h3
          className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"
          variants={staggerItem}
        >
          Welkom bij de Rapport Generator
        </motion.h3>
        <motion.p
          className="text-muted-foreground text-lg"
          variants={staggerItem}
        >
          Begin met het invoeren van de client informatie en de case details
        </motion.p>
      </motion.div>

      {/* Status Alert with animation */}
      <motion.div variants={staggerItem}>
        {isValid ? (
          <GlassCard variant="success" className="p-4">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <CheckCircle className="h-5 w-5 text-green-600" />
              </motion.div>
              <p className="text-green-800 dark:text-green-300 font-medium">
                Alle vereiste informatie is ingevuld. Klik op "Volgende" om verder te gaan.
              </p>
            </div>
          </GlassCard>
        ) : (
          <GlassCard variant="warning" className="p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <p className="text-amber-800 dark:text-amber-300">
                Vul alle velden in om door te gaan naar de volgende stap
              </p>
            </div>
          </GlassCard>
        )}
      </motion.div>

      {/* Client Name Input */}
      <div className="space-y-2">
        <Label htmlFor="clientName" className="flex items-center gap-2">
          <User className="h-4 w-4" />
          Client Naam *
        </Label>
        <Input
          id="clientName"
          value={clientName}
          onChange={(e) => onClientNameChange(e.target.value)}
          placeholder="Bijv. Jan de Vries"
          className="text-lg"
        />
        <p className="text-xs text-muted-foreground">
          De naam van de client voor wie dit rapport wordt gemaakt
        </p>
      </div>

      {/* Raw Text Input */}
      <div className="space-y-2">
        <Label htmlFor="rawText" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Case Informatie *
        </Label>
        <Textarea
          id="rawText"
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          placeholder="Plak hier de complete case informatie, inclusief fiscale situatie, vragen, en relevante details..."
          rows={12}
          className="font-mono text-sm"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {wordCount} {wordCount === 1 ? 'woord' : 'woorden'} · {charCount} karakters
          </span>
          {wordCount > 0 && (
            <span className={wordCount < 50 ? "text-amber-600" : "text-green-600"}>
              {wordCount < 50 ? "⚠️ Minimaal 50 woorden aanbevolen" : "✓ Voldoende detail"}
            </span>
          )}
        </div>
      </div>

      {/* Help Text with glassmorphism */}
      <motion.div variants={staggerItem}>
        <GlassCard variant="primary" className="p-6 border-2">
          <div className="flex items-start gap-3">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-blue-900 dark:text-blue-100 mb-3 text-lg">
                Tips voor betere resultaten
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">✓</span>
                  <span>Voeg alle relevante fiscale details toe</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">✓</span>
                  <span>Beschrijf de situatie zo specifiek mogelijk</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">✓</span>
                  <span>Vermeld concrete vragen of doelstellingen</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">✓</span>
                  <span>Minimaal 50 woorden is aanbevolen voor een degelijk rapport</span>
                </li>
              </ul>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
