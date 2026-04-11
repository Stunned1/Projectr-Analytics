# Scout

A geospatial data engine and automated reporting platform for real estate analytics.

Scout automates data aggregation for real estate analysts. By unifying public market signals with proprietary client site lists, it provides instant spatial context and data-driven market briefs.

## Core Features

* **Unified Pipeline:** Ingests and normalizes data from 8 public sources, including Zillow, Census ACS, FRED, HUD, Transitland, and NYC Open Data.
* **Agentic Normalization:** Drag-and-drop CSV uploads are automatically categorized, geocoded, and rendered onto the map via LLM integration.
* **Spatial Engine:** Renders dense datasets, including parcels and building permits, smoothly via WebGL.
* **Automated Reporting:** Generates structured, exportable PDF market briefs directly from the live map state.

## Architecture

* **Frontend:** Next.js, React, Tailwind CSS
* **Spatial:** deck.gl, Google Maps Platform (Vector Mode)
* **Database:** Supabase (PostgreSQL, PostGIS)
* **Intelligence:** Gemini 2.5 Flash
* **Reporting:** @react-pdf/renderer

## Setup

### 1. Dependencies
Ensure Node.js 18+ is installed. You will need an active Supabase project with PostGIS enabled, alongside API keys for Google Maps, Gemini, FRED, Census, and Transitland.

### 2. Environment
Create a local env file and configure your keys. Note that your Google Maps Map ID must be configured as a Vector map.
