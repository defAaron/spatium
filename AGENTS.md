# Repository Guidelines

## Product implementation

Use the [implementation plan](docs/implementation-plan.md) for work order, task checklists, and test gates. Start at the first incomplete subproblem, verify its prerequisites, and run its gate before advancing. Record evidence and blockers in the plan. The [PRD](docs/prd.md) defines release acceptance and the [architecture](docs/architecture.md) defines technical contracts.

## Project structure

- `src/` contains the React and TypeScript frontend. `main.tsx` handles upload and job status, `Viewer.tsx` handles camera controls, and `viewport.ts` renders the depth mesh and exports WebM. The browser's scene types live in `scene.ts`.
- `spatium/` contains the FastAPI backend. `main.py` owns session-scoped jobs and routes, `magic_hour.py` handles provider calls, `depth.py` runs inference, and `demo.py` generates the sample image and depth buffer.
- Read [the PRD](docs/prd.md) for product scope and [the architecture](docs/architecture.md) for the processing flow. Vite writes the frontend build to `dist/`.

## Build and local development

Use Node.js 22, Python 3.11 or newer, and uv.

- `npm ci` and `uv sync` install the locked frontend and backend dependencies.
- Run `uv run uvicorn spatium.main:app --reload --port 8000`, then run `npm run dev` in a second terminal. Vite proxies `/api` requests to FastAPI.
- `npm run build` checks TypeScript and bundles the frontend. Build before starting Uvicorn to serve both from port 8000.
- `uv sync --extra depth` enables live photo generation after an API restart. The first inference downloads model weights.

## Code style

Use two-space indentation in TypeScript and four spaces in Python. Match existing names with PascalCase for React components and types, camelCase for TypeScript functions, and snake_case for Python functions and modules. Keep API payload changes aligned with `src/scene.ts`. Follow neighboring code for formatting. The scaffold has no configured linter or formatter.

## Verification

Run `npm run build` and follow the relevant implementation plan test gate. Use the sample scene for browser smoke checks and mock Magic Hour for routine API checks. Keep API keys out of logs, fixtures, and commits.

## Commits and pull requests

Git history is empty. Use short, imperative commit subjects such as `Fix zoom reset`. In pull requests, explain the behavior change and verification performed, link a related issue when available, and include a screenshot or clip for visible changes.
