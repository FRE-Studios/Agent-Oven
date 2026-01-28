## Agent Oven v2: Agent Workflow Scheduling

### Core Concept

Agent Oven evolves from "Docker job scheduler" to "Agent Pipeline scheduler"—a cron/webhook service that triggers Agent Pipeline runs in isolated Docker containers.

```
┌─────────────────────────────────────────────────────────────┐
│                      Trigger Layer                          │
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────┐     │
│   │   Cron   │  │  Manual  │  │   Webhook / API      │     │
│   └────┬─────┘  └────┬─────┘  └──────────┬───────────┘     │
└────────┼─────────────┼───────────────────┼─────────────────┘
         │             │                   │
         └─────────────┼───────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Agent Oven Scheduler                       │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│   │ Job Manager │  │ Run Queue   │  │ Secrets Vault   │    │
│   └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Docker Execution Layer                     │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Container: agent-oven/pipeline-runner              │   │
│   │  ┌───────────────────────────────────────────────┐  │   │
│   │  │  - Clone target repo                          │  │   │
│   │  │  - Inject credentials (ANTHROPIC_API_KEY)     │  │   │
│   │  │  - Run: agent-pipeline run <pipeline-name>    │  │   │
│   │  │  - Stream logs back to Agent Oven             │  │   │
│   │  │  - Push results (commits/PRs) to remote       │  │   │
│   │  └───────────────────────────────────────────────┘  │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

### Job Definition (Extended)

```json
{
  "id": "nightly-code-review",
  "name": "Nightly Code Review Pipeline",
  "type": "agent-pipeline",
  
  "source": {
    "repo": "git@github.com:myorg/myapp.git",
    "branch": "main",
    "credentials": "github-deploy-key"
  },
  
  "pipeline": "post-commit-example",
  
  "schedule": {
    "type": "cron",
    "cron": "0 2 * * *"
  },
  
  "secrets": ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"],
  
  "notifications": {
    "slack": "#agent-runs",
    "onFailure": true,
    "onSuccess": false
  },
  
  "resources": {
    "timeout": 1800,
    "memory": "2g"
  }
}
```

---

### New Components

| Component | Purpose |
|-----------|---------|
| **Webhook Server** | Express/Fastify server exposing `/api/trigger/:jobId` with optional auth |
| **Secrets Vault** | Encrypted local store for API keys, injected as env vars at runtime |
| **Pipeline Runner Image** | Docker image with `agent-pipeline`, `git`, `gh`, Node.js pre-installed |
| **Run History DB** | SQLite or JSON store tracking runs, status, duration, logs |

---

### TUI Additions

**New Dashboard Section:**
```
┌─ Agent Oven ──────────────────────────────────────────┐
│                                                        │
│  Agent Pipelines: 4 configured │ 1 running            │
│                                                        │
│  Active Run                                            │
│  ─────────────────────────────────────────────────    │
│  ● nightly-code-review    stage 2/4   security-audit  │
│    ├─ code-review       ✓ 45s                         │
│    ├─ security-audit    ◐ running...                  │
│    ├─ doc-updater       ○ pending                     │
│    └─ memory-manager    ○ pending                     │
│                                                        │
│  [p] Pipelines  [w] Webhooks  [s] Secrets  [q] Quit   │
└────────────────────────────────────────────────────────┘
```

**Webhook Management Screen:**
```
┌─ Webhooks ────────────────────────────────────────────┐
│                                                        │
│  Endpoint: http://localhost:3847/api/trigger           │
│                                                        │
│  Job                     Token (masked)    Last Hit    │
│  ─────────────────────────────────────────────────    │
│  nightly-code-review     ****a3f9         2h ago      │
│  pr-review-on-demand     ****8c2e         never       │
│                                                        │
│  [n] New token  [r] Regenerate  [c] Copy URL          │
└────────────────────────────────────────────────────────┘
```

---

### Implementation Phases

**Phase 1: Pipeline Runner Image**
- [ ] Dockerfile with `agent-pipeline`, git, gh, Node 20
- [ ] Entrypoint script: clone → inject secrets → run → push
- [ ] Log streaming via Docker attach

**Phase 2: Extended Job Schema**
- [ ] `type: "agent-pipeline"` jobs with `source`, `pipeline`, `secrets` fields
- [ ] Secrets management (encrypted JSON, env injection)
- [ ] Migrate existing Docker jobs to `type: "docker"` (backward compat)

**Phase 3: Webhook Server**
- [ ] `/api/trigger/:jobId` with bearer token auth
- [ ] `/api/status/:runId` for polling run status
- [ ] Rate limiting, request logging

**Phase 4: TUI Integration**
- [ ] Pipeline job creation form
- [ ] Live run visualization (stage progress)
- [ ] Secrets management screen
- [ ] Webhook URL generation

---

### Open Questions

1. **GitHub App vs Deploy Keys** — For pushing commits/PRs, should we support GitHub App installation for org-wide access?

2. **Multi-repo Pipelines** — Some workflows might span repos. Support `source` as array?

3. **Result Artifacts** — Beyond git commits, should pipelines produce downloadable artifacts (reports, diffs)?

4. **Cost Tracking** — Agent Pipeline supports model mixing. Surface token/cost estimates in Agent Oven?

---

What aspects do you want to dig into first? I'd suggest starting with the **Pipeline Runner Image** since that's the execution foundation.