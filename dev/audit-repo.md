Context:
We are preparing "Scout," a real estate geospatial data engine, for a national-level Google Developer Group Hackathon. The current stack is Next.js (App Router), React 19, Supabase (PostgreSQL + PostGIS), deck.gl (Vector Mode), and Gemini 2.5 Flash. We need to audit the codebase for performance bottlenecks, inefficient state management, and scalability issues before we present.

Task:
Perform a ruthless, senior-level architectural audit of this repository. Do not focus on minor syntax issues; focus on system architecture, data transport, and rendering efficiency.

Please analyze the codebase and report back on the following 4 specific areas:

1. Data Transport & Map Rendering (deck.gl + PostGIS):

Are we sending large raw JSON arrays from our Next.js API routes (/api/transit, /api/tracts, /api/permits) directly to the frontend?

Identify queries that should be converted to use PostGIS ST_AsMVT (Mapbox Vector Tiles) or deck.gl's binary data format to improve WebGL rendering speeds.

Are map queries properly constrained by a bounding box (ST_Intersects), or are we over-fetching data?

2. Next.js Route Efficiency & Caching:

Identify any N+1 query problems in our Supabase fetches (especially inside /api/market, /api/aggregate, or ingest:zillow).

Are we properly utilizing Next.js caching strategies for static data (like the 7,661 ZIP centroids), or are we hammering Supabase on every render?

3. React State & Component Re-renders:

Analyze our use of Zustand (sites-store) and React Context. Are rapid map movements (like the FlyToController) or streaming agent updates (NDJSON thinking_delta) causing massive, unnecessary re-renders of the entire dashboard?

Recommend where we can implement predictive data fetching (e.g., prefetching market data when a user hovers over a saved site in the sidebar).

4. AI Agent Optimization:

Review the POST /api/agent route and lib/consume-agent-ndjson-stream.ts. Is the streaming implementation blocking the main thread?

Output format: > Provide the findings in a prioritized list, starting with "Critical Bottlenecks" (things that will break at scale) down to "UX/Polish" (things that make the app feel predictive and instantaneous). For every problem, provide a specific technical solution tailored to Next.js and PostGIS.

Make the list available at /Projectr-Analytics/dev (aka under the root of the repository, in the dev folder).