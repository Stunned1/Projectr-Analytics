**SCOUT**

Agentic Workflow

Product Requirements Document

| **Version**      | 1.0 - Phase 2 Architecture                                     |
| ---------------- | -------------------------------------------------------------- |
| **Status**       | Draft - for team alignment                                     |
| **Stack**        | Node / TypeScript + Google Cloud (Gemini, Vertex AI, BigQuery) |
| **Primary user** | Projectr analyst (internal tool, not client-facing)            |

# **1\. Overview**

Scout is an internal consulting tool that helps Projectr analysts visualize, explain, and communicate data-driven thinking to non-technical real estate and construction clients. This PRD defines the agentic workflow architecture for Scout Phase 2: a single Gemini-based EDA agent with two tool harnesses - one for grounding and credibility, one for computation and statistics.

_Core principle: Scout's value is showing and framing data, not doing fully autonomous work. The analyst stays in the loop. Every claim the agent makes must be traceable to a source._

# **2\. Goals & non-goals**

### **Goals**

- Replace ad-hoc data exploration with a structured, cited EDA workflow
- Give analysts a tool they can use live in client meetings
- Produce PDF-exportable deliverables with charts, maps, and source citations
- Support market comparison: A vs B, market vs own history, outlier detection
- Ground all quantitative claims in verifiable sources (Projectr data, Census, HUD, Maps)

### **Non-goals**

- Forecasting (Projectr's core service - intentionally excluded from Scout)
- Fully autonomous site discovery or investment recommendations
- Client-facing deployment (internal analyst tool only, for now)
- Real-time data feeds or live market monitoring

# **3\. Architecture summary**

Scout uses a single EDA agent (Gemini) with two distinct tool harnesses. The agent decides which tools to call, interleaves grounding and computation mid-reasoning, and tags every claim with its source before outputting.

### **Data sources**

| **Source**   | **Role**                                   | **Notes**                                              |
| ------------ | ------------------------------------------ | ------------------------------------------------------ |
| BigQuery     | Historical time series, analytical queries | Primary store for EDA workload                         |
| Supabase     | CSV upload landing zone                    | Syncs to BigQuery; also ingested into Vertex AI Search |
| Data Commons | Public macro statistics                    | Accessed via DataGemma - Census, HUD, UN, WHO          |
| Google Maps  | Place context, drive times                 | Accessed via Grounding Lite MCP server                 |

### **Grounding harness (credibility)**

All tools in this harness return data plus a citable source. The agent uses these to answer what the data says and where it comes from.

- Vertex AI Search - retrieves rows from Projectr's ingested CSV / BigQuery data with row-level provenance
- DataGemma - grounds public macro statistics (population, income, housing burden) with Census / HUD citations
- Grounding Lite MCP - returns place summaries, Place IDs, coordinates, and drive times with Maps attribution
- Check Grounding API - validates that every factual claim in the agent's output is supported by a retrieved source

### **Compute harness (statistics)**

All tools in this harness run actual computation. The agent uses these to produce numbers, not just retrieve them.

- Python EDA tool - a FastAPI sidecar service (Python/pandas) that the Node agent calls via HTTP for statistical operations: distributions, outlier detection, correlation matrices, percentile ranks
- BigQuery query tool - a typed TypeScript function that converts natural language data requests into parameterized BigQuery SQL and returns structured results
- Visualization tool - placeholder; to be defined in Phase 1. Accepts structured chart data and returns rendered output

### **Agent behavior contract**

_The agent must tag every numerical claim with its source tool before outputting. This is enforced via system prompt. Example: "Permit activity in Travis County is up 34% YoY \[source: Projectr CSV, uploaded 2024-03-15\]."_

# **4\. Implementation plan**

Work is organized into four sequential phases. Each phase has a clear definition of done before the next begins. The visualization layer is Phase 1 because it is the most client-visible and unblocks demo capability.

| **Phase 1** | **Visualization layer** | **Immediate** |
| ----------- | ----------------------- | ------------- |

| **#** | **Task**                                                                      | **Owner** | **Priority**  |
| ----- | ----------------------------------------------------------------------------- | --------- | ------------- |
| **1** | Audit all current MVP output types - screenshot and categorize                | Team      | **This week** |
| **2** | Select and standardize charting library (Recharts or Chart.js)                | Frontend  | **This week** |
| **3** | Define ScoutChartOutput JSON schema (chart type, axes, series, citations\[\]) | Lead      | **This week** |
| **4** | Build ScoutChart renderer component consuming the schema                      | Frontend  | **Week 2**    |
| **5** | Update agent system prompt to output ScoutChartOutput JSON                    | Backend   | **Week 2**    |
| **6** | Add Google Maps JS API base layer (lat/lng markers from existing data)        | Frontend  | **Week 2**    |
| **7** | Definition of done: agent produces a rendered chart with citation footer      | Team      | **Week 2**    |

| **Phase 2** | **Data pipeline + EDA tooling** | **After Phase 1** |
| ----------- | ------------------------------- | ----------------- |

| **#**  | **Task**                                                                 | **Owner** | **Priority** |
| ------ | ------------------------------------------------------------------------ | --------- | ------------ |
| **8**  | Set up Supabase → BigQuery sync triggered on CSV upload                  | Backend   | **High**     |
| **9**  | Build Python EDA FastAPI sidecar (distributions, outliers, correlations) | Backend   | **High**     |
| **10** | Build BigQuery query tool with parameterized template queries            | Backend   | **High**     |
| **11** | Wire EDA sidecar and BigQuery tool into agent tool config                | Backend   | **High**     |
| **12** | Test: agent produces cited time-series comparison for a Texas county     | Team      | **High**     |

| **Phase 3** | **Grounding harness** | **After Phase 2** |
| ----------- | --------------------- | ----------------- |

| **#**  | **Task**                                                                 | **Owner** | **Priority** |
| ------ | ------------------------------------------------------------------------ | --------- | ------------ |
| **13** | Create Vertex AI Search data store; ingest BigQuery tables + CSVs        | Backend   | **High**     |
| **14** | Add Grounding Lite MCP server to agent tool config (search_places first) | Backend   | **High**     |
| **15** | Add compute_routes tool for drive-time between markets                   | Backend   | **Medium**   |
| **16** | Enforce citation tagging in system prompt; write regression test suite   | Backend   | **High**     |
| **17** | Add Check Grounding API as post-generation validator                     | Backend   | **Medium**   |
| **18** | Use Gemini + Search grounding for public macro stats (DataGemma Phase 4) | Backend   | **Medium**   |

| **Phase 4** | **Export + polish** | **After Phase 3** |
| ----------- | ------------------- | ----------------- |

| **#**  | **Task**                                                              | **Owner** | **Priority** |
| ------ | --------------------------------------------------------------------- | --------- | ------------ |
| **19** | Build Puppeteer PDF export from ScoutChart renders                    | Frontend  | **High**     |
| **20** | Add interactive slider / comparison controls to chart components      | Frontend  | **Medium**   |
| **21** | Side-by-side market comparison view (resolve UI clutter problem)      | Frontend  | **High**     |
| **22** | DataGemma full integration (replace Search grounding for macro stats) | Backend   | **Low**      |
| **23** | H3 / hex overlay for map visualization layer                          | Frontend  | **Low**      |

# **5\. Open questions**

| **Question**                                                        | **Owner**       | **Status**     |
| ------------------------------------------------------------------- | --------------- | -------------- |
| Does Texas have raw permit data beyond Austin? What's the fallback? | Aidan / Atharva | Blocked        |
| Visualization tool - which library / approach? (Phase 1 decision)   | Team            | Needs decision |
| Local hosting vs AWS / GCP? Affects Vertex AI auth complexity       | Lead            | Open           |
| How to handle side-by-side map comparison without cluttered UI?     | Frontend        | Open           |
| Should county-level be the default granularity, or configurable?    | Product         | Open           |

# **6\. Key constraints**

- Scout is an internal tool - Projectr analysts are the user, not clients directly
- Clients are non-technical; all output must prioritize clarity over completeness
- Forecasting is explicitly out of scope - that is Projectr's core service
- Citation integrity is non-negotiable - every quantitative claim needs a source tag
- Grounding Lite MCP is experimental (pre-GA); treat it as unstable until GA
- DataGemma full integration is research-grade; use Gemini + Search grounding as interim
- The Python EDA sidecar introduces polyglot complexity - keep its scope narrow (5-6 operation types)

# **7\. Success metrics**

| **Metric**                                                  | **Phase 1 target**  | **Phase 3 target** |
| ----------------------------------------------------------- | ------------------- | ------------------ |
| Agent outputs a rendered chart (not just text)              | 100% of EDA queries | 100%               |
| Every quantitative claim has a source tag                   | Not yet enforced    | 100%               |
| Analyst can produce client deliverable in one Scout session | Manual assembly     | Single export      |
| Market A vs B comparison loads without UI clutter           | Known issue         | Resolved           |
| PDF export includes charts + citations                      | Not available       | Available          |
