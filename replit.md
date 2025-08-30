# De Fiscale Analist - Report Generation System

## Overview

This is a full-stack web application called "De Fiscale Analist" (The Fiscal Analyst) that generates professional Dutch tax analysis reports. The system allows users to input client dossier data and report structure preferences (bouwplan) to automatically generate comprehensive fiscal interpretation reports in Dutch. The application focuses on providing accurate, professionally formatted tax analysis while maintaining strict source validation to ensure compliance with Dutch government regulations.

## User Preferences

Preferred communication style: Simple, everyday language.
Privacy-focused: Minimize personal data collection - avoid BSN and other sensitive personal identifiers.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Comprehensive component system using Radix UI primitives with shadcn/ui styling
- **State Management**: TanStack Query (React Query) for server state management with custom query client
- **Routing**: Wouter for lightweight client-side routing
- **Styling**: Tailwind CSS with custom design tokens and CSS variables for theming
- **Form Handling**: React Hook Form with Zod validation resolvers

### Backend Architecture  
- **Runtime**: Node.js with Express.js server
- **Type Safety**: TypeScript throughout with shared schema definitions
- **Development Server**: Custom Vite integration with HMR support and middleware mode
- **API Design**: RESTful endpoints with structured error handling and request logging
- **Input Validation**: Zod schemas for runtime type checking and data validation

### Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Connection**: Neon Database serverless PostgreSQL for cloud hosting
- **Schema Management**: Drizzle Kit for migrations and schema synchronization
- **Session Storage**: Connect-pg-simple for PostgreSQL-backed session management
- **Fallback Storage**: In-memory storage implementation for development/testing

### Core Business Logic
- **Report Generation**: Service-based architecture with ReportGenerator class handling content creation
- **Source Validation**: SourceValidator service ensuring only verified Dutch government sources (belastingdienst.nl, wetten.overheid.nl, rijksoverheid.nl)
- **Content Structure**: Configurable report sections including introduction, problem areas (knelpunten), scenario analysis, and next steps
- **Professional Formatting**: HTML-based report generation with proper legal disclaimers and source citations

### Authentication and Authorization
- **User Management**: Database-stored user accounts with hashed passwords
- **Session Handling**: Express sessions with PostgreSQL persistence
- **Access Control**: Route-level protection for authenticated endpoints

## External Dependencies

### Database Services
- **Neon Database**: Serverless PostgreSQL hosting with connection pooling
- **Drizzle ORM**: Type-safe database toolkit with PostgreSQL dialect support

### UI and Component Libraries
- **Radix UI**: Comprehensive accessible component primitives for all interactive elements
- **Tailwind CSS**: Utility-first CSS framework with custom configuration
- **Lucide React**: Consistent icon library for user interface elements
- **shadcn/ui**: Pre-built component system built on Radix UI primitives

### Development and Build Tools
- **Vite**: Fast build tool with React plugin and custom runtime error handling
- **TanStack Query**: Powerful data synchronization for React applications
- **React Hook Form**: Performant forms with minimal re-renders
- **Zod**: TypeScript-first schema validation library

### Specialized Libraries
- **cmdk**: Command palette component for enhanced user interactions
- **date-fns**: Modern JavaScript date utility library
- **class-variance-authority**: Type-safe variant system for component styling
- **embla-carousel**: Touch-friendly carousel components

### Government Source Integration
- **Verified Domains**: Restricted to official Dutch government websites
- **Source Validation**: Runtime URL validation against approved domain whitelist
- **Citation System**: Mandatory inline source references with numbered bibliography