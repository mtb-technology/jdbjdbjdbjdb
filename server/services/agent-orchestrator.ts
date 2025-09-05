import { storage } from "../storage";
import { ReportGenerator } from "./report-generator";
import type { Report, DossierData, BouwplanData } from "@shared/schema";

export interface Agent {
  id: string;
  name: string;
  specialty: string;
  dependencies: string[]; // Which agents need to complete first
  canRunParallel: boolean;
  priority: number; // 1 = highest priority
}

export interface AgentResult {
  agentId: string;
  output: string;
  feedback: AgentFeedback[];
  qualityScore: number;
  suggestedIterations: string[];
}

export interface AgentFeedback {
  fromAgent: string;
  toAgent: string;
  feedback: string;
  severity: 'low' | 'medium' | 'high';
  actionRequired: boolean;
}

export class AgentOrchestrator {
  private reportGenerator: ReportGenerator;
  private agents: Map<string, Agent>;
  private results: Map<string, AgentResult>;
  private feedbackNetwork: AgentFeedback[];

  constructor() {
    this.reportGenerator = new ReportGenerator();
    this.agents = new Map();
    this.results = new Map();
    this.feedbackNetwork = [];
    this.initializeAgents();
  }

  private initializeAgents() {
    const agentDefinitions: Agent[] = [
      // Phase 1: Foundation (can run parallel)
      {
        id: "info_processor",
        name: "Informatie Processor",
        specialty: "Raw data structuring and analysis",
        dependencies: [],
        canRunParallel: true,
        priority: 1
      },
      {
        id: "complexity_analyzer", 
        name: "Complexiteit Analist",
        specialty: "Case complexity and scope analysis",
        dependencies: [],
        canRunParallel: true,
        priority: 1
      },

      // Phase 2: Core Generation (after foundation)
      {
        id: "report_generator",
        name: "Rapport Generator",
        specialty: "Initial report generation",
        dependencies: ["info_processor", "complexity_analyzer"],
        canRunParallel: false,
        priority: 2
      },

      // Phase 3: Specialist Review Network (can run parallel after core)
      {
        id: "sources_specialist",
        name: "Bronnen Specialist",
        specialty: "Source verification and citation",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },
      {
        id: "fiscal_specialist",
        name: "Fiscaal Specialist",
        specialty: "Tax law and technical accuracy",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },
      {
        id: "scenario_analyst",
        name: "Scenario Analist",
        specialty: "Alternative scenarios and gaps",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },
      {
        id: "communication_specialist",
        name: "Communicatie Specialist",
        specialty: "Clarity and client communication",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },
      {
        id: "legal_advisor",
        name: "Juridisch Adviseur",
        specialty: "Legal accuracy and compliance",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },
      {
        id: "client_psychologist",
        name: "Klant Psycholoog",
        specialty: "Client psychology and presentation",
        dependencies: ["report_generator"],
        canRunParallel: true,
        priority: 3
      },

      // Phase 4: Quality Control (after specialist reviews)
      {
        id: "quality_controller",
        name: "Kwaliteit Controller",
        specialty: "Final quality assurance and integration",
        dependencies: ["sources_specialist", "fiscal_specialist", "scenario_analyst", "communication_specialist", "legal_advisor", "client_psychologist"],
        canRunParallel: false,
        priority: 4
      }
    ];

    agentDefinitions.forEach(agent => {
      this.agents.set(agent.id, agent);
    });
  }

  async executeAgentNetwork(
    reportId: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    rawText: string,
    progressCallback?: (phase: string, progress: number, results: Map<string, AgentResult>) => void
  ): Promise<Report> {
    console.log(`🤖 Starting agent network execution for report ${reportId}`);
    
    const report = await storage.getReport(reportId);
    if (!report) throw new Error("Report not found");

    // Reset state for new execution
    this.results.clear();
    this.feedbackNetwork = [];

    // Execute agents in phases
    const phases = this.getExecutionPhases();
    
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex];
      const phaseName = this.getPhaseName(phaseIndex + 1);
      
      console.log(`📋 Executing Phase ${phaseIndex + 1}: ${phaseName} (${phase.length} agents)`);
      
      // Execute agents in parallel within the phase
      const phasePromises = phase.map(agent => 
        this.executeAgent(agent, reportId, dossier, bouwplan, rawText)
      );

      const phaseResults = await Promise.allSettled(phasePromises);
      
      // Process results and generate feedback
      phaseResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          this.results.set(phase[index].id, result.value);
        } else {
          console.error(`❌ Agent ${phase[index].id} failed:`, result.reason);
        }
      });

      // Generate inter-agent feedback for next phase
      if (phaseIndex < phases.length - 1) {
        await this.generateAgentFeedback(phaseIndex + 1);
      }

      // Update progress
      const progress = ((phaseIndex + 1) / phases.length) * 100;
      progressCallback?.(phaseName, progress, new Map(this.results));
      
      // Update report with current results
      await this.updateReportWithResults(reportId);
    }

    // Generate final integrated report
    const finalReport = await this.generateFinalReport(reportId, dossier, bouwplan);
    
    console.log(`✅ Agent network execution completed for report ${reportId}`);
    return finalReport;
  }

  private getExecutionPhases(): Agent[][] {
    const phases: Agent[][] = [[], [], [], []];
    
    this.agents.forEach(agent => {
      phases[agent.priority - 1].push(agent);
    });
    
    return phases.filter(phase => phase.length > 0);
  }

  private getPhaseName(phaseNumber: number): string {
    switch (phaseNumber) {
      case 1: return "Foundation Analysis";
      case 2: return "Core Generation"; 
      case 3: return "Specialist Review";
      case 4: return "Quality Integration";
      default: return `Phase ${phaseNumber}`;
    }
  }

  private async executeAgent(
    agent: Agent,
    reportId: string,
    dossier: DossierData,
    bouwplan: BouwplanData,
    rawText: string
  ): Promise<AgentResult> {
    console.log(`🔄 Executing agent: ${agent.name}`);

    // Get relevant feedback for this agent
    const relevantFeedback = this.feedbackNetwork.filter(f => f.toAgent === agent.id);
    
    // Get previous results from dependencies
    const dependencyResults = agent.dependencies.reduce((acc, depId) => {
      const result = this.results.get(depId);
      if (result) {
        acc[depId] = result.output;
      }
      return acc;
    }, {} as Record<string, string>);

    // Map agent ID to stage key for existing ReportGenerator
    const stageKey = this.mapAgentToStageKey(agent.id);
    
    // Execute the agent using existing ReportGenerator
    try {
      const stageResult = await this.reportGenerator.executeStage(
        stageKey,
        dossier,
        bouwplan,
        dependencyResults,
        {}, // conceptReportVersions
        this.buildAgentContext(agent, relevantFeedback, rawText),
        reportId
      );

      // Calculate quality score (mock implementation - would be more sophisticated)
      const qualityScore = this.calculateQualityScore(stageResult.stageOutput);

      return {
        agentId: agent.id,
        output: stageResult.stageOutput,
        feedback: [],
        qualityScore,
        suggestedIterations: this.generateIterationSuggestions(agent, stageResult.stageOutput)
      };

    } catch (error) {
      console.error(`❌ Agent ${agent.name} execution failed:`, error);
      throw error;
    }
  }

  private mapAgentToStageKey(agentId: string): string {
    const mapping: Record<string, string> = {
      'info_processor': '1_informatiecheck',
      'complexity_analyzer': '2_complexiteitscheck', 
      'report_generator': '3_generatie',
      'sources_specialist': '4a_BronnenSpecialist',
      'fiscal_specialist': '4b_FiscaalTechnischSpecialist',
      'scenario_analyst': '4c_ScenarioGatenAnalist',
      'communication_specialist': '4d_DeVertaler',
      'legal_advisor': '4e_DeAdvocaat', 
      'client_psychologist': '4f_DeKlantpsycholoog',
      'quality_controller': '4g_ChefEindredactie'
    };
    
    return mapping[agentId] || agentId;
  }

  private buildAgentContext(agent: Agent, feedback: AgentFeedback[], rawText: string): string {
    let context = `Raw input: ${rawText}\n\n`;
    
    if (feedback.length > 0) {
      context += "Feedback from other agents:\n";
      feedback.forEach(f => {
        context += `- ${f.fromAgent}: ${f.feedback}\n`;
      });
      context += "\n";
    }

    context += `Your role as ${agent.name}: ${agent.specialty}\n`;
    context += "Focus on your specialty while considering feedback from other agents.";
    
    return context;
  }

  private calculateQualityScore(output: string): number {
    // Mock quality scoring - would implement proper metrics
    let score = 0.5;
    
    if (output.length > 500) score += 0.1;
    if (output.includes("bronnen:") || output.includes("sources:")) score += 0.1;
    if (output.includes("conclusie") || output.includes("aanbeveling")) score += 0.1;
    if (output.match(/\d{1,2}[%]/)) score += 0.1; // Contains percentages
    if (output.includes("artikel") || output.includes("wet")) score += 0.1; // Legal references
    
    return Math.min(score, 1.0);
  }

  private generateIterationSuggestions(agent: Agent, output: string): string[] {
    // Mock iteration suggestions - would be more intelligent
    const suggestions: string[] = [];
    
    if (output.length < 300) {
      suggestions.push("Output seems brief - consider more detailed analysis");
    }
    
    if (!output.includes("bron") && agent.specialty.includes("Source")) {
      suggestions.push("Add more source citations");
    }
    
    return suggestions;
  }

  private async generateAgentFeedback(nextPhase: number): Promise<void> {
    // Generate cross-agent feedback based on results
    // This would be more sophisticated in practice
    console.log(`🔄 Generating inter-agent feedback for phase ${nextPhase}`);
    
    // Mock feedback generation - would use AI to analyze results and generate feedback
    if (nextPhase === 3) { // Before specialist review
      const reportGenResult = this.results.get('report_generator');
      if (reportGenResult) {
        // Generate feedback for specialists based on the core report
        this.feedbackNetwork.push({
          fromAgent: 'report_generator',
          toAgent: 'sources_specialist', 
          feedback: 'Focus on verifying the legal sources mentioned in sections 2 and 3',
          severity: 'medium',
          actionRequired: true
        });
      }
    }
  }

  private async updateReportWithResults(reportId: string): Promise<void> {
    const stageResults: Record<string, string> = {};
    
    this.results.forEach((result, agentId) => {
      const stageKey = this.mapAgentToStageKey(agentId);
      stageResults[stageKey] = result.output;
    });

    await storage.updateReportStageResults(reportId, stageResults);
  }

  private async generateFinalReport(
    reportId: string,
    dossier: DossierData,
    bouwplan: BouwplanData
  ): Promise<Report> {
    // Use quality controller to integrate all results
    const qualityResult = this.results.get('quality_controller');
    
    if (qualityResult) {
      await storage.updateReportContent(reportId, qualityResult.output);
    }

    return await storage.getReport(reportId) as Report;
  }

  // Public method to get current execution status
  getExecutionStatus(): {
    currentPhase: string;
    completedAgents: string[];
    runningAgents: string[];
    overallProgress: number;
    qualityMetrics: Record<string, number>;
  } {
    const completed = Array.from(this.results.keys());
    const totalAgents = this.agents.size;
    const progress = (completed.length / totalAgents) * 100;
    
    const qualityMetrics: Record<string, number> = {};
    this.results.forEach((result, agentId) => {
      qualityMetrics[agentId] = result.qualityScore;
    });

    return {
      currentPhase: this.getCurrentPhase(),
      completedAgents: completed,
      runningAgents: [], // Would track running agents in real implementation
      overallProgress: progress,
      qualityMetrics
    };
  }

  private getCurrentPhase(): string {
    const completed = this.results.size;
    if (completed <= 2) return "Foundation Analysis";
    if (completed <= 3) return "Core Generation";
    if (completed <= 9) return "Specialist Review";
    return "Quality Integration";
  }
}